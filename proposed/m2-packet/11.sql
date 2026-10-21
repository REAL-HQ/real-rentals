-- LOCAL PROVISIONAL, not approved for hosting. Scope acceptance pending.
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
