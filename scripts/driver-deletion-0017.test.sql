-- Rolled-back role-context test for migration 0017 (driver deletion security repair).
-- Runs as one DO block and always ends with RAISE EXCEPTION so every fixture is rolled back.
DO $t$
DECLARE
  own uuid := '15604112-1a62-4907-a92c-09045ee70ca6';
  mgr uuid := '194cec09-2d93-42d0-a5a7-04e8c931d7de';
  drv uuid := 'd4abe15b-8230-4597-837e-7e0449db364a';
  a uuid; w uuid; r uuid; p uuid; tc uuid; l uuid; v uuid;
  out text := ''; n int; res jsonb; h0 text; hb text; ha text; who record;
  pay0 bigint; fin0 bigint; aud0 bigint; wl0 bigint;
BEGIN
  SELECT md5(string_agg(row_to_json(x)::text, ',' ORDER BY id)) INTO h0 FROM applications x;
  SELECT count(*) INTO pay0 FROM payments; SELECT count(*) INTO fin0 FROM financial_transactions;
  SELECT count(*) INTO aud0 FROM audit_log; SELECT count(*) INTO wl0 FROM waitlist;

  INSERT INTO applications(full_name,email,phone) VALUES ('Zz T A','zz-a@invalid.example','0') RETURNING id INTO a;
  INSERT INTO applications(full_name,email,phone) VALUES ('Zz T W','zz-w@invalid.example','0') RETURNING id INTO w;
  INSERT INTO applications(full_name,email,phone) VALUES ('Zz T R','zz-r@invalid.example','0') RETURNING id INTO r;
  INSERT INTO applications(full_name,email,phone) VALUES ('Zz T P','zz-p@invalid.example','0') RETURNING id INTO p;
  INSERT INTO applications(full_name,email,phone) VALUES ('Zz T T','zz-t@invalid.example','0') RETURNING id INTO tc;
  INSERT INTO applications(full_name,email,phone) VALUES ('Zz T L','zz-l@invalid.example','0') RETURNING id INTO l;
  INSERT INTO application_waitlist_holds(application_id,added_at,added_by) VALUES (w,'2026-01-01T00:00:00Z',mgr);
  INSERT INTO waitlist(full_name,email,promoted_application_id) VALUES ('Zz T W','zz-w@invalid.example',w);
  SET LOCAL session_replication_role = replica;  -- fixture only: bypass vehicle/rental guards
  INSERT INTO vehicles(year,make,model) VALUES (2020,'Zz','Test') RETURNING id INTO v;
  INSERT INTO rentals(driver_id,application_id,vehicle_id,status) VALUES (r,r,v,'active');
  SET LOCAL session_replication_role = origin;
  INSERT INTO payments(driver_id,amount,status,type) VALUES (p,100,'unpaid','rent');
  INSERT INTO toll_charges(application_id,vehicle_id,occurred_at,status,amount) VALUES (tc,v,now(),'assigned',5);
  INSERT INTO user_roles(user_id,role) VALUES (drv,'coordinator');  -- test-only Coordinator

  -- 1. Direct deletes by every role (applications + waitlist)
  FOR who IN SELECT * FROM (VALUES ('Owner',own::text,'authenticated'),('Manager',mgr::text,'authenticated'),
      ('Coordinator',drv::text,'authenticated'),('Driver',drv::text,'authenticated'),('SignedOut',NULL,'anon')) s(label,uid,rl) LOOP
    IF who.label = 'Driver' THEN DELETE FROM user_roles WHERE user_id = drv AND role = 'coordinator'; END IF;
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub',who.uid,'role',who.rl)::text, true);
      EXECUTE format('SET LOCAL ROLE %I', who.rl);
      DELETE FROM applications WHERE id = a; GET DIAGNOSTICS n = ROW_COUNT;
      out := out || who.label || ' direct delete app: ' || n || ' row(s); ';
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN RESET ROLE; out := out || who.label || ' direct delete app: refused (' || SQLSTATE || '); '; END;
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub',who.uid,'role',who.rl)::text, true);
      EXECUTE format('SET LOCAL ROLE %I', who.rl);
      DELETE FROM waitlist WHERE promoted_application_id = w; GET DIAGNOSTICS n = ROW_COUNT;
      out := out || 'waitlist: ' || n || E' row(s)\n';
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN RESET ROLE; out := out || 'waitlist: refused (' || SQLSTATE || E')\n'; END;
    IF who.label <> 'SignedOut' THEN
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub',who.uid,'role','authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        res := public.soft_delete_application(a, 'role test');
        out := out || '  ' || who.label || ' Delete Driver fn: ' || res::text || E'\n';
        IF who.label = 'Owner' THEN res := public.restore_application(a); out := out || '  Owner Restore: ' || res::text || E'\n'; END IF;
        RESET ROLE;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; out := out || '  ' || who.label || ' Delete Driver fn: refused (' || SQLERRM || E')\n'; END;
    END IF;
  END LOOP;

  -- 2. Owner flows
  PERFORM set_config('request.jwt.claims', json_build_object('sub',own,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  out := out || 'Active rental delete: ' || public.soft_delete_application(r,'t')::text || E'\n';
  out := out || 'Unpaid payment delete: ' || public.soft_delete_application(p,'t')::text || E'\n';
  out := out || 'Open charge delete: ' || public.soft_delete_application(tc,'t')::text || E'\n';
  out := out || 'Waitlist delete: ' || public.soft_delete_application(w,'t')::text || E'\n';
  out := out || 'Waitlist delete repeat: ' || public.soft_delete_application(w,'t')::text || E'\n';
  out := out || 'Waitlist restore: ' || public.restore_application(w)::text || E'\n';
  out := out || 'Waitlist restore repeat: ' || public.restore_application(w)::text || E'\n';
  PERFORM public.soft_delete_application(l,'t');
  PERFORM public.set_legal_hold(l,true);
  out := out || 'Purge on Legal Hold: ' || public.purge_application(l)::text || E'\n';
  PERFORM public.set_legal_hold(l,false);
  out := out || 'Purge after hold cleared: ' || (public.purge_application(l) - 'removed' - 'retained_documents')::text || E'\n';
  out := out || 'Purge repeat: ' || public.purge_application(l)::text || E'\n';
  RESET ROLE;

  SELECT count(*) INTO n FROM application_waitlist_holds WHERE application_id = w;
  out := out || 'Waitlist holds rows: ' || n;
  SELECT count(*) INTO n FROM application_waitlist_holds WHERE application_id = w AND removed_at IS NULL AND added_at = '2026-01-01T00:00:00Z';
  out := out || ', open with original priority: ' || n;
  SELECT count(*) INTO n FROM waitlist WHERE promoted_application_id = w;
  out := out || ', waitlist link rows: ' || n || E'\n';
  SELECT count(*) INTO n FROM applications WHERE id IN (a,w,r,p,tc,l) AND deleted_at IS NULL;
  out := out || 'Fixtures active: ' || n || ' of 6 (A,W restored; R,P,T blocked)' || E'\n';
  SELECT string_agg(action, '>' ORDER BY created_at, action) INTO hb FROM deletion_events WHERE application_id = w;
  out := out || 'Waitlist driver events: ' || coalesce(hb,'') || E'\n';
  SELECT md5(string_agg(row_to_json(x)::text, ',' ORDER BY id)) INTO ha FROM applications x WHERE id NOT IN (a,w,r,p,tc,l);
  out := out || 'Other drivers byte-identical: ' || (ha = h0) || E'\n';
  out := out || 'Payments delta: ' || ((SELECT count(*) FROM payments) - pay0) || ' (1 fixture), financial delta: ' || ((SELECT count(*) FROM financial_transactions) - fin0)
       || ', audit delta: ' || ((SELECT count(*) FROM audit_log) - aud0) || ', waitlist delta: ' || ((SELECT count(*) FROM waitlist) - wl0) || ' (1 fixture)';
  RAISE EXCEPTION E'ROLLED BACK. RESULTS:\n%', out;
END $t$;
