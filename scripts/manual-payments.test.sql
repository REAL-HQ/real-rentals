-- Rolled-back test for phase-c-manual-payments.proposed.sql.
-- Usage: psql -v ON_ERROR_STOP=1 -f scripts/manual-payments.test.sql   (ends in ROLLBACK; nothing persists)
BEGIN;
\i scripts/phase-c-manual-payments.proposed.sql

CREATE TEMP TABLE t_out(n serial, line text);
GRANT ALL ON t_out TO authenticated, anon; GRANT USAGE ON SEQUENCE t_out_n_seq TO authenticated, anon;

CREATE FUNCTION pg_temp.as_user(_uid uuid, _role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role',_role)::text, true);
  EXECUTE format('SET LOCAL ROLE %I', _role);
END $$;

DO $t$
DECLARE
  own uuid := '15604112-1a62-4907-a92c-09045ee70ca6';
  mgr uuid := '194cec09-2d93-42d0-a5a7-04e8c931d7de';
  mgr2 uuid := 'd4abe15b-8230-4597-837e-7e0449db364a';  -- given test-only Manager role, then Coordinator, then Driver
  a uuid; ch uuid; dep uuid; ch2 uuid; doc uuid; c1 uuid; c2 uuid; c3 uuid; cc uuid; x uuid; s text; n int;
  pay0 bigint; fin0 bigint; rent0 bigint; app_status text; m text;
  PROCEDURE_ok boolean;
BEGIN
  SELECT count(*) INTO fin0 FROM financial_transactions; SELECT count(*) INTO rent0 FROM rentals;
  INSERT INTO applications(full_name,email,phone,status) VALUES ('Zz Pay','zz-pay@invalid.example','0','approved') RETURNING id INTO a;
  INSERT INTO payments(driver_id,amount,balance_due,status,type,due_date) VALUES (a,350,350,'unpaid','rent',current_date) RETURNING id INTO ch;
  INSERT INTO payments(driver_id,amount,balance_due,status,type) VALUES (a,500,500,'unpaid','deposit') RETURNING id INTO dep;
  INSERT INTO payments(driver_id,amount,balance_due,status,type,stripe_payment_intent_id) VALUES (a,100,100,'pending','fee','pi_test') RETURNING id INTO ch2;
  INSERT INTO documents(application_id, file_name, storage_path, category) VALUES (a,'r.png','zz/r.png','other') RETURNING id INTO doc;
  INSERT INTO user_roles(user_id,role) VALUES (mgr2,'team');

  -- Evidence rules per method (as Manager)
  PERFORM pg_temp.as_user(mgr,'authenticated');
  FOR m IN SELECT unnest(ARRAY['cash_app','venmo','zelle','bank_transfer','money_order','check','cash','other']) LOOP
    BEGIN PERFORM collection_record(ch,m,1,current_date,NULL,NULL,NULL,NULL,'ev-'||m);
      INSERT INTO t_out(line) VALUES ('FAIL '||m||' with no evidence accepted');
    EXCEPTION WHEN OTHERS THEN INSERT INTO t_out(line) VALUES ('ok '||m||' no evidence refused: '||SQLERRM); END;
  END LOOP;

  -- Partial payments: 150 Zelle (ref) + 200 Check (image)
  c1 := collection_record(ch,'zelle',150,current_date,'ZL-0001',NULL,NULL,NULL,'k1');
  x  := collection_record(ch,'zelle',150,current_date,'ZL-0001',NULL,NULL,NULL,'k1');
  INSERT INTO t_out(line) VALUES ((CASE WHEN x=c1 THEN 'ok' ELSE 'FAIL' END)||' repeated submission returns same record');
  BEGIN PERFORM collection_record(ch,'zelle',10,current_date,'zl 0001',NULL,NULL,NULL,'k1b');
    INSERT INTO t_out(line) VALUES ('FAIL duplicate reference accepted');
  EXCEPTION WHEN unique_violation THEN INSERT INTO t_out(line) VALUES ('ok duplicate reference refused'); END;
  c2 := collection_record(ch,'check',200,current_date,NULL,doc,NULL,NULL,'k2');
  BEGIN PERFORM collection_record(ch,'venmo',1,current_date,'VM-9',NULL,NULL,NULL,'k3');
    INSERT INTO t_out(line) VALUES ('FAIL overpayment (pending counted) accepted');
  EXCEPTION WHEN OTHERS THEN INSERT INTO t_out(line) VALUES ('ok overpayment refused: '||SQLERRM); END;
  BEGIN PERFORM collection_record(ch2,'venmo',10,current_date,'VM-10',NULL,NULL,NULL,'k4');
    INSERT INTO t_out(line) VALUES ('FAIL charge with card payment in progress accepted');
  EXCEPTION WHEN OTHERS THEN INSERT INTO t_out(line) VALUES ('ok Stripe in-progress charge refused'); END;

  EXECUTE 'RESET ROLE';
  SELECT balance_due::text||'/'||status INTO s FROM payments WHERE id=ch;
  INSERT INTO t_out(line) VALUES ((CASE WHEN s='350.00/unpaid' OR s='350/unpaid' THEN 'ok' ELSE 'FAIL' END)||' pending leaves balance unchanged: '||s);

  -- Manager self-verify refused
  PERFORM pg_temp.as_user(mgr,'authenticated');
  BEGIN PERFORM collection_verify(c1,true,'Seen in bank app');
    INSERT INTO t_out(line) VALUES ('FAIL manager self-verify accepted');
  EXCEPTION WHEN OTHERS THEN INSERT INTO t_out(line) VALUES ('ok manager self-verify refused'); END;
  -- Second Manager: must confirm funds
  PERFORM pg_temp.as_user(mgr2,'authenticated');
  BEGIN PERFORM collection_verify(c1,false,'');
    INSERT INTO t_out(line) VALUES ('FAIL verify without funds confirmation');
  EXCEPTION WHEN OTHERS THEN INSERT INTO t_out(line) VALUES ('ok verify needs funds confirmation'); END;
  s := collection_verify(c1,true,'Matched Zelle deposit in bank account');
  s := s || '/' || collection_verify(c1,true,'again');
  INSERT INTO t_out(line) VALUES ('ok independent manager verify + repeat: '||s);
  EXECUTE 'RESET ROLE';
  SELECT balance_due::text||'/'||status||'/'||net_collected INTO s FROM payments WHERE id=ch;
  INSERT INTO t_out(line) VALUES ('balance after 150 verified (expect 200/unpaid/150): '||s);

  -- Immutable history
  BEGIN UPDATE payment_collections SET amount=1 WHERE id=c1; INSERT INTO t_out(line) VALUES ('FAIL verified edited');
  EXCEPTION WHEN OTHERS THEN INSERT INTO t_out(line) VALUES ('ok verified record cannot be edited'); END;
  BEGIN DELETE FROM payment_collections WHERE id=c1; INSERT INTO t_out(line) VALUES ('FAIL verified deleted');
  EXCEPTION WHEN OTHERS THEN INSERT INTO t_out(line) VALUES ('ok verified record cannot be deleted'); END;
  PERFORM pg_temp.as_user(mgr,'authenticated');
  UPDATE payment_collections SET status='verified' WHERE id=c2; GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO t_out(line) VALUES ((CASE WHEN n=0 THEN 'ok' ELSE 'FAIL' END)||' browser update blocked ('||n||' rows)');

  -- Owner verifies check → charge paid
  PERFORM pg_temp.as_user(own,'authenticated');
  s := collection_verify(c2,true,'Check deposited, cleared');
  EXECUTE 'RESET ROLE';
  SELECT balance_due::text||'/'||status||'/'||net_collected INTO s FROM payments WHERE id=ch;
  INSERT INTO t_out(line) VALUES ('after second partial (expect 0/paid/350): '||s);
  PERFORM pg_temp.as_user(mgr,'authenticated');
  BEGIN PERFORM collection_record(ch,'venmo',1,current_date,'VM-11',NULL,NULL,NULL,'k5');
    INSERT INTO t_out(line) VALUES ('FAIL payment on paid charge accepted');
  EXCEPTION WHEN OTHERS THEN INSERT INTO t_out(line) VALUES ('ok paid charge refuses more payments'); END;

  -- Reverse (bounced check) restores balance
  s := collection_reverse(c2,'Check bounced');
  EXECUTE 'RESET ROLE';
  SELECT balance_due::text||'/'||status||'/'||net_collected INTO s FROM payments WHERE id=ch;
  INSERT INTO t_out(line) VALUES ('after reversal (expect 200/unpaid/150): '||s);

  -- Reject: balance unchanged; reference reusable after rejection
  PERFORM pg_temp.as_user(mgr,'authenticated');
  c3 := collection_record(ch,'cash_app',50,current_date,'$CA-77',NULL,NULL,NULL,'k6');
  PERFORM pg_temp.as_user(mgr2,'authenticated');
  BEGIN PERFORM collection_reject(c3,''); INSERT INTO t_out(line) VALUES ('FAIL reject without reason');
  EXCEPTION WHEN OTHERS THEN INSERT INTO t_out(line) VALUES ('ok reject needs reason'); END;
  s := collection_reject(c3,'Not found in Cash App history');
  EXECUTE 'RESET ROLE';
  SELECT balance_due::text INTO s FROM payments WHERE id=ch;
  INSERT INTO t_out(line) VALUES ('after rejection (expect 200): '||s);

  -- Cash: Manager cannot verify; Owner self-verify needs exception reason
  PERFORM pg_temp.as_user(own,'authenticated');
  cc := collection_record(dep,'cash',300,current_date,NULL,NULL,'Owner','Cash handed over at office','k7');
  PERFORM pg_temp.as_user(mgr,'authenticated');
  BEGIN PERFORM collection_verify(cc,true,'counted'); INSERT INTO t_out(line) VALUES ('FAIL manager verified cash');
  EXCEPTION WHEN OTHERS THEN INSERT INTO t_out(line) VALUES ('ok cash needs Owner'); END;
  PERFORM pg_temp.as_user(own,'authenticated');
  BEGIN PERFORM collection_verify(cc,true,'counted'); INSERT INTO t_out(line) VALUES ('FAIL owner self-verify without reason');
  EXCEPTION WHEN OTHERS THEN INSERT INTO t_out(line) VALUES ('ok owner self-verify needs exception reason'); END;
  s := collection_verify(cc,true,'Counted and deposited','Only staff member present today');
  EXECUTE 'RESET ROLE';
  SELECT balance_due::text||'/'||status||'/'||type INTO s FROM payments WHERE id=dep;
  INSERT INTO t_out(line) VALUES ('deposit partial (expect 200/unpaid/deposit, kept as deposit type): '||s);
  SELECT count(*) INTO n FROM audit_log WHERE entity_type='payment_collection' AND action='payment_verified_self_exception';
  INSERT INTO t_out(line) VALUES ((CASE WHEN n=1 THEN 'ok' ELSE 'FAIL' END)||' owner exception separately logged');

  -- Coordinator: record yes, verify no
  DELETE FROM user_roles WHERE user_id=mgr2 AND role='team';
  INSERT INTO user_roles(user_id,role) VALUES (mgr2,'coordinator');
  PERFORM pg_temp.as_user(mgr2,'authenticated');
  x := collection_record(ch,'venmo',20,current_date,'VM-20',NULL,NULL,NULL,'k8');
  INSERT INTO t_out(line) VALUES ('ok coordinator can record');
  BEGIN PERFORM collection_verify(x,true,'x'); INSERT INTO t_out(line) VALUES ('FAIL coordinator verified');
  EXCEPTION WHEN OTHERS THEN INSERT INTO t_out(line) VALUES ('ok coordinator cannot verify'); END;
  BEGIN PERFORM collection_reverse(c1,'x'); INSERT INTO t_out(line) VALUES ('FAIL coordinator reversed');
  EXCEPTION WHEN OTHERS THEN INSERT INTO t_out(line) VALUES ('ok coordinator cannot reverse'); END;

  -- Driver and signed-out
  EXECUTE 'RESET ROLE';
  DELETE FROM user_roles WHERE user_id=mgr2 AND role='coordinator';
  PERFORM pg_temp.as_user(mgr2,'authenticated');
  BEGIN PERFORM collection_record(ch,'venmo',1,current_date,'VM-30',NULL,NULL,NULL,'k9'); INSERT INTO t_out(line) VALUES ('FAIL driver recorded');
  EXCEPTION WHEN OTHERS THEN INSERT INTO t_out(line) VALUES ('ok driver cannot record'); END;
  SELECT count(*) INTO n FROM payment_collections;
  INSERT INTO t_out(line) VALUES ((CASE WHEN n=0 THEN 'ok' ELSE 'FAIL' END)||' driver sees 0 payment records');
  PERFORM pg_temp.as_user(NULL,'anon');
  BEGIN PERFORM collection_record(ch,'venmo',1,current_date,'VM-31',NULL,NULL,NULL,'k10'); INSERT INTO t_out(line) VALUES ('FAIL anon recorded');
  EXCEPTION WHEN OTHERS THEN INSERT INTO t_out(line) VALUES ('ok signed-out cannot record'); END;

  -- Isolation: no rental, application status, ledger changes
  EXECUTE 'RESET ROLE';
  SELECT status INTO app_status FROM applications WHERE id=a;
  INSERT INTO t_out(line) VALUES ((CASE WHEN app_status='approved' THEN 'ok' ELSE 'FAIL' END)||' driver status unchanged: '||app_status);
  INSERT INTO t_out(line) VALUES ((CASE WHEN (SELECT count(*) FROM rentals)=rent0 THEN 'ok' ELSE 'FAIL' END)||' no rentals created/activated');
  INSERT INTO t_out(line) VALUES ((CASE WHEN (SELECT count(*) FROM financial_transactions)=fin0 THEN 'ok' ELSE 'FAIL' END)||' no ledger entries written');
  SELECT stripe_payment_intent_id INTO s FROM payments WHERE id=ch;
  INSERT INTO t_out(line) VALUES ((CASE WHEN s IS NULL THEN 'ok' ELSE 'FAIL' END)||' no Stripe reference created');
  -- Reconciliation: charge.net_collected = sum(verified) for manual-only charge
  SELECT (SELECT net_collected FROM payments WHERE id=ch) = (SELECT sum(amount) FROM payment_collections WHERE payment_id=ch AND status='verified') INTO PROCEDURE_ok;
  INSERT INTO t_out(line) VALUES ((CASE WHEN PROCEDURE_ok THEN 'ok' ELSE 'FAIL' END)||' collected total equals verified records');
  SELECT count(*) INTO n FROM audit_log WHERE entity_type='payment_collection';
  INSERT INTO t_out(line) VALUES ('audit entries written: '||n);
END $t$;

RESET ROLE;
SELECT line FROM t_out ORDER BY n;
ROLLBACK;
