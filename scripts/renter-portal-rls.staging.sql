-- Staging-only RLS rehearsal for the renter portal. Synthetic rows, all
-- inside one transaction that always ends in RAISE (so it rolls back).
-- Never run against production.
DO $t$
DECLARE
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uc uuid := gen_random_uuid();
  ud uuid := gen_random_uuid(); ue uuid := gen_random_uuid();
  va uuid; vb uuid; vc uuid; vd uuid; ab uuid; ac uuid; ad uuid; ra uuid; rb uuid; rc uuid; rd uuid;
  ma uuid; mb uuid; mc uuid; md uuid; dreg uuid; dins_old uuid; dins_new uuid; dtitle uuid;
  s jsonb; n int; ok boolean; res text := '';
  PROCEDURE_ok text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (ua,'rp-a@example.test'),(ub,'rp-b@example.test'),(uc,'rp-c@example.test'),(ud,'rp-d@example.test'),(ue,'rp-e@example.test');
  INSERT INTO public.vehicles (status,year,make,model,license_plate,vin,registration_state,registration_number,registration_expires_on,insurance_policy_number)
    VALUES ('maintenance',2020,'SynthA','Car','SYN-A01','1SYNTHAAAAAAAAAA1','GA','REG-A','2027-01-01','POL-A') RETURNING id INTO va;
  INSERT INTO public.vehicles (status,year,make,model,license_plate,vin,registration_state,registration_number,registration_expires_on,insurance_policy_number)
    VALUES ('maintenance',2021,'SynthB','Car','SYN-B02','1SYNTHBBBBBBBBBB2','GA','REG-B','2027-02-01','POL-B') RETURNING id INTO vb;
  INSERT INTO public.vehicles (status,year,make,model,license_plate,vin) VALUES ('maintenance',2019,'SynthC','Car','SYN-C03','1SYNTHCCCCCCCCCC3') RETURNING id INTO vc;
  INSERT INTO public.vehicles (status,year,make,model,license_plate,vin) VALUES ('maintenance',2019,'SynthD','Car','SYN-D04','1SYNTHDDDDDDDDDD4') RETURNING id INTO vd;
  INSERT INTO public.applications (email,full_name,phone,user_id) VALUES ('rp-b@example.test','Synthetic B','5550000002',ub) RETURNING id INTO ab;
  INSERT INTO public.applications (email,full_name,phone,user_id) VALUES ('rp-c@example.test','Synthetic C','5550000003',uc) RETURNING id INTO ac;
  INSERT INTO public.applications (email,full_name,phone,user_id) VALUES ('rp-d@example.test','Synthetic D','5550000004',ud) RETURNING id INTO ad;

  PERFORM set_config('app.rental_tx','on',true); -- synthetic setup only, tx-local
  INSERT INTO public.rentals (driver_id,vehicle_id,status) VALUES (ua,va,'pending') RETURNING id INTO ra;
  INSERT INTO public.rentals (driver_id,vehicle_id,status,start_date) VALUES (ub,vb,'active',current_date-10) RETURNING id INTO rb;
  INSERT INTO public.rentals (driver_id,vehicle_id,status,start_date,end_date) VALUES (uc,vc,'returned',current_date-800,current_date-400) RETURNING id INTO rc;
  INSERT INTO public.rentals (driver_id,vehicle_id,status,start_date,end_date) VALUES (ud,vd,'returned',current_date-200,current_date-90) RETURNING id INTO rd;

  INSERT INTO public.condition_media (vehicle_id,rental_id,phase,storage_bucket,storage_path) VALUES (va,ra,'check_in','condition','a.jpg') RETURNING id INTO ma;
  INSERT INTO public.condition_media (vehicle_id,rental_id,phase,storage_bucket,storage_path) VALUES (vb,rb,'check_in','condition','b.jpg') RETURNING id INTO mb;
  INSERT INTO public.condition_media (vehicle_id,rental_id,phase,storage_bucket,storage_path) VALUES (vc,rc,'check_out','condition','c.jpg') RETURNING id INTO mc;
  INSERT INTO public.condition_media (vehicle_id,rental_id,phase,storage_bucket,storage_path) VALUES (vd,rd,'check_out','condition','d.jpg') RETURNING id INTO md;
  INSERT INTO public.payments (driver_id,vehicle_id,rental_id,type,amount,status,paid_date) VALUES
    (ab,vb,rb,'rent',350,'paid',current_date-3),(ac,vc,rc,'rent',300,'paid',current_date-420),(ad,vd,rd,'rent',300,'paid',current_date-100),(ab,vb,rb,'rent',350,'pending',null);

  INSERT INTO public.documents (vehicle_id,kind,category,storage_bucket,storage_path,visibility,is_current) VALUES (vb,'registration','registration','vehicle-docs','reg-b.pdf',ARRAY['admin'],true) RETURNING id INTO dreg;
  INSERT INTO public.documents (vehicle_id,kind,category,storage_bucket,storage_path,visibility,is_current) VALUES (vb,'title','title','vehicle-docs','title-b.pdf',ARRAY['admin'],true) RETURNING id INTO dtitle;
  INSERT INTO public.documents (driver_id,kind,category,storage_bucket,storage_path,visibility,is_current,review_status) VALUES (ab,'insurance','insurance','driver-docs','ins-old.pdf',ARRAY['admin','driver'],false,'verified') RETURNING id INTO dins_old;
  INSERT INTO public.documents (driver_id,kind,category,storage_bucket,storage_path,visibility,is_current,review_status) VALUES (ab,'insurance','insurance','driver-docs','ins-new.pdf',ARRAY['admin','driver'],true,'uploaded') RETURNING id INTO dins_new;
  INSERT INTO public.renter_vendors (category,name,phone,sort_order,is_active) VALUES ('locksmith','Synth Lock',null,1,true),('car_wash','Synth Wash (hidden)',null,2,false);

  PERFORM set_config('app.rental_tx','off',true);
  PERFORM set_config('role','authenticated',true);

  -- A: assigned
  PERFORM set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  s := public.renter_portal_summary();
  res := res || format('A stage=%s plate=%s vin=%s keys=%s | ', s->>'stage', s->>'plate', s->>'vin',
    (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(s) k));
  SELECT count(*) INTO n FROM public.renter_portal_file('photo', ma); res := res || 'A own photo=' || n || ' | ';
  SELECT count(*) INTO n FROM public.renter_vendors; res := res || 'A vendors=' || n || ' | ';

  -- B: active
  PERFORM set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true);
  s := public.renter_portal_summary();
  res := res || format('B stage=%s plate=%s reg#=%s regfiles=%s ins=%s photos=%s receipts=%s | ', s->>'stage', s->>'plate',
    s#>>'{registration,number}', jsonb_array_length(s#>'{registration,files}'), jsonb_array_length(s->'insurance'),
    jsonb_array_length(s->'photos'), jsonb_array_length(s->'receipts'));
  SELECT count(*) INTO n FROM public.renter_portal_file('registration', dreg); res := res || 'B reg file=' || n || ' ';
  SELECT count(*) INTO n FROM public.renter_portal_file('registration', dtitle); res := res || 'B title file=' || n || ' ';
  SELECT count(*) INTO n FROM public.renter_portal_file('insurance', dins_old); res := res || 'B old verified ins=' || n || ' ';
  SELECT count(*) INTO n FROM public.renter_portal_file('photo', mb); res := res || 'B own photo=' || n || ' ';
  SELECT count(*) INTO n FROM public.renter_portal_file('photo', ma); res := res || 'B other photo=' || n || ' ';
  SELECT count(*) INTO n FROM public.renter_portal_file('photo', md); res := res || 'B other photo2=' || n || ' ';
  SELECT count(*) INTO n FROM public.renter_vendors; res := res || 'B vendors=' || n || ' ';
  INSERT INTO public.renter_portal_prefs (user_id, vendor_view) VALUES (ub,'list');
  SELECT count(*) INTO n FROM public.renter_portal_prefs; res := res || 'B prefs visible=' || n || ' ';
  BEGIN INSERT INTO public.renter_portal_prefs (user_id) VALUES (ua); res := res || 'B write A prefs=ALLOWED(BAD) ';
  EXCEPTION WHEN insufficient_privilege THEN res := res || 'B write A prefs=denied '; END;
  BEGIN INSERT INTO public.renter_vendors (category,name) VALUES ('other','evil'); res := res || 'B vendor insert=ALLOWED(BAD) ';
  EXCEPTION WHEN insufficient_privilege THEN res := res || 'B vendor insert=denied '; END;
  UPDATE public.renter_vendors SET name='x'; GET DIAGNOSTICS n = ROW_COUNT; res := res || 'B vendor update rows=' || n || ' | ';

  -- C: returned > 1 year
  PERFORM set_config('request.jwt.claims', json_build_object('sub',uc,'role','authenticated')::text, true);
  s := public.renter_portal_summary();
  res := res || format('C stage=%s plate=%s photos=%s receipts=%s ', s->>'stage', s->>'plate', s->'photos', s->'receipts');
  SELECT count(*) INTO n FROM public.renter_portal_file('photo', mc); res := res || 'C own photo=' || n || ' | ';

  -- D: returned 90 days
  PERFORM set_config('request.jwt.claims', json_build_object('sub',ud,'role','authenticated')::text, true);
  s := public.renter_portal_summary();
  res := res || format('D stage=%s plate=%s vin=%s photos=%s receipts=%s ', s->>'stage', s->>'plate', s->>'vin',
    jsonb_array_length(s->'photos'), jsonb_array_length(s->'receipts'));
  SELECT count(*) INTO n FROM public.renter_portal_file('photo', md); res := res || 'D own photo=' || n || ' ';
  SELECT count(*) INTO n FROM public.renter_portal_file('photo', mb); res := res || 'D B photo=' || n || ' | ';

  -- E: no rental
  PERFORM set_config('request.jwt.claims', json_build_object('sub',ue,'role','authenticated')::text, true);
  s := public.renter_portal_summary();
  SELECT count(*) INTO n FROM public.renter_vendors;
  res := res || format('E stage=%s vendors=%s ', s->>'stage', n);
  SELECT count(*) INTO n FROM public.renter_portal_file('photo', mb); res := res || 'E B photo=' || n;

  RAISE EXCEPTION 'RESULT(rolled back): %', res;
END $t$;
