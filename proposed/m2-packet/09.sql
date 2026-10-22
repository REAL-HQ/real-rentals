-- LOCAL PROPOSAL ONLY. Versioned successor to the issuer portion of operational permissions v1.
-- Requires document-identity-v2 and evidence-consumer-v2; no automatic migrations.
-- Dedicated trusted server connection must SET LOCAL record.application_id after authenticating.
-- No API role receives membership or grants. Existing function remains SECURITY INVOKER.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='rr_evidence_issuer' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls) THEN
 RAISE EXCEPTION 'dedicated_issuer_required'; END IF;
END $$;
GRANT USAGE ON SCHEMA public,private TO rr_evidence_issuer;
GRANT EXECUTE ON FUNCTION private.approval_actor(),private.approval_lock(),private.record_session_v1() TO rr_evidence_issuer;
CREATE FUNCTION private.record_issuer_scope_v2(app uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_user<>'rr_evidence_issuer' OR app IS NULL OR app IS DISTINCT FROM nullif(current_setting('record.application_id',true),'')::uuid THEN RETURN false; END IF;
 PERFORM private.approval_actor(); PERFORM private.record_session_v1(); RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.record_issuer_scope_v2(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.record_issuer_scope_v2(uuid) TO rr_evidence_issuer;
CREATE OR REPLACE FUNCTION private.bind_document_integrity_v1(d uuid, expected_document jsonb, sha text, immutable_path text, agreement uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE doc record; a record; ag record; binding jsonb;
BEGIN
 IF current_user<>'rr_evidence_issuer' THEN RAISE EXCEPTION 'trusted_document_issuer_required'; END IF;
 PERFORM private.approval_lock(); PERFORM private.approval_actor(); PERFORM private.record_session_v1();
 PERFORM 1 FROM public.user_roles WHERE user_id=private.approval_actor() AND role IN ('admin','team') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'manager_required'; END IF;
 SELECT id,driver_id,storage_bucket,storage_path,content_sha256,integrity_v1,category,is_current,superseded_by,review_status,reviewed_by,reviewed_at INTO doc FROM public.documents WHERE id=d FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'document_missing'; END IF;
 IF sha IS NULL OR sha !~ '^[0-9a-f]{64}$' OR immutable_path IS DISTINCT FROM ('immutable-v1/'||d::text||'/'||sha||'.pdf') THEN RAISE EXCEPTION 'invalid_content_address'; END IF;
 IF doc.integrity_v1 IS NOT NULL THEN
  IF doc.content_sha256=sha AND doc.storage_path=immutable_path AND (doc.integrity_v1->>'agreement') IS NOT DISTINCT FROM agreement::text THEN RETURN doc.integrity_v1; END IF;
  RAISE EXCEPTION 'document_already_bound';
 END IF;
 IF expected_document IS NULL OR to_jsonb(doc) IS DISTINCT FROM (SELECT jsonb_object_agg(k, to_jsonb(jsonb_populate_record(NULL::public.documents,expected_document))->k) FROM jsonb_object_keys(to_jsonb(doc)) k) THEN RAISE EXCEPTION 'document_changed'; END IF;
 IF doc.content_sha256 IS NOT NULL AND doc.content_sha256 IS DISTINCT FROM sha THEN RAISE EXCEPTION 'document_hash_mismatch'; END IF;
 SELECT id,user_id INTO a FROM public.applications WHERE id=doc.driver_id FOR SHARE;
 IF NOT FOUND OR a.user_id IS NULL THEN RAISE EXCEPTION 'linked_driver_required'; END IF;
 binding:=jsonb_build_object('version',sha,'sha256',sha,'application',a.id,'driver',a.user_id,'agreement',agreement,'bucket',doc.storage_bucket,'path',immutable_path);
 IF agreement IS NOT NULL THEN
  SELECT id,status,voided_at,signed_at,document_id,completed_document_id,application_id,vehicle_id,sha256,body_sha256,body,merge_data INTO ag FROM public.agreements WHERE id=agreement FOR SHARE;
  IF NOT FOUND OR ag.status IS DISTINCT FROM 'signed' OR ag.voided_at IS NOT NULL OR ag.signed_at IS NULL
    OR ag.document_id IS DISTINCT FROM d OR ag.completed_document_id IS DISTINCT FROM d OR ag.application_id IS DISTINCT FROM a.id
    OR ag.vehicle_id IS NULL OR ag.sha256 IS DISTINCT FROM sha OR ag.body_sha256 IS NULL
  THEN RAISE EXCEPTION 'signed_agreement_mismatch'; END IF;
  binding:=binding||jsonb_build_object('vehicle',ag.vehicle_id,'signed_at',ag.signed_at,'body_sha256',ag.body_sha256,'body',ag.body,'merge_data',ag.merge_data);
 END IF;
 UPDATE public.documents SET content_sha256=sha,storage_path=immutable_path,integrity_v1=binding WHERE id=d;
 RETURN binding;
END $$;
REVOKE ALL ON FUNCTION private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid) TO rr_evidence_issuer;

GRANT SELECT(id,driver_id,storage_bucket,storage_path,content_sha256,integrity_v1,category,is_current,superseded_by,review_status,reviewed_by,reviewed_at) ON public.documents TO rr_evidence_issuer;
GRANT UPDATE(content_sha256,storage_path,integrity_v1) ON public.documents TO rr_evidence_issuer;
GRANT SELECT(id,user_id), UPDATE(id) ON public.applications TO rr_evidence_issuer;
GRANT SELECT(id,status,voided_at,signed_at,document_id,completed_document_id,application_id,vehicle_id,sha256,body_sha256,body,merge_data), UPDATE(id) ON public.agreements TO rr_evidence_issuer;
GRANT SELECT(user_id,role), UPDATE(user_id) ON public.user_roles TO rr_evidence_issuer;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY issuer_scope_allow_v2 ON public.documents AS PERMISSIVE FOR ALL TO rr_evidence_issuer USING (private.record_issuer_scope_v2(driver_id)) WITH CHECK (private.record_issuer_scope_v2(driver_id));
CREATE POLICY issuer_scope_limit_v2 ON public.documents AS RESTRICTIVE FOR ALL TO rr_evidence_issuer USING (private.record_issuer_scope_v2(driver_id)) WITH CHECK (private.record_issuer_scope_v2(driver_id));
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY issuer_scope_allow_v2 ON public.applications AS PERMISSIVE FOR ALL TO rr_evidence_issuer USING (private.record_issuer_scope_v2(id)) WITH CHECK (private.record_issuer_scope_v2(id));
CREATE POLICY issuer_scope_limit_v2 ON public.applications AS RESTRICTIVE FOR ALL TO rr_evidence_issuer USING (private.record_issuer_scope_v2(id)) WITH CHECK (private.record_issuer_scope_v2(id));
ALTER TABLE public.agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY issuer_scope_allow_v2 ON public.agreements AS PERMISSIVE FOR ALL TO rr_evidence_issuer USING (private.record_issuer_scope_v2(application_id)) WITH CHECK (private.record_issuer_scope_v2(application_id));
CREATE POLICY issuer_scope_limit_v2 ON public.agreements AS RESTRICTIVE FOR ALL TO rr_evidence_issuer USING (private.record_issuer_scope_v2(application_id)) WITH CHECK (private.record_issuer_scope_v2(application_id));
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY issuer_scope_allow_v2 ON public.user_roles AS PERMISSIVE FOR ALL TO rr_evidence_issuer USING (user_id=private.approval_actor() AND role IN ('admin','team') AND private.record_issuer_scope_v2(nullif(current_setting('record.application_id',true),'')::uuid)) WITH CHECK (user_id=private.approval_actor() AND role IN ('admin','team') AND private.record_issuer_scope_v2(nullif(current_setting('record.application_id',true),'')::uuid));
CREATE POLICY issuer_scope_limit_v2 ON public.user_roles AS RESTRICTIVE FOR ALL TO rr_evidence_issuer USING (user_id=private.approval_actor() AND role IN ('admin','team') AND private.record_issuer_scope_v2(nullif(current_setting('record.application_id',true),'')::uuid)) WITH CHECK (user_id=private.approval_actor() AND role IN ('admin','team') AND private.record_issuer_scope_v2(nullif(current_setting('record.application_id',true),'')::uuid));
