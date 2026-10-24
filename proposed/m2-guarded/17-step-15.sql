-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- Scope acc', 'eptance pending. A hosted run follows proposed/HOSTED-INSTALL.md.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), '2811723d90af140694be6ea8434139f4a349b4b934885352f33a616e48bca0e6', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '2811723d90af140694be6ea8434139f4a349b4b934885352f33a616e48bca0e6';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 10096), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) 'b8fde7718e9893c3ed97dd0066808c6d02a921de15fccc7ff5514976753472a2';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 10096) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- Scope acceptance pending. A hosted run follows proposed/HOSTED-INSTALL.md.
GRANT USAGE ON SCHEMA private,public TO rr_record_executor;
GRANT EXECUTE ON FUNCTION private.approval_actor(),private.approval_lock(),private.record_session_v1(),private.validate_license_v1(uuid),private.license_snapshot_v1(uuid)
 TO rr_record_executor;
GRANT EXECUTE ON FUNCTION public.end_rental_safe_v1(uuid,date,text,integer,uuid,text) TO rr_record_executor;
GRANT SELECT(id,user_id,status,deleted_at) ON public.applications TO rr_record_executor;
GRANT UPDATE(id) ON public.applications TO rr_record_executor;
GRANT SELECT(id,status,archived_at) ON public.vehicles TO rr_record_executor;
GRANT UPDATE(id) ON public.vehicles TO rr_record_executor;
GRANT SELECT(user_id,role), UPDATE(user_id) ON public.user_roles TO rr_record_executor;
GRANT SELECT(id,application_id,driver_id,vehicle_id,status,start_date,end_date,pickup_reading_id) ON public.rentals TO rr_record_executor;
GRANT UPDATE(id,deposit_amount,deposit_held,next_payment_due,stripe_customer_id,stripe_subscription_id,pickup_reading_id,return_reading_id)
 ON public.rentals TO rr_record_executor;
GRANT SELECT(id,vehicle_id,status,observed_on,mileage) ON public.odometer_readings TO rr_record_executor;
GRANT INSERT(vehicle_id,mileage,observed_on,observed_at,source_type,source_id,evidence_key,entered_by,rental_id,driver_id)
 ON public.odometer_readings TO rr_record_executor;
GRANT INSERT(actor_user_id,actor_role,action,entity_type,entity_id,summary,metadata) ON public.audit_log TO rr_record_executor;

GRANT SELECT(user_id,deleted_at,full_name,dob,license_number,license_state,license_expiration) ON public.applications TO rr_record_executor;
GRANT SELECT(id,driver_id,category,is_current,superseded_by,review_status,reviewed_by,reviewed_at,content_sha256,integrity_v1), UPDATE(id) ON public.documents TO rr_record_executor;
GRANT SELECT(id,application_id,kind,status,resolution,positive_evidence_v1,resolved_at) ON public.application_identity_reviews TO rr_record_executor;
GRANT SELECT(id) ON public.odometer_readings TO rr_record_executor;
CREATE FUNCTION private.record_executor_scope_v3(app uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_user<>'rr_record_executor' OR app IS NULL OR app IS DISTINCT FROM nullif(current_setting('record.application_id',true),'')::uuid THEN RETURN false; END IF;
 PERFORM private.approval_actor(); PERFORM private.record_session_v1(); RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.record_executor_scope_v3(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.record_executor_scope_v3(uuid) TO rr_record_executor;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY record_scope_permissive_v3 ON public.applications AS PERMISSIVE FOR ALL TO rr_record_executor USING (private.record_executor_scope_v3(id)) WITH CHECK (private.record_executor_scope_v3(id));
CREATE POLICY record_scope_restrictive_v3 ON public.applications AS RESTRICTIVE FOR ALL TO rr_record_executor USING (private.record_executor_scope_v3(id)) WITH CHECK (private.record_executor_scope_v3(id));
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY record_scope_permissive_v3 ON public.documents AS PERMISSIVE FOR ALL TO rr_record_executor USING (private.record_executor_scope_v3(driver_id)) WITH CHECK (private.record_executor_scope_v3(driver_id));
CREATE POLICY record_scope_restrictive_v3 ON public.documents AS RESTRICTIVE FOR ALL TO rr_record_executor USING (private.record_executor_scope_v3(driver_id)) WITH CHECK (private.record_executor_scope_v3(driver_id));
ALTER TABLE public.application_identity_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY record_scope_permissive_v3 ON public.application_identity_reviews AS PERMISSIVE FOR ALL TO rr_record_executor USING (private.record_executor_scope_v3(application_id)) WITH CHECK (private.record_executor_scope_v3(application_id));
CREATE POLICY record_scope_restrictive_v3 ON public.application_identity_reviews AS RESTRICTIVE FOR ALL TO rr_record_executor USING (private.record_executor_scope_v3(application_id)) WITH CHECK (private.record_executor_scope_v3(application_id));
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY record_scope_permissive_v3 ON public.user_roles AS PERMISSIVE FOR ALL TO rr_record_executor USING (user_id=private.approval_actor() AND role IN ('admin','team') AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid)) WITH CHECK (user_id=private.approval_actor() AND role IN ('admin','team') AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid));
CREATE POLICY record_scope_restrictive_v3 ON public.user_roles AS RESTRICTIVE FOR ALL TO rr_record_executor USING (user_id=private.approval_actor() AND role IN ('admin','team') AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid)) WITH CHECK (user_id=private.approval_actor() AND role IN ('admin','team') AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid));
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY record_scope_permissive_v3 ON public.vehicles AS PERMISSIVE FOR ALL TO rr_record_executor USING (id=nullif(current_setting('record.vehicle_id',true),'')::uuid AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid)) WITH CHECK (id=nullif(current_setting('record.vehicle_id',true),'')::uuid AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid));
CREATE POLICY record_scope_restrictive_v3 ON public.vehicles AS RESTRICTIVE FOR ALL TO rr_record_executor USING (id=nullif(current_setting('record.vehicle_id',true),'')::uuid AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid)) WITH CHECK (id=nullif(current_setting('record.vehicle_id',true),'')::uuid AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid));
ALTER TABLE public.rentals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odometer_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY record_scope_permissive_v3 ON public.odometer_readings AS PERMISSIVE FOR ALL TO rr_record_executor USING (vehicle_id=nullif(current_setting('record.vehicle_id',true),'')::uuid AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid)) WITH CHECK (vehicle_id=nullif(current_setting('record.vehicle_id',true),'')::uuid AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid));
CREATE POLICY record_scope_restrictive_v3 ON public.odometer_readings AS RESTRICTIVE FOR ALL TO rr_record_executor USING (vehicle_id=nullif(current_setting('record.vehicle_id',true),'')::uuid AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid)) WITH CHECK (vehicle_id=nullif(current_setting('record.vehicle_id',true),'')::uuid AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid));
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY record_scope_permissive_v3 ON public.audit_log AS PERMISSIVE FOR ALL TO rr_record_executor USING (actor_user_id=private.approval_actor() AND action IN ('rental.recorded_existing','rental.closed_recorded_v2') AND entity_type='rental' AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid)) WITH CHECK (actor_user_id=private.approval_actor() AND action IN ('rental.recorded_existing','rental.closed_recorded_v2') AND entity_type='rental' AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid));
CREATE POLICY record_scope_restrictive_v3 ON public.audit_log AS RESTRICTIVE FOR ALL TO rr_record_executor USING (actor_user_id=private.approval_actor() AND action IN ('rental.recorded_existing','rental.closed_recorded_v2') AND entity_type='rental' AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid)) WITH CHECK (actor_user_id=private.approval_actor() AND action IN ('rental.recorded_existing','rental.closed_recorded_v2') AND entity_type='rental' AND private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid));

GRANT EXECUTE ON FUNCTION public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid) TO rr_record_executor;
CREATE POLICY record_read_permissive_v3 ON public.rentals AS PERMISSIVE FOR SELECT TO rr_record_executor USING (private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid) AND (application_id=nullif(current_setting('record.application_id',true),'')::uuid OR vehicle_id IS NULL OR vehicle_id=nullif(current_setting('record.vehicle_id',true),'')::uuid OR driver_id=(SELECT user_id FROM public.applications WHERE id=nullif(current_setting('record.application_id',true),'')::uuid)));
CREATE POLICY record_write_permissive_v3 ON public.rentals AS PERMISSIVE FOR UPDATE TO rr_record_executor USING (private.record_executor_scope_v3(application_id)) WITH CHECK (private.record_executor_scope_v3(application_id));
CREATE POLICY record_read_restrictive_v3 ON public.rentals AS RESTRICTIVE FOR SELECT TO rr_record_executor USING (private.record_executor_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid) AND (application_id=nullif(current_setting('record.application_id',true),'')::uuid OR vehicle_id IS NULL OR vehicle_id=nullif(current_setting('record.vehicle_id',true),'')::uuid OR driver_id=(SELECT user_id FROM public.applications WHERE id=nullif(current_setting('record.application_id',true),'')::uuid)));
CREATE POLICY record_write_restrictive_v3 ON public.rentals AS RESTRICTIVE FOR UPDATE TO rr_record_executor USING (private.record_executor_scope_v3(application_id)) WITH CHECK (private.record_executor_scope_v3(application_id));
