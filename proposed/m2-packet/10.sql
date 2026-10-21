-- LOCAL ONLY: successor approval permission portion; issuer V2 installed first.
-- No new privileged function, memberships, bypass, table-wide grants, or lifecycle changes.
GRANT USAGE ON SCHEMA private,public TO rr_approval_executor;
GRANT EXECUTE ON FUNCTION private.approval_actor(),private.approval_lock(),private.record_session_v1(),private.license_snapshot_v1(uuid),private.verify_license_v1(uuid,jsonb),private.validate_license_v1(uuid) TO rr_approval_executor;
CREATE FUNCTION private.record_approval_scope_v3(app uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_user<>'rr_approval_executor' OR app IS NULL OR app IS DISTINCT FROM nullif(current_setting('record.application_id',true),'')::uuid THEN RETURN false; END IF;
 PERFORM private.approval_actor(); PERFORM private.record_session_v1(); RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.record_approval_scope_v3(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.record_approval_scope_v3(uuid) TO rr_approval_executor;
CREATE OR REPLACE FUNCTION private.license_snapshot_v1(app uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE a record; docs jsonb; n integer;
BEGIN
 SELECT id,user_id,deleted_at,full_name,dob,license_number,license_state,license_expiration INTO a FROM public.applications WHERE id=app FOR UPDATE;
 IF NOT FOUND OR a.user_id IS NULL OR a.deleted_at IS NOT NULL OR nullif(btrim(a.license_number),'') IS NULL OR nullif(btrim(a.license_state),'') IS NULL
 OR a.license_expiration IS NULL OR NOT isfinite(a.license_expiration) OR a.license_expiration<(clock_timestamp() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'license_invalid'; END IF;
 IF EXISTS(SELECT 1 FROM public.application_identity_reviews WHERE application_id=app AND kind<>'positive_license_v1' AND (status='open' OR resolution='different_person')) THEN RAISE EXCEPTION 'identity_conflict'; END IF;
 PERFORM 1 FROM public.documents WHERE driver_id=app AND category IN ('license_front','license_back') ORDER BY id FOR SHARE;
 SELECT count(*), jsonb_agg(jsonb_build_object('id',id,'category',category,'hash',content_sha256,'binding',integrity_v1,'reviewer',reviewed_by,'reviewed_at',reviewed_at) ORDER BY category,id) INTO n,docs
 FROM public.documents WHERE driver_id=app AND category IN ('license_front','license_back') AND is_current IS TRUE AND superseded_by IS NULL
 AND review_status='verified' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND integrity_v1 IS NOT NULL
 AND integrity_v1->>'sha256'=content_sha256 AND integrity_v1->>'application'=app::text AND integrity_v1->>'driver'=a.user_id::text;
 IF n<>2 OR (SELECT count(*) FROM public.documents WHERE driver_id=app AND category='license_front' AND is_current IS TRUE)<>1
 OR (SELECT count(*) FROM public.documents WHERE driver_id=app AND category='license_back' AND is_current IS TRUE)<>1 THEN RAISE EXCEPTION 'current_verified_documents_required'; END IF;
 RETURN jsonb_build_object('application',app,'driver',a.user_id,'name',a.full_name,'dob',a.dob,'license_number',a.license_number,'license_state',a.license_state,'license_expiration',a.license_expiration,'documents',docs);
END $$;


GRANT SELECT(id,user_id,deleted_at,full_name,dob,license_number,license_state,license_expiration), UPDATE(id) ON public.applications TO rr_approval_executor;
GRANT SELECT(id,driver_id,category,is_current,superseded_by,review_status,reviewed_by,reviewed_at,content_sha256,integrity_v1), UPDATE(id) ON public.documents TO rr_approval_executor;
GRANT SELECT(user_id,role), UPDATE(user_id) ON public.user_roles TO rr_approval_executor;
GRANT SELECT(id,application_id,kind,status,resolution,positive_evidence_v1,resolved_at) ON public.application_identity_reviews TO rr_approval_executor;
GRANT INSERT(application_id,kind,status,resolution,resolved_by,resolved_at,positive_evidence_v1) ON public.application_identity_reviews TO rr_approval_executor;
GRANT INSERT(actor_user_id,action,entity_type,entity_id,summary,metadata) ON public.audit_log TO rr_approval_executor;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY approval_scope_permissive_v3 ON public.applications AS PERMISSIVE FOR ALL TO rr_approval_executor USING (private.record_approval_scope_v3(id)) WITH CHECK (private.record_approval_scope_v3(id));
CREATE POLICY approval_scope_restrictive_v3 ON public.applications AS RESTRICTIVE FOR ALL TO rr_approval_executor USING (private.record_approval_scope_v3(id)) WITH CHECK (private.record_approval_scope_v3(id));
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY approval_scope_permissive_v3 ON public.documents AS PERMISSIVE FOR ALL TO rr_approval_executor USING (private.record_approval_scope_v3(driver_id)) WITH CHECK (private.record_approval_scope_v3(driver_id));
CREATE POLICY approval_scope_restrictive_v3 ON public.documents AS RESTRICTIVE FOR ALL TO rr_approval_executor USING (private.record_approval_scope_v3(driver_id)) WITH CHECK (private.record_approval_scope_v3(driver_id));
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY approval_scope_permissive_v3 ON public.user_roles AS PERMISSIVE FOR ALL TO rr_approval_executor USING (user_id=private.approval_actor() AND role IN ('admin','team') AND private.record_approval_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid)) WITH CHECK (user_id=private.approval_actor() AND role IN ('admin','team') AND private.record_approval_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid));
CREATE POLICY approval_scope_restrictive_v3 ON public.user_roles AS RESTRICTIVE FOR ALL TO rr_approval_executor USING (user_id=private.approval_actor() AND role IN ('admin','team') AND private.record_approval_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid)) WITH CHECK (user_id=private.approval_actor() AND role IN ('admin','team') AND private.record_approval_scope_v3(nullif(current_setting('record.application_id',true),'')::uuid));
ALTER TABLE public.application_identity_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY approval_scope_permissive_v3 ON public.application_identity_reviews AS PERMISSIVE FOR ALL TO rr_approval_executor USING (private.record_approval_scope_v3(application_id)) WITH CHECK (private.record_approval_scope_v3(application_id));
CREATE POLICY approval_scope_restrictive_v3 ON public.application_identity_reviews AS RESTRICTIVE FOR ALL TO rr_approval_executor USING (private.record_approval_scope_v3(application_id)) WITH CHECK (private.record_approval_scope_v3(application_id));
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY approval_scope_permissive_v3 ON public.audit_log AS PERMISSIVE FOR ALL TO rr_approval_executor USING (actor_user_id=private.approval_actor() AND action='identity_review.positive_license_v1' AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid)) WITH CHECK (actor_user_id=private.approval_actor() AND action='identity_review.positive_license_v1' AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid));
CREATE POLICY approval_scope_restrictive_v3 ON public.audit_log AS RESTRICTIVE FOR ALL TO rr_approval_executor USING (actor_user_id=private.approval_actor() AND action='identity_review.positive_license_v1' AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid)) WITH CHECK (actor_user_id=private.approval_actor() AND action='identity_review.positive_license_v1' AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid));
