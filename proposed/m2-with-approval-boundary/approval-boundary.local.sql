-- LOCAL REVIEW PROPOSAL ONLY. Not a hosted installer; not in migration discovery.
-- Preconditions supplied by the local harness: rr_approval_executor is NOLOGIN,
-- NOSUPERUSER NOBYPASSRLS, has no application-role members, and narrowly scoped ACLs.
-- No historical rows are marked verified. Provider adapters below DENY by default.
CREATE FUNCTION private.approval_provider_actor() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
BEGIN RAISE EXCEPTION 'approval_provider_contract_unverified' USING ERRCODE='42501'; END $$;
CREATE FUNCTION private.approval_object_version(_document uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
BEGIN RAISE EXCEPTION 'approval_storage_version_unverified' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION private.approval_provider_actor(),private.approval_object_version(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.approval_provider_actor(),private.approval_object_version(uuid) TO rr_approval_executor;

ALTER TABLE public.applications ADD COLUMN approval_evidence_version bigint NOT NULL DEFAULT 0;
ALTER TABLE public.application_identity_reviews ADD COLUMN approval_evidence jsonb;
ALTER TABLE public.application_identity_reviews DROP CONSTRAINT application_identity_reviews_resolution_check;
ALTER TABLE public.application_identity_reviews ADD CONSTRAINT application_identity_reviews_resolution_check CHECK ((
 (kind='approval_identity' AND status='resolved' AND resolution='verified' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND approval_evidence IS NOT NULL AND jsonb_typeof(approval_evidence)='object' AND approval_evidence ?& ARRAY['application','version','identity','front','back'] AND jsonb_typeof(approval_evidence->'identity')='object' AND jsonb_typeof(approval_evidence->'front')='object' AND jsonb_typeof(approval_evidence->'back')='object'
 AND approval_evidence->>'application'=application_id::text AND (approval_evidence->>'version') ~ '^[0-9]+$'
 AND approval_evidence->'identity'->>'license_number' IS NOT NULL AND approval_evidence->'identity'->>'license_expiration' IS NOT NULL
 AND approval_evidence->'front' ?& ARRAY['id','bucket','path','sha256','reviewer','reviewed_at','object_version']
 AND approval_evidence->'back' ?& ARRAY['id','bucket','path','sha256','reviewer','reviewed_at','object_version']
 AND approval_evidence->'front'->>'sha256' ~ '^[0-9a-f]{64}$' AND approval_evidence->'back'->>'sha256' ~ '^[0-9a-f]{64}$'
 AND approval_evidence->'front'->>'id' IS NOT NULL AND approval_evidence->'back'->>'id' IS NOT NULL
 AND approval_evidence->'front'->>'reviewer' IS NOT NULL AND approval_evidence->'back'->>'reviewer' IS NOT NULL
 AND approval_evidence->'front'->>'reviewed_at' IS NOT NULL AND approval_evidence->'back'->>'reviewed_at' IS NOT NULL
 AND jsonb_typeof(approval_evidence->'version')='number' AND nullif(btrim(approval_evidence->'identity'->>'license_number'),'') IS NOT NULL
 AND nullif(approval_evidence->'front'->>'id','') IS NOT NULL
 AND nullif(approval_evidence->'front'->>'bucket','') IS NOT NULL
 AND nullif(approval_evidence->'front'->>'path','') IS NOT NULL
 AND nullif(approval_evidence->'front'->>'reviewer','') IS NOT NULL
 AND nullif(approval_evidence->'front'->>'reviewed_at','') IS NOT NULL
 AND approval_evidence->'front'->'object_version'->>'bucket'=approval_evidence->'front'->>'bucket'
 AND approval_evidence->'front'->'object_version'->>'path'=approval_evidence->'front'->>'path'
 AND approval_evidence->'front'->'object_version'->>'sha256'=approval_evidence->'front'->>'sha256'
 AND nullif(approval_evidence->'front'->'object_version'->>'version','') IS NOT NULL
 AND nullif(approval_evidence->'back'->>'id','') IS NOT NULL
 AND nullif(approval_evidence->'back'->>'bucket','') IS NOT NULL
 AND nullif(approval_evidence->'back'->>'path','') IS NOT NULL
 AND nullif(approval_evidence->'back'->>'reviewer','') IS NOT NULL
 AND nullif(approval_evidence->'back'->>'reviewed_at','') IS NOT NULL
 AND approval_evidence->'back'->'object_version'->>'bucket'=approval_evidence->'back'->>'bucket'
 AND approval_evidence->'back'->'object_version'->>'path'=approval_evidence->'back'->>'path'
 AND approval_evidence->'back'->'object_version'->>'sha256'=approval_evidence->'back'->>'sha256'
 AND nullif(approval_evidence->'back'->'object_version'->>'version','') IS NOT NULL)
 OR (kind<>'approval_identity' AND approval_evidence IS NULL AND (resolution IS NULL OR resolution IN ('same_person','different_person','dismissed')))) IS TRUE);

CREATE FUNCTION private.approval_actor() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE actor uuid;
BEGIN
 actor:=private.approval_provider_actor();
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role IN ('admin','team')) THEN
 RAISE EXCEPTION 'approval_manager_required' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;

-- Bounded acquisition: at most 20 waits of 25ms, not a caller-controlled setting.
-- All RPCs revalidate the actor after this lock. Row locks use NOWAIT.
CREATE FUNCTION private.approval_lock() RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 FOR attempt IN 0..20 LOOP
  IF pg_catalog.pg_try_advisory_xact_lock(82116,42001) THEN RETURN;END IF;
  IF attempt<20 THEN PERFORM pg_catalog.pg_sleep(0.025);END IF;
 END LOOP;
 RAISE EXCEPTION 'approval_contention_retry_transaction' USING ERRCODE='40001';
END $$;

-- Durable results contain no email/document payload. No application-role table grants.
CREATE TABLE private.approval_operations (
 operation_id uuid PRIMARY KEY, application_id uuid NOT NULL REFERENCES public.applications(id),
 actor_id uuid NOT NULL, evidence_version bigint NOT NULL CHECK(evidence_version>=0),
 requested_mode text NOT NULL CHECK(requested_mode IN ('approve_only','approve_invite')),
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(), transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id()
);
REVOKE ALL ON private.approval_operations FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE private.approval_operations ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION private.approval_operation_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'approval_operation_immutable' USING ERRCODE='42501';END $$;
CREATE TRIGGER immutable_operation BEFORE UPDATE OR DELETE OR TRUNCATE ON private.approval_operations FOR EACH STATEMENT EXECUTE FUNCTION private.approval_operation_immutable();

-- Conservative prototype lock: BEFORE STATEMENT, before child/parent row locks.
-- All writers (including legacy service writers) serialize. Deliberately not a GUC.
-- Coarse lock throughput and existing transactions need staging acceptance.
CREATE FUNCTION private.approval_serialize() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT pg_catalog.pg_try_advisory_xact_lock(82116,42001) THEN RAISE EXCEPTION 'approval_write_busy_retry' USING ERRCODE='40001';END IF;
 RETURN NULL; END $$;
CREATE TRIGGER approval_serialize BEFORE INSERT OR UPDATE OR DELETE ON public.applications FOR EACH STATEMENT EXECUTE FUNCTION private.approval_serialize();
CREATE TRIGGER approval_serialize BEFORE INSERT OR UPDATE OR DELETE ON public.documents FOR EACH STATEMENT EXECUTE FUNCTION private.approval_serialize();
CREATE TRIGGER approval_serialize BEFORE INSERT OR UPDATE OR DELETE ON public.application_identity_reviews FOR EACH STATEMENT EXECUTE FUNCTION private.approval_serialize();
CREATE TRIGGER approval_serialize BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles FOR EACH STATEMENT EXECUTE FUNCTION private.approval_serialize();

CREATE FUNCTION private.approval_snapshot(_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE a public.applications%ROWTYPE; f public.documents%ROWTYPE; b public.documents%ROWTYPE; fv jsonb; bv jsonb;
BEGIN
 SELECT * INTO a FROM public.applications WHERE id=_id;
 IF NOT FOUND OR a.deleted_at IS NOT NULL OR a.purged_at IS NOT NULL THEN RAISE EXCEPTION 'application_unavailable';END IF;
 IF nullif(btrim(a.license_number),'') IS NULL OR a.license_expiration IS NULL OR a.license_expiration<(statement_timestamp() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'license_invalid';END IF;
 IF EXISTS(SELECT 1 FROM public.application_identity_reviews WHERE application_id=_id AND kind<>'approval_identity' AND (status='open' OR resolution='different_person')) THEN RAISE EXCEPTION 'identity_conflict';END IF;
 IF (SELECT count(*) FROM public.documents WHERE driver_id=_id AND category='license_front' AND is_current IS TRUE)<>1 OR
    (SELECT count(*) FROM public.documents WHERE driver_id=_id AND category='license_back' AND is_current IS TRUE)<>1 THEN RAISE EXCEPTION 'license_documents_ambiguous_or_missing';END IF;
 SELECT * INTO f FROM public.documents WHERE driver_id=_id AND category='license_front' AND is_current IS TRUE;
 SELECT * INTO b FROM public.documents WHERE driver_id=_id AND category='license_back' AND is_current IS TRUE;
 IF f.review_status IS DISTINCT FROM 'verified' OR b.review_status IS DISTINCT FROM 'verified' OR f.reviewed_by IS NULL OR b.reviewed_by IS NULL OR f.reviewed_at IS NULL OR b.reviewed_at IS NULL THEN RAISE EXCEPTION 'documents_unverified';END IF;
 fv:=private.approval_object_version(f.id);bv:=private.approval_object_version(b.id);
 IF fv IS NULL OR bv IS NULL OR fv='null'::jsonb OR bv='null'::jsonb THEN RAISE EXCEPTION 'document_version_unavailable';END IF;
 IF coalesce(f.content_sha256,'') !~ '^[0-9a-f]{64}$' OR coalesce(b.content_sha256,'') !~ '^[0-9a-f]{64}$' OR
    fv->>'sha256' IS DISTINCT FROM f.content_sha256 OR bv->>'sha256' IS DISTINCT FROM b.content_sha256 OR
    fv->>'bucket' IS DISTINCT FROM f.storage_bucket OR bv->>'bucket' IS DISTINCT FROM b.storage_bucket OR
    fv->>'path' IS DISTINCT FROM f.storage_path OR bv->>'path' IS DISTINCT FROM b.storage_path OR
    nullif(fv->>'version','') IS NULL OR nullif(bv->>'version','') IS NULL THEN RAISE EXCEPTION 'document_attestation_mismatch';END IF;
 RETURN jsonb_build_object('application',a.id,'version',a.approval_evidence_version,'identity',jsonb_build_object('name',a.full_name,'dob',a.dob,'email',a.email,'phone',a.phone,'license_number',a.license_number,'license_state',a.license_state,'license_expiration',a.license_expiration),
 'front',jsonb_build_object('id',f.id,'bucket',f.storage_bucket,'path',f.storage_path,'sha256',f.content_sha256,'reviewer',f.reviewed_by,'reviewed_at',f.reviewed_at,'object_version',fv),
 'back',jsonb_build_object('id',b.id,'bucket',b.storage_bucket,'path',b.storage_path,'sha256',b.content_sha256,'reviewer',b.reviewed_by,'reviewed_at',b.reviewed_at,'object_version',bv));
END $$;

CREATE FUNCTION public.preview_approval_identity(_application_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
BEGIN PERFORM private.approval_actor();PERFORM private.approval_lock();PERFORM private.approval_actor();RETURN private.approval_snapshot(_application_id);END $$;
CREATE FUNCTION public.verify_approval_identity(_application_id uuid,_reviewed_evidence jsonb,_note text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE actor uuid; evidence jsonb; rid uuid;
BEGIN
 PERFORM private.approval_lock();actor:=private.approval_actor();
 PERFORM 1 FROM public.applications WHERE id=_application_id AND status IN ('new','reviewing','approved','active') FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_state_invalid';END IF;
 evidence:=private.approval_snapshot(_application_id);
 IF _reviewed_evidence IS NULL OR evidence IS DISTINCT FROM _reviewed_evidence THEN RAISE EXCEPTION 'review_evidence_stale';END IF;
 IF _note IS NULL OR length(btrim(_note))<3 OR length(_note)>500 THEN RAISE EXCEPTION 'review_note_required';END IF;
 INSERT INTO public.application_identity_reviews(application_id,kind,status,resolution,resolution_note,resolved_by,resolved_at,approval_evidence)
 VALUES(_application_id,'approval_identity','resolved','verified',_note,actor,clock_timestamp(),evidence) RETURNING id INTO rid;
 INSERT INTO public.audit_log(actor_user_id,action,entity_type,entity_id,summary,metadata)
 VALUES(actor,'identity_review.approval_verified','application',_application_id::text,'Positive identity decision recorded',jsonb_build_object('review_id',rid,'evidence_version',evidence->'version'));
 RETURN rid;
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'approval_contention_retry_transaction' USING ERRCODE='40001';
END $$;

CREATE FUNCTION private.approval_validate(_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE snapshot jsonb; rid uuid;
BEGIN
 PERFORM private.approval_actor();snapshot:=private.approval_snapshot(_id);
 SELECT id INTO rid FROM public.application_identity_reviews WHERE application_id=_id AND kind='approval_identity' AND status='resolved' AND resolution='verified' AND approval_evidence=snapshot AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL ORDER BY resolved_at DESC,id DESC LIMIT 1;
 IF rid IS NULL THEN RAISE EXCEPTION 'positive_identity_required';END IF;RETURN rid;
END $$;
CREATE FUNCTION private.approval_write_audit(_id uuid,_old text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE actor uuid;rid uuid;op private.approval_operations%ROWTYPE;
BEGIN
 actor:=private.approval_actor();rid:=private.approval_validate(_id);
 SELECT * INTO op FROM private.approval_operations WHERE application_id=_id AND actor_id=actor AND transaction_id=pg_current_xact_id() ORDER BY confirmed_at DESC,operation_id DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'approval_operation_required';END IF;
 INSERT INTO public.audit_log(actor_user_id,action,entity_type,entity_id,summary,metadata)
 VALUES(actor,'application.approved','application',_id::text,'Approval confirmed; invitation is a separate operation',jsonb_build_object('previous_status',_old,'review_id',rid,'operation_id',op.operation_id,'requested_mode',op.requested_mode,'approval_outcome','confirmed','invitation_requested',op.requested_mode='approve_invite','invitation_execution_outcome','not_started','delivery_outcome','unverified','agreement_sent',false));
END $$;

-- INVOKER trigger: nested legacy definers and service clients cannot impersonate
-- the dedicated executor. No membership/SET ROLE privileges for application roles.
CREATE FUNCTION private.approval_application_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status='approved' THEN RAISE EXCEPTION 'approval_insert_forbidden' USING ERRCODE='42501';END IF;
  IF NEW.approval_evidence_version<>0 THEN RAISE EXCEPTION 'evidence_version_managed';END IF;RETURN NEW;
 END IF;
 IF NEW.approval_evidence_version IS DISTINCT FROM OLD.approval_evidence_version AND current_user<>'rr_approval_executor' THEN RAISE EXCEPTION 'evidence_version_managed';END IF;
 IF ROW(NEW.full_name,NEW.dob,NEW.email,NEW.phone,NEW.license_number,NEW.license_state,NEW.license_expiration,NEW.license_photo_url,NEW.user_id,NEW.deleted_at,NEW.purged_at,NEW.primary_application_id) IS DISTINCT FROM ROW(OLD.full_name,OLD.dob,OLD.email,OLD.phone,OLD.license_number,OLD.license_state,OLD.license_expiration,OLD.license_photo_url,OLD.user_id,OLD.deleted_at,OLD.purged_at,OLD.primary_application_id) THEN
  -- Only identity/ownership/license changes invalidate; notes/rates do not.
  NEW.approval_evidence_version:=OLD.approval_evidence_version+1;
 END IF;
 IF NEW.status='approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
  IF current_user<>'rr_approval_executor' THEN RAISE EXCEPTION 'approval_rpc_required' USING ERRCODE='42501';END IF;
  IF (OLD.status IN ('new','reviewing')) IS NOT TRUE THEN RAISE EXCEPTION 'application_state_invalid';END IF;
  IF NEW.approval_evidence_version<>OLD.approval_evidence_version THEN RAISE EXCEPTION 'approval_combined_evidence_write_forbidden';END IF;
  PERFORM private.approval_validate(OLD.id);
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER approval_boundary BEFORE INSERT OR UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION private.approval_application_guard();
CREATE FUNCTION private.approval_after() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN IF NEW.status='approved' AND OLD.status IS DISTINCT FROM NEW.status THEN PERFORM private.approval_write_audit(NEW.id,OLD.status);END IF;RETURN NEW;END $$;
CREATE TRIGGER approval_audit AFTER UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION private.approval_after();

CREATE FUNCTION private.approval_evidence_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE old_id uuid; new_id uuid;
BEGIN
 IF TG_TABLE_NAME='documents' THEN
  IF TG_OP<>'INSERT' AND OLD.category IN ('license_front','license_back') THEN old_id:=OLD.driver_id;END IF;
  IF TG_OP<>'DELETE' AND NEW.category IN ('license_front','license_back') THEN new_id:=NEW.driver_id;END IF;
 ELSE
  IF TG_OP<>'INSERT' AND OLD.kind<>'approval_identity' THEN old_id:=OLD.application_id;END IF;
  IF TG_OP<>'DELETE' AND NEW.kind<>'approval_identity' THEN new_id:=NEW.application_id;END IF;
 END IF;
 UPDATE public.applications SET approval_evidence_version=approval_evidence_version+1 WHERE id=old_id OR id=new_id;
 RETURN NULL;
END $$;
CREATE TRIGGER approval_evidence_changed AFTER INSERT OR UPDATE OR DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION private.approval_evidence_changed();
CREATE TRIGGER approval_evidence_changed AFTER INSERT OR UPDATE OR DELETE ON public.application_identity_reviews FOR EACH ROW EXECUTE FUNCTION private.approval_evidence_changed();
CREATE FUNCTION private.approval_review_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.status='resolved' THEN RAISE EXCEPTION 'resolved_identity_review_immutable' USING ERRCODE='42501';END IF;
 IF TG_OP<>'DELETE' AND (NEW.kind='approval_identity' OR NEW.approval_evidence IS NOT NULL) AND current_user<>'rr_approval_executor' THEN RAISE EXCEPTION 'identity_verification_rpc_required' USING ERRCODE='42501';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER approval_review_guard BEFORE INSERT OR UPDATE OR DELETE ON public.application_identity_reviews FOR EACH ROW EXECUTE FUNCTION private.approval_review_guard();
CREATE FUNCTION private.approval_audit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'approval_history_immutable' USING ERRCODE='42501';END IF;
 IF TG_OP<>'INSERT' AND (OLD.action='application.approved' OR OLD.action LIKE 'identity_review.%') THEN RAISE EXCEPTION 'approval_history_immutable' USING ERRCODE='42501';END IF;
 IF TG_OP<>'DELETE' AND (NEW.action='application.approved' OR NEW.action LIKE 'identity_review.approval_%') AND current_user<>'rr_approval_executor' THEN RAISE EXCEPTION 'approval_audit_rpc_required' USING ERRCODE='42501';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER approval_audit_guard BEFORE INSERT OR UPDATE OR DELETE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION private.approval_audit_guard();
CREATE TRIGGER approval_audit_truncate BEFORE TRUNCATE ON public.audit_log FOR EACH STATEMENT EXECUTE FUNCTION private.approval_audit_guard();
CREATE TRIGGER approval_reviews_truncate BEFORE TRUNCATE ON public.application_identity_reviews FOR EACH STATEMENT EXECUTE FUNCTION private.approval_audit_guard();

CREATE FUNCTION private.approval_result(_op private.approval_operations,_recovered boolean) RETURNS jsonb LANGUAGE sql SET search_path='' AS $$
 SELECT jsonb_build_object('ok',true,'operationId',_op.operation_id,'applicationId',_op.application_id,'requestedMode',_op.requested_mode,'confirmedAt',_op.confirmed_at,'recovered',_recovered,'approvalOutcome','confirmed','agreementSent',false,'portalAccount','not requested','invitationRequested',_op.requested_mode='approve_invite','invitationExecutionOutcome','unverified','deliveryOutcome','unverified');
$$;
CREATE FUNCTION public.recover_application_approval(_application_id uuid,_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE actor uuid;op private.approval_operations%ROWTYPE;
BEGIN
 PERFORM private.approval_lock();actor:=private.approval_actor();
 SELECT * INTO op FROM private.approval_operations WHERE operation_id=_operation_id AND application_id=_application_id AND actor_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'approval_operation_unavailable' USING ERRCODE='42501';END IF;
 RETURN private.approval_result(op,true);
END $$;
CREATE FUNCTION public.approve_application_checked(_application_id uuid,_expected_version bigint,_operation_id uuid,_mode text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE a public.applications%ROWTYPE;actor uuid;op private.approval_operations%ROWTYPE;
BEGIN
 PERFORM private.approval_lock();actor:=private.approval_actor();
 IF _operation_id IS NULL OR (_mode IN ('approve_only','approve_invite')) IS NOT TRUE THEN RAISE EXCEPTION 'approval_request_invalid';END IF;
 SELECT * INTO op FROM private.approval_operations WHERE operation_id=_operation_id;
 IF FOUND THEN
  IF op.actor_id<>actor OR op.application_id IS DISTINCT FROM _application_id OR op.evidence_version IS DISTINCT FROM _expected_version OR op.requested_mode IS DISTINCT FROM _mode THEN RAISE EXCEPTION 'approval_operation_mismatch' USING ERRCODE='42501';END IF;
  RETURN private.approval_result(op,true);
 END IF;
 SELECT * INTO a FROM public.applications WHERE id=_application_id FOR UPDATE NOWAIT;
 IF NOT FOUND OR a.deleted_at IS NOT NULL OR a.purged_at IS NOT NULL OR (a.status IN ('new','reviewing')) IS NOT TRUE THEN RAISE EXCEPTION 'application_state_invalid';END IF;
 IF _expected_version IS NULL OR a.approval_evidence_version<>_expected_version THEN RAISE EXCEPTION 'approval_version_stale';END IF;
 INSERT INTO private.approval_operations(operation_id,application_id,actor_id,evidence_version,requested_mode)
 VALUES(_operation_id,a.id,actor,_expected_version,_mode) RETURNING * INTO op;
 UPDATE public.applications SET status='approved',contacted_at=coalesce(contacted_at,clock_timestamp()) WHERE id=a.id;
 RETURN private.approval_result(op,false);
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'approval_contention_retry_transaction' USING ERRCODE='40001';
END $$;
CREATE FUNCTION public.approval_readiness(_application_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE v bigint;
BEGIN
 PERFORM private.approval_lock();PERFORM private.approval_actor();
 SELECT approval_evidence_version INTO v FROM public.applications WHERE id=_application_id AND status IN ('new','reviewing');
 IF NOT FOUND THEN RAISE EXCEPTION 'application_state_invalid';END IF;
 PERFORM private.approval_validate(_application_id);
 RETURN jsonb_build_object('ready',true,'version',v);
END $$;
