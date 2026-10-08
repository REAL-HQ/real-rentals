-- Post-apply rolled-back test for live Phase B guards (migration 0021).
-- this transaction only, runs every scenario on throwaway fixtures, then ends
-- with RAISE EXCEPTION so the guards and all fixtures are rolled back.
DO $t$
DECLARE
  own uuid := '15604112-1a62-4907-a92c-09045ee70ca6';
  mgr uuid := '194cec09-2d93-42d0-a5a7-04e8c931d7de';
  drv uuid := 'd4abe15b-8230-4597-837e-7e0449db364a';
  a uuid; b uuid; v uuid; rid uuid; res text; who record; n int;
  out text := ''; h0 text; h1 text; s0 text; s1 text; aud0 bigint; pay0 bigint; fin0 bigint;
BEGIN
  SELECT md5(string_agg((to_jsonb(x)-'updated_at')::text, ',' ORDER BY id)) INTO h0 FROM applications x;
  SELECT md5(coalesce(string_agg(row_to_json(x)::text, ',' ORDER BY id),'')) INTO s0 FROM driver_screenings x;
  SELECT count(*) INTO aud0 FROM audit_log; SELECT count(*) INTO pay0 FROM payments; SELECT count(*) INTO fin0 FROM financial_transactions;

  -- Install the proposed guards (same SQL as phase-b-active-guard.proposed.sql).

  -- Fixtures
  INSERT INTO applications(full_name,email,phone,status,user_id) VALUES ('Zz B A','zz-ba@invalid.example','0','approved',drv) RETURNING id INTO a;
  INSERT INTO applications(full_name,email,phone,status) VALUES ('Zz B B','zz-bb@invalid.example','0','approved') RETURNING id INTO b;
  INSERT INTO vehicles(year,make,model,vin,weekly_rate) VALUES (2020,'Toyota','Camry','JTDBR32E720000001',350) RETURNING id INTO v;

  -- 1. Manual Active (service level) refused
  BEGIN UPDATE applications SET status='active' WHERE id=b; out := out || '1 manual active: ALLOWED (FAIL)'||E'\n';
  EXCEPTION WHEN OTHERS THEN out := out || '1 manual active: refused ('||SQLERRM||')'||E'\n'; END;
  BEGIN INSERT INTO applications(full_name,email,phone,status) VALUES ('Zz B C','zz-bc@invalid.example','0','active'); out := out || '1b insert as active: ALLOWED (FAIL)'||E'\n';
  EXCEPTION WHEN OTHERS THEN out := out || '1b insert as active: refused'||E'\n'; END;

  -- 7. Role checks: each staff role attempting manual Active via the Data API path
  FOR who IN SELECT * FROM (VALUES ('Owner',own),('Manager',mgr),('Driver',drv)) x(label,uid) LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub',who.uid,'role','authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      UPDATE applications SET status='active' WHERE id=b; GET DIAGNOSTICS n = ROW_COUNT;
      RESET ROLE;
      out := out || '7 '||who.label||' manual active: '||CASE WHEN n=0 THEN 'no rows visible/updated (blocked by RLS)' ELSE 'ALLOWED (FAIL)' END||E'\n';
    EXCEPTION WHEN OTHERS THEN RESET ROLE; out := out || '7 '||who.label||' manual active: refused ('||SQLERRM||')'||E'\n'; END;
  END LOOP;
  -- Owner can still make legitimate stage edits
  PERFORM set_config('request.jwt.claims', json_build_object('sub',own,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE applications SET status='reviewing' WHERE id=b; GET DIAGNOSTICS n = ROW_COUNT; RESET ROLE;
  out := out || '7 Owner normal stage edit (approved->reviewing): '||CASE WHEN n=1 THEN 'ok' ELSE 'FAIL' END||E'\n';
  UPDATE applications SET status='approved' WHERE id=b;

  -- 4. Approved applicant without rental is not Active
  out := out || '4 approved without rental active? '||EXISTS(SELECT 1 FROM rentals WHERE application_id=b AND status='active')||' / stage='||(SELECT status FROM applications WHERE id=b)||E'\n';

  -- 4b. Terminated rentals (cancelled / voided / closed) never count as running
  INSERT INTO rentals(driver_id,vehicle_id,application_id,start_date,status,weekly_rate) VALUES
    (drv,v,b,current_date-30,'cancelled',350),(drv,v,b,current_date-20,'voided',350),(drv,v,b,current_date-10,'closed',350);
  BEGIN UPDATE applications SET status='active' WHERE id=b; out := out || '4b active with only terminated rentals: ALLOWED (FAIL)'||E'\n';
  EXCEPTION WHEN OTHERS THEN out := out || '4b active with only cancelled/voided/closed rentals: refused'||E'\n'; END;
  DELETE FROM rentals WHERE application_id=b;

  -- 2. Legitimate rental start produces Active
  BEGIN
    rid := activate_rental_tx(a, v, drv, 350, NULL, false, current_date, NULL, NULL, own);
    out := out || '2 activate_rental_tx: ok; stage='||(SELECT status FROM applications WHERE id=a)||', running rental='||EXISTS(SELECT 1 FROM rentals WHERE id=rid AND status='active')||E'\n';
  EXCEPTION WHEN OTHERS THEN out := out || '2 activate_rental_tx: FAILED ('||SQLERRM||')'||E'\n'; END;

  -- 3b. Screening Active Renter: refused without rental, allowed with one
  SET LOCAL session_replication_role = replica;  -- fixture rows only (skip pipeline prerequisites)
  INSERT INTO driver_screenings(lead_id,status) VALUES (a,'pickup_scheduled'),(b,'pickup_scheduled');
  SET LOCAL session_replication_role = origin;
  BEGIN UPDATE driver_screenings SET status='active_renter' WHERE lead_id=b; out := out || '3 screening active_renter w/o rental: ALLOWED (FAIL)'||E'\n';
  EXCEPTION WHEN OTHERS THEN out := out || '3 screening active_renter w/o rental: refused'||E'\n'; END;
  BEGIN
    ALTER TABLE driver_screenings DISABLE TRIGGER driver_screenings_pipeline;  -- isolate the new guard
    UPDATE driver_screenings SET status='active_renter' WHERE lead_id=a;
    ALTER TABLE driver_screenings ENABLE TRIGGER driver_screenings_pipeline;
    out := out || '3 screening active_renter with running rental: allowed'||E'\n';
  EXCEPTION WHEN OTHERS THEN out := out || '3 screening with rental: FAILED ('||SQLERRM||')'||E'\n'; END;

  -- 5. Overdue / partial / failed payments do not change Active
  INSERT INTO payments(driver_id,rental_id,amount,balance_due,status,type,due_date) VALUES
    (a,rid,350,350,'unpaid','rent',current_date-14),(a,rid,350,100,'overdue','rent',current_date-7),(a,rid,350,350,'failed','rent',current_date);
  out := out || '5 with overdue/partial/failed payments: stage='||(SELECT status FROM applications WHERE id=a)||', running rental='||EXISTS(SELECT 1 FROM rentals WHERE id=rid AND status='active')||E'\n';

  -- 3. Ending the rental removes Active
  BEGIN
    res := end_rental_tx(rid, current_date, 'available', NULL, own);
    out := out || '3 end_rental_tx: '||res||'; stage='||(SELECT status FROM applications WHERE id=a)||', running rental='||EXISTS(SELECT 1 FROM rentals WHERE application_id=a AND status='active')||E'\n';
  EXCEPTION WHEN OTHERS THEN out := out || '3 end_rental_tx: FAILED ('||SQLERRM||')'||E'\n'; END;
  BEGIN UPDATE applications SET status='active' WHERE id=a; out := out || '3b re-mark active after end: ALLOWED (FAIL)'||E'\n';
  EXCEPTION WHEN OTHERS THEN out := out || '3b re-mark active after end: refused'||E'\n'; END;

  -- 6. Existing records (incl. the 8) untouched; their other edits still work
  UPDATE applications SET notes = notes WHERE status='active' AND id NOT IN (a,b);
  GET DIAGNOSTICS n = ROW_COUNT;
  out := out || '6 non-status edit on existing Marked-Active rows: ok ('||n||' rows, stage unchanged)'||E'\n';
  DELETE FROM payments WHERE driver_id=a; DELETE FROM driver_screenings WHERE lead_id IN (a,b);
  SELECT md5(string_agg((to_jsonb(x)-'updated_at')::text, ',' ORDER BY id)) INTO h1 FROM applications x WHERE id NOT IN (a,b);
  SELECT md5(coalesce(string_agg(row_to_json(x)::text, ',' ORDER BY id),'')) INTO s1 FROM driver_screenings x;
  out := out || '6 real applications byte-identical (excl. updated_at touch): '||(h1 = h0)||'; screenings identical: '||(s1 = s0)||E'\n';
  out := out || 'deltas before rollback: audit '||((SELECT count(*) FROM audit_log)-aud0)||', payments '||((SELECT count(*) FROM payments)-pay0)||', financial '||((SELECT count(*) FROM financial_transactions)-fin0);
  RAISE EXCEPTION E'ROLLED BACK. RESULTS:\n%', out;
END $t$;
