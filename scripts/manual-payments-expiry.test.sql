-- Rolled-back regression test for the 48-hour expiry in scripts/phase-c-manual-payments.proposed.sql.
-- Run: psql -v ON_ERROR_STOP=1 -f scripts/manual-payments-expiry.test.sql   (ends in ROLLBACK; nothing persists)
BEGIN;
\i scripts/phase-c-manual-payments.proposed.sql
DO $t$
DECLARE
  own uuid := '15604112-1a62-4907-a92c-09045ee70ca6';
  mgr uuid := '194cec09-2d93-42d0-a5a7-04e8c931d7de';
  a uuid; ch uuid; old uuid; p2 uuid; n int; s text; fin0 bigint; aud0 bigint;
  PROCEDURE_ok boolean;
BEGIN
  SELECT count(*) INTO fin0 FROM financial_transactions;
  INSERT INTO applications(full_name,email,phone,status) VALUES ('Zz Exp','zz-exp@invalid.example','0','approved') RETURNING id INTO a;
  INSERT INTO payments(driver_id,amount,balance_due,status,type,due_date) VALUES (a,350,350,'unpaid','rent',current_date) RETURNING id INTO ch;
  -- A pending entry whose 48h deadline has already passed (recorded by Owner).
  INSERT INTO payment_collections(payment_id,driver_id,purpose,method,amount,received_on,reference_raw,status,recorded_by,recorded_at,expires_at,idempotency_key)
  VALUES (ch,a,'rent','zelle',200,current_date,'ZX-1','pending',own,now()-interval '49 hours',now()-interval '1 hour','t-old') RETURNING id INTO old;
  SELECT count(*) INTO aud0 FROM audit_log WHERE entity_id = old::text;

  -- 1. Stale pending no longer reserves, even before the sweep runs.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',mgr,'role','authenticated')::text, true); EXECUTE 'SET LOCAL ROLE authenticated';
  p2 := collection_record(ch,'venmo',300,current_date,'VN-9',NULL,NULL,NULL,'t-p2');
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'PASS 1 stale reservation released (300 recorded against 350)';

  -- 2. Background sweep with no user session.
  PERFORM set_config('request.jwt.claims', '', true);
  n := collection_expire_due();
  SELECT status INTO s FROM payment_collections WHERE id = old;
  IF n <> 1 OR s <> 'expired' THEN RAISE EXCEPTION 'FAIL 2 sweep n=% s=%', n, s; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE entity_id = old::text AND action='payment_expired' AND actor_role='system' AND summary <> '') THEN
    RAISE EXCEPTION 'FAIL 2 audit row'; END IF;
  RAISE NOTICE 'PASS 2 sweep expired 1 row with system audit entry (no session)';

  -- 3. Duplicate reference against an expired entry is refused.
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub',mgr,'role','authenticated')::text, true); EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM collection_record(ch,'zelle',20,current_date,'zx 1',NULL,NULL,NULL,'t-dup');
    RAISE EXCEPTION 'FAIL 3 duplicate accepted';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 3 duplicate reference refused';
  END;
  EXECUTE 'RESET ROLE';

  -- 4. Reconcile rechecks availability (300 live pending + 200 > 350).
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub',mgr,'role','authenticated')::text, true); EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM collection_reconcile(old,'Found in statement');
    RAISE EXCEPTION 'FAIL 4 over-allocation reconciled';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Amount is more%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 4 reconcile refused over-allocation';
  END;
  EXECUTE 'RESET ROLE';

  -- 5. Reject the other, reconcile succeeds on the SAME row, Manager verifies Owner's entry.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',own,'role','authenticated')::text, true); EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM collection_reject(p2,'Not received');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',mgr,'role','authenticated')::text, true); EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM collection_reconcile(old,'Found in Zelle statement');
  PERFORM collection_verify(old,true,'Zelle statement line 10-08',NULL);
  EXECUTE 'RESET ROLE';
  IF (SELECT balance_due FROM payments WHERE id=ch) <> 150 THEN RAISE EXCEPTION 'FAIL 5 balance'; END IF;
  IF (SELECT count(*) FROM payment_collections WHERE payment_id=ch) <> 2 THEN RAISE EXCEPTION 'FAIL 5 extra rows'; END IF;
  RAISE NOTICE 'PASS 5 reconcile reused row; verified; balance 350 -> 150; no new payment rows';

  -- 6. History immutable.
  BEGIN UPDATE payment_collections SET amount = 1 WHERE id = old; RAISE EXCEPTION 'FAIL 6 edit';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM payment_collections WHERE id = old; RAISE EXCEPTION 'FAIL 6 delete';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN UPDATE payment_collections SET status='pending' WHERE id = old; RAISE EXCEPTION 'FAIL 6 unverify';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM audit_log WHERE entity_id = old::text) - aud0 < 3 THEN RAISE EXCEPTION 'FAIL 6 audit trail'; END IF;
  RAISE NOTICE 'PASS 6 edits/deletes/backward transitions refused; audit trail expired->reconciled->verified';

  -- 7. Verify refuses an expired pending row; Owner-only extend.
  INSERT INTO payment_collections(payment_id,driver_id,purpose,method,amount,received_on,reference_raw,status,recorded_by,expires_at,idempotency_key)
  VALUES (ch,a,'rent','check',10,current_date,'CK-5','pending',own,now()-interval '1 minute','t-late') RETURNING id INTO p2;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub',mgr,'role','authenticated')::text, true); EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM collection_verify(p2,true,'x',NULL); RAISE EXCEPTION 'FAIL 7 verified expired';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN PERFORM collection_extend(p2,'x'); RAISE EXCEPTION 'FAIL 7 manager extended';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',own,'role','authenticated')::text, true); EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM collection_extend(p2,'Driver mailed check');
  EXECUTE 'RESET ROLE';
  IF (SELECT expires_at FROM payment_collections WHERE id=p2) < now() + interval '47 hours' THEN RAISE EXCEPTION 'FAIL 7 extend'; END IF;
  RAISE NOTICE 'PASS 7 expired verify refused; Manager extend refused; Owner extend +48h';

  -- 8. No ledger side effects; sweep not callable by app users.
  IF (SELECT count(*) FROM financial_transactions) <> fin0 THEN RAISE EXCEPTION 'FAIL 8 ledger'; END IF;
  IF has_function_privilege('authenticated','public.collection_expire_due()','EXECUTE') THEN RAISE EXCEPTION 'FAIL 8 grant'; END IF;
  RAISE NOTICE 'PASS 8 no ledger rows; sweep restricted to the scheduler';
END $t$;
ROLLBACK;
