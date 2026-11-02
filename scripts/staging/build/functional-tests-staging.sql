-- Functional tests, single submission (staging + local). Synthetic STAGING-ONLY rows (fake names, *.invalid emails, fixed test UUIDs).
-- Each test runs in a subtransaction as the given role/JWT; "refused" = error OR zero rows affected (RLS-hidden).
DO $g$ BEGIN IF (SELECT system_identifier::text FROM pg_control_system()) IN ('7642734024280108049','7692130048193495360') THEN RAISE EXCEPTION 'refused: production/old staging'; END IF; IF current_setting('rr.target', true) IS NULL AND (SELECT system_identifier::text FROM pg_control_system()) <> '7702070854497379551' AND current_setting('port') <> '55499' THEN RAISE EXCEPTION 'refused: not staging or local'; END IF; END $g$;
CREATE TEMP TABLE ft(n serial, name text, expect text, got text, err text);
CREATE FUNCTION pg_temp.t(_name text, _expect text, _role text, _uid uuid, _sql text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE rc bigint; got text; e text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role',_role)::text, true);
    PERFORM set_config('role', _role, true);
    EXECUTE _sql; GET DIAGNOSTICS rc = ROW_COUNT;
    PERFORM set_config('role', 'none', true);
    got := CASE WHEN _sql ~* '^\s*(update|delete)' AND rc = 0 THEN 'refused(0 rows)' ELSE 'allowed' END;
  EXCEPTION WHEN OTHERS THEN got := 'refused'; e := SQLERRM; END;
  PERFORM set_config('role', 'none', true);
  INSERT INTO ft(name,expect,got,err) VALUES (_name,_expect,got,left(e,120));
END $f$;
DO $fx$ BEGIN
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-0000000000a1','staging-owner@test.invalid'),('00000000-0000-0000-0000-0000000000a2','staging-manager@test.invalid'),('00000000-0000-0000-0000-0000000000a3','staging-coordinator@test.invalid'),('00000000-0000-0000-0000-0000000000d1','staging-driver@test.invalid');
INSERT INTO public.user_roles(user_id,role) VALUES ('00000000-0000-0000-0000-0000000000a1','admin'),('00000000-0000-0000-0000-0000000000a2','team'),('00000000-0000-0000-0000-0000000000a3','coordinator'),('00000000-0000-0000-0000-0000000000d1','driver');
INSERT INTO public.applications(id,full_name,email,phone,status,user_id) VALUES ('10000000-0000-0000-0000-000000000001','STAGING TEST Driver (fake)','staging-driver@test.invalid','5550000000','reviewing','00000000-0000-0000-0000-0000000000d1');
INSERT INTO public.vehicles(id,year,make,model,vin,weekly_rate,status) VALUES ('20000000-0000-0000-0000-000000000001',2022,'STAGINGTEST','FakeModel','4T1BF1FK5CU123456',350,'available');
INSERT INTO public.documents(driver_id,kind,category,storage_bucket,storage_path,is_current,review_status) VALUES
 ('10000000-0000-0000-0000-000000000001','license_front','license_front','staging-test','fake/p1',true,'verified'),('10000000-0000-0000-0000-000000000001','license_back','license_back','staging-test','fake/p2',true,'verified'),('10000000-0000-0000-0000-000000000001','insurance','insurance','staging-test','fake/p3',true,'uploaded');
INSERT INTO public.agreements(application_id,body,source,status,signed_at) VALUES ('10000000-0000-0000-0000-000000000001','STAGING TEST agreement (fake)','rental','signed',now());
INSERT INTO public.driver_screenings(lead_id,interview_completed_at) VALUES ('10000000-0000-0000-0000-000000000001',now());
INSERT INTO public.inspections(vehicle_id,inspection_type,status) VALUES ('20000000-0000-0000-0000-000000000001','pre_delivery','passed');
INSERT INTO public.payments(id,driver_id,type,amount,balance_due,status,notes) VALUES ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','rent',350,350,'upcoming','STAGING TEST (fake)');
END $fx$;
SELECT pg_temp.t('coordinator cannot approve application','refused','authenticated','00000000-0000-0000-0000-0000000000a3',$q$UPDATE public.applications SET status='approved' WHERE id='10000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.t('manager browser session cannot approve directly','refused','authenticated','00000000-0000-0000-0000-0000000000a2',$q$UPDATE public.applications SET status='approved' WHERE id='10000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.t('driver cannot change own application status','refused','authenticated','00000000-0000-0000-0000-0000000000d1',$q$UPDATE public.applications SET status='approved' WHERE id='10000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.t('server (service_role) approves application','allowed','service_role',NULL,$q$UPDATE public.applications SET status='approved' WHERE id='10000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.t('coordinator cannot set insurance verification','refused','authenticated','00000000-0000-0000-0000-0000000000a3',$q$SELECT public.set_insurance_verification('10000000-0000-0000-0000-000000000001',true,'ok')$q$);
SELECT pg_temp.t('driver cannot write insurance_verified directly','refused','authenticated','00000000-0000-0000-0000-0000000000d1',$q$UPDATE public.driver_screenings SET insurance_verified=true WHERE lead_id='10000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.t('service_role cannot write insurance_verified directly','refused','service_role',NULL,$q$UPDATE public.driver_screenings SET insurance_verified=true WHERE lead_id='10000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.t('activation refused while insurance unverified (exception OFF)','refused','service_role',NULL,$q$SELECT public.activate_rental_checked_tx('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1',350,0,false,current_date,NULL,NULL,'00000000-0000-0000-0000-0000000000a2',false,'{"summary":"STAGING TEST"}'::jsonb)$q$);
SELECT pg_temp.t('activation refused with ack while exception OFF','refused','service_role',NULL,$q$SELECT public.activate_rental_checked_tx('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1',350,0,false,current_date,NULL,NULL,'00000000-0000-0000-0000-0000000000a2',true,'{"summary":"STAGING TEST"}'::jsonb)$q$);
SELECT pg_temp.t('browser session cannot call checked activation','refused','authenticated','00000000-0000-0000-0000-0000000000a2',$q$SELECT public.activate_rental_checked_tx('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1',350,0,false,current_date,NULL,NULL,'00000000-0000-0000-0000-0000000000a2',false,'{"summary":"STAGING TEST"}'::jsonb)$q$);
SELECT pg_temp.t('manager cannot flip insurance exception setting','refused','authenticated','00000000-0000-0000-0000-0000000000a2',$q$SELECT public.set_rental_activation_insurance_exception(true)$q$);
SELECT pg_temp.t('service_role cannot write rental_activation setting directly','refused','service_role',NULL,$q$UPDATE public.app_settings SET value='{"allow_activation_without_insurance_verification":true}' WHERE key='rental_activation'$q$);
SELECT pg_temp.t('owner setter callable (sets exception to false; stays OFF)','allowed','authenticated','00000000-0000-0000-0000-0000000000a1',$q$SELECT public.set_rental_activation_insurance_exception(false)$q$);
SELECT pg_temp.t('manager sets insurance verification via setter','allowed','authenticated','00000000-0000-0000-0000-0000000000a2',$q$SELECT public.set_insurance_verification('10000000-0000-0000-0000-000000000001',true,'STAGING TEST policy checked')$q$);
SELECT pg_temp.t('server activation succeeds once verified','allowed','service_role',NULL,$q$SELECT public.activate_rental_checked_tx('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1',350,0,false,current_date,NULL,NULL,'00000000-0000-0000-0000-0000000000a2',false,'{"summary":"STAGING TEST"}'::jsonb)$q$);
SELECT pg_temp.t('manager browser cannot mark payment paid','refused','authenticated','00000000-0000-0000-0000-0000000000a2',$q$UPDATE public.payments SET status='paid' WHERE id='30000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.t('server records a payment (paid)','allowed','service_role',NULL,$q$UPDATE public.payments SET status='paid', balance_due=0, paid_date=current_date WHERE id='30000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.t('manager browser cannot void payment','refused','authenticated','00000000-0000-0000-0000-0000000000a2',$q$UPDATE public.payments SET status='void', reason='x' WHERE id='30000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.t('manager can add an owed charge','allowed','authenticated','00000000-0000-0000-0000-0000000000a2',$q$INSERT INTO public.payments(driver_id,type,amount,balance_due,status,notes) VALUES ('10000000-0000-0000-0000-000000000001','fee',25,25,'upcoming','STAGING TEST (fake)')$q$);
SELECT pg_temp.t('manager cannot insert a paid row','refused','authenticated','00000000-0000-0000-0000-0000000000a2',$q$INSERT INTO public.payments(driver_id,type,amount,balance_due,status) VALUES ('10000000-0000-0000-0000-000000000001','fee',25,0,'paid')$q$);
SELECT pg_temp.t('server voids payment with reason','allowed','service_role',NULL,$q$UPDATE public.payments SET status='void', reason='STAGING TEST recorded in error' WHERE id='30000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.t('manager cannot delete payment','refused','authenticated','00000000-0000-0000-0000-0000000000a2',$q$DELETE FROM public.payments WHERE id='30000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.t('service_role cannot delete payment','refused','service_role',NULL,$q$DELETE FROM public.payments WHERE id='30000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.t('anon cannot read payments','refused','anon',NULL,$q$SELECT 1/(SELECT count(*) FROM public.payments)::int$q$);
SELECT jsonb_build_object('pass',(SELECT count(*) FROM ft WHERE split_part(got,'(',1)=expect),'fail',(SELECT count(*) FROM ft WHERE split_part(got,'(',1)<>expect),
 'tests',(SELECT jsonb_agg(jsonb_build_object('n',n,'name',name,'expect',expect,'got',got,'err',err) ORDER BY n) FROM ft),
 'end_state',(SELECT a.status||'|'||(SELECT count(*) FROM public.rentals WHERE application_id=a.id AND status='active')||'|'||(SELECT status FROM public.payments WHERE id='30000000-0000-0000-0000-000000000001')||'|'||(SELECT count(*) FROM public.payments) FROM public.applications a WHERE id='10000000-0000-0000-0000-000000000001'),
 'exception_setting',(SELECT value FROM public.app_settings WHERE key='rental_activation')) AS result;
