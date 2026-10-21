-- LOCAL VERSIONED AMENDMENT. Outside migration discovery. Requires reviewed issuer and
-- approval executor roles, actual RLS/ACL acceptance, and Storage guard installed separately.
-- No backfill, grants to API roles, changes to approval lifecycle, or application activation.
ALTER TABLE public.documents ADD COLUMN integrity_v1 jsonb;
ALTER TABLE public.application_identity_reviews ADD COLUMN positive_evidence_v1 jsonb;
ALTER TABLE public.application_identity_reviews DROP CONSTRAINT application_identity_reviews_resolution_check;
ALTER TABLE public.application_identity_reviews ADD CONSTRAINT application_identity_reviews_resolution_check CHECK (
 (kind='positive_license_v1' AND status='resolved' AND resolution='verified' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND positive_evidence_v1 IS NOT NULL)
 OR (kind<>'positive_license_v1' AND positive_evidence_v1 IS NULL AND (resolution IS NULL OR resolution IN ('same_person','different_person','dismissed'))));

CREATE FUNCTION private.document_integrity_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'document_truncate_denied'; END IF;
 IF TG_OP<>'INSERT' AND OLD.integrity_v1 IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'bound_document_immutable'; END IF;
  IF ROW(NEW.id,NEW.driver_id,NEW.storage_bucket,NEW.storage_path,NEW.content_sha256,NEW.integrity_v1)
    IS DISTINCT FROM ROW(OLD.id,OLD.driver_id,OLD.storage_bucket,OLD.storage_path,OLD.content_sha256,OLD.integrity_v1)
  THEN RAISE EXCEPTION 'bound_document_immutable'; END IF;
 END IF;
 IF TG_OP<>'DELETE' AND NEW.integrity_v1 IS NOT NULL AND (TG_OP='INSERT' OR OLD.integrity_v1 IS NULL)
 AND current_user<>'rr_evidence_issuer' THEN RAISE EXCEPTION 'trusted_document_issuer_required'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER document_integrity_v1 BEFORE INSERT OR UPDATE OR DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION private.document_integrity_guard_v1();
CREATE TRIGGER document_integrity_truncate_v1 BEFORE TRUNCATE ON public.documents FOR EACH STATEMENT EXECUTE FUNCTION private.document_integrity_guard_v1();

-- Only the trusted server transport may invoke this after hashing authoritative bytes.
-- Existing signed artifacts can be adopted into a new write-once content-addressed path;
-- original document IDs and access metadata are preserved. No automatic historical adoption.
CREATE FUNCTION private.bind_document_integrity_v1(d uuid, expected_document jsonb, sha text, immutable_path text, agreement uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE doc public.documents; a public.applications; ag public.agreements; binding jsonb;
BEGIN
 IF current_user<>'rr_evidence_issuer' THEN RAISE EXCEPTION 'trusted_document_issuer_required'; END IF;
 PERFORM private.approval_lock(); PERFORM private.approval_actor(); PERFORM private.record_session_v1();
 PERFORM 1 FROM public.user_roles WHERE user_id=private.approval_actor() AND role IN ('admin','team') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'manager_required'; END IF;
 SELECT * INTO doc FROM public.documents WHERE id=d FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'document_missing'; END IF;
 IF sha IS NULL OR sha !~ '^[0-9a-f]{64}$' OR immutable_path IS DISTINCT FROM ('immutable-v1/'||d::text||'/'||sha||'.pdf') THEN RAISE EXCEPTION 'invalid_content_address'; END IF;
 IF doc.integrity_v1 IS NOT NULL THEN
  IF doc.content_sha256=sha AND doc.storage_path=immutable_path AND (doc.integrity_v1->>'agreement') IS NOT DISTINCT FROM agreement::text THEN RETURN doc.integrity_v1; END IF;
  RAISE EXCEPTION 'document_already_bound';
 END IF;
 IF expected_document IS NULL OR to_jsonb(doc) IS DISTINCT FROM to_jsonb(jsonb_populate_record(NULL::public.documents,expected_document)) THEN RAISE EXCEPTION 'document_changed'; END IF;
 IF doc.content_sha256 IS NOT NULL AND doc.content_sha256 IS DISTINCT FROM sha THEN RAISE EXCEPTION 'document_hash_mismatch'; END IF;
 SELECT * INTO a FROM public.applications WHERE id=doc.driver_id FOR SHARE;
 IF NOT FOUND OR a.user_id IS NULL THEN RAISE EXCEPTION 'linked_driver_required'; END IF;
 binding:=jsonb_build_object('version',sha,'sha256',sha,'application',a.id,'driver',a.user_id,'agreement',agreement,'bucket',doc.storage_bucket,'path',immutable_path);
 IF agreement IS NOT NULL THEN
  SELECT * INTO ag FROM public.agreements WHERE id=agreement FOR SHARE;
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

CREATE FUNCTION private.license_snapshot_v1(app uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE a public.applications; docs jsonb; n integer;
BEGIN
 SELECT * INTO a FROM public.applications WHERE id=app FOR UPDATE;
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

CREATE FUNCTION private.positive_review_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'reviews_truncate_denied'; END IF;
 IF TG_OP<>'INSERT' AND OLD.kind='positive_license_v1' THEN RAISE EXCEPTION 'positive_review_immutable'; END IF;
 IF TG_OP<>'DELETE' AND (NEW.kind='positive_license_v1' OR NEW.positive_evidence_v1 IS NOT NULL) AND current_user<>'rr_approval_executor' THEN RAISE EXCEPTION 'verification_rpc_required'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER positive_review_v1 BEFORE INSERT OR UPDATE OR DELETE ON public.application_identity_reviews FOR EACH ROW EXECUTE FUNCTION private.positive_review_guard_v1();
CREATE TRIGGER positive_review_truncate_v1 BEFORE TRUNCATE ON public.application_identity_reviews FOR EACH STATEMENT EXECUTE FUNCTION private.positive_review_guard_v1();

CREATE FUNCTION private.verify_license_v1(app uuid, expected jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE actor uuid; snap jsonb; rid uuid;
BEGIN
 IF current_user<>'rr_approval_executor' THEN RAISE EXCEPTION 'verification_executor_required'; END IF;
 PERFORM private.approval_lock();
 snap:=private.license_snapshot_v1(app);
 actor:=private.approval_actor(); PERFORM private.record_session_v1();
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role IN ('admin','team') FOR SHARE;
 IF NOT FOUND OR private.approval_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'manager_required'; END IF;
 IF expected IS NULL OR snap IS DISTINCT FROM expected THEN RAISE EXCEPTION 'review_evidence_stale'; END IF;
 INSERT INTO public.application_identity_reviews(application_id,kind,status,resolution,resolved_by,resolved_at,positive_evidence_v1)
 VALUES(app,'positive_license_v1','resolved','verified',actor,clock_timestamp(),snap) RETURNING id INTO rid;
 INSERT INTO public.audit_log(actor_user_id,action,entity_type,entity_id,summary,metadata)
 VALUES(actor,'identity_review.positive_license_v1','application',app::text,'Positive license verification',jsonb_build_object('review_id',rid));
 RETURN rid;
END $$;
CREATE FUNCTION private.validate_license_v1(app uuid) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE snap jsonb; rid uuid;
BEGIN
 PERFORM private.approval_lock(); PERFORM private.approval_actor(); PERFORM private.record_session_v1();
 snap:=private.license_snapshot_v1(app);
 SELECT id INTO rid FROM public.application_identity_reviews WHERE application_id=app AND kind='positive_license_v1' AND positive_evidence_v1=snap AND status='resolved' AND resolution='verified' ORDER BY resolved_at DESC,id DESC LIMIT 1;
 IF rid IS NULL THEN RAISE EXCEPTION 'positive_verification_required'; END IF; RETURN rid;
END $$;
REVOKE ALL ON FUNCTION private.license_snapshot_v1(uuid),private.verify_license_v1(uuid,jsonb),private.validate_license_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.license_snapshot_v1(uuid),private.verify_license_v1(uuid,jsonb),private.validate_license_v1(uuid) TO rr_approval_executor;
-- No blanket grants, role memberships, SECURITY DEFINER RPC or replacement of approval_validate.
-- Consumption mapping and narrowly scoped RLS/column ACLs need acceptance before installation.
-- Serialize material writers with verification, including newly inserted current documents.
CREATE FUNCTION private.integrity_serialize_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN PERFORM private.approval_lock(); RETURN NULL; END $$;
CREATE TRIGGER integrity_serialize_v1 BEFORE INSERT OR UPDATE OR DELETE ON public.applications FOR EACH STATEMENT EXECUTE FUNCTION private.integrity_serialize_v1();
CREATE TRIGGER integrity_serialize_v1 BEFORE INSERT OR UPDATE OR DELETE ON public.documents FOR EACH STATEMENT EXECUTE FUNCTION private.integrity_serialize_v1();
CREATE TRIGGER integrity_serialize_v1 BEFORE INSERT OR UPDATE OR DELETE ON public.application_identity_reviews FOR EACH STATEMENT EXECUTE FUNCTION private.integrity_serialize_v1();
CREATE TRIGGER integrity_serialize_v1 BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles FOR EACH STATEMENT EXECUTE FUNCTION private.integrity_serialize_v1();
CREATE TRIGGER integrity_serialize_v1 BEFORE INSERT OR UPDATE OR DELETE ON public.agreements FOR EACH STATEMENT EXECUTE FUNCTION private.integrity_serialize_v1();
CREATE FUNCTION private.positive_audit_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='TRUNCATE' OR (TG_OP<>'INSERT' AND OLD.action='identity_review.positive_license_v1') THEN RAISE EXCEPTION 'positive_audit_immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER positive_audit_v1 BEFORE UPDATE OR DELETE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION private.positive_audit_guard_v1();
CREATE TRIGGER positive_audit_truncate_v1 BEFORE TRUNCATE ON public.audit_log FOR EACH STATEMENT EXECUTE FUNCTION private.positive_audit_guard_v1();

CREATE FUNCTION private.signed_binding_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'signed_agreements_truncate_denied'; END IF;
 IF EXISTS(SELECT 1 FROM public.documents WHERE integrity_v1->>'agreement'=OLD.id::text) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'signed_binding_immutable'; END IF;
  IF ROW(NEW.id,NEW.application_id,NEW.vehicle_id,NEW.document_id,NEW.completed_document_id,NEW.sha256,NEW.body_sha256,NEW.body,NEW.merge_data,NEW.signed_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.application_id,OLD.vehicle_id,OLD.document_id,OLD.completed_document_id,OLD.sha256,OLD.body_sha256,OLD.body,OLD.merge_data,OLD.signed_at)
  THEN RAISE EXCEPTION 'signed_binding_immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER signed_binding_v1 BEFORE UPDATE OR DELETE ON public.agreements FOR EACH ROW EXECUTE FUNCTION private.signed_binding_guard_v1();
CREATE TRIGGER signed_binding_truncate_v1 BEFORE TRUNCATE ON public.agreements FOR EACH STATEMENT EXECUTE FUNCTION private.signed_binding_guard_v1();
-- Restrictive AND policy: existing permissive staff policies cannot expose positive reviews.
-- Existing conflict-review behavior is retained; no new permissive access is created.
CREATE POLICY positive_review_privacy_v1 ON public.application_identity_reviews AS RESTRICTIVE FOR ALL TO authenticated
 USING (kind<>'positive_license_v1' OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role IN ('admin','team')))
 WITH CHECK (kind<>'positive_license_v1');
