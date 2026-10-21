-- Proposed M2 step 0. Local rehearsal. A hosted run follows proposed/HOSTED-INSTALL.md.
-- approval-boundary.local.sql in this directory is excluded and is not applied.
--
-- This file is the installed approval boundary. Three functions created by
-- packet step 1 are not created again here:
-- private.approval_provider_actor, private.approval_actor, and private.approval_lock.
-- Packet step 1 creates those three. Its provider body checks the session.
-- The excluded script's provider is the deny stub. Applying this file after
-- step 1 leaves that session check in place.
--
-- The excluded file cannot run unchanged before step 1: the GRANT names
-- rr_approval_executor, which step 1 creates. It cannot run unchanged after
-- step 1: CREATE FUNCTION private.approval_provider_actor already exists.
-- Apply packet step 1, then this file, then packet steps 2 through the
-- return checklist.
-- This file is one transaction. Run it with ON_ERROR_STOP. Do not also pass psql -1.
BEGIN;

-- LOCAL REVIEW PROPOSAL ONLY. Not a hosted installer; not in migration discovery.
-- Preconditions supplied by the local harness: rr_approval_executor is NOLOGIN,
-- NOSUPERUSER NOBYPASSRLS, has no application-role members, and narrowly scoped ACLs.
-- No historical rows are marked verified.
-- Storage attestation. The excluded script left this as a deny stub. The snapshot
-- accepts only bucket, path, sha256, and a non-empty version taken from the object
-- that is actually stored for the document. When storage.objects.version exists
-- and is non-blank, that provider column is the token. The rehearsal adds that
-- text column. Otherwise metadata.version, then metadata.eTag, then the object
-- id are the token. supabase-js stores the upload metadata option in
-- user_metadata (storage migration 0025). The metadata column is system data
-- (size, mimetype, cacheControl, eTag) and is not a sha fallback: a sha written
-- only there is not the object the client stored. The object must carry the
-- same sha256 the document row claims. A missing, ambiguous, or mismatched
-- object still raises approval_storage_version_unverified.
CREATE FUNCTION private.approval_object_version(_document uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE doc public.documents%ROWTYPE; obj_id uuid; obj_bucket text; obj_name text; obj_meta jsonb; obj_user jsonb;
 n integer; ver text; sha text; has_version boolean;
BEGIN
 SELECT * INTO doc FROM public.documents WHERE id=_document;
 IF NOT FOUND OR nullif(btrim(doc.storage_bucket),'') IS NULL OR nullif(btrim(doc.storage_path),'') IS NULL
  OR doc.content_sha256 IS NULL OR doc.content_sha256 !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'approval_storage_version_unverified' USING ERRCODE='42501';
 END IF;
 SELECT count(*) INTO n FROM storage.objects o WHERE o.bucket_id=doc.storage_bucket AND o.name=doc.storage_path;
 IF n<>1 THEN RAISE EXCEPTION 'approval_storage_version_unverified' USING ERRCODE='42501'; END IF;
 SELECT o.id, o.bucket_id, o.name, o.metadata, o.user_metadata INTO obj_id, obj_bucket, obj_name, obj_meta, obj_user
  FROM storage.objects o WHERE o.bucket_id=doc.storage_bucket AND o.name=doc.storage_path FOR SHARE;
 sha:=nullif(lower(btrim(coalesce(obj_user->>'sha256', obj_user->>'content_sha256'))),'');
 IF sha IS NULL OR sha IS DISTINCT FROM doc.content_sha256
  OR obj_bucket IS DISTINCT FROM doc.storage_bucket OR obj_name IS DISTINCT FROM doc.storage_path THEN
  RAISE EXCEPTION 'approval_storage_version_unverified' USING ERRCODE='42501';
 END IF;
 SELECT EXISTS (
  SELECT 1 FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace
  WHERE ns.nspname='storage' AND c.relname='objects' AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped
 ) INTO has_version;
 IF has_version THEN EXECUTE 'SELECT version FROM storage.objects WHERE id=$1' INTO ver USING obj_id; END IF;
 IF nullif(btrim(ver),'') IS NULL THEN ver:=nullif(btrim(obj_meta->>'version'),''); END IF;
 IF nullif(btrim(ver),'') IS NULL THEN ver:=nullif(btrim(obj_meta->>'eTag'),''); END IF;
 IF nullif(btrim(ver),'') IS NULL THEN ver:=obj_id::text; END IF;
 IF nullif(btrim(ver),'') IS NULL THEN RAISE EXCEPTION 'approval_storage_version_unverified' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('sha256',sha,'bucket',obj_bucket,'path',obj_name,'version',ver);
END $$;
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

-- Email and strongest staff role, matching the application audit helper:
-- admin, then team, then coordinator. Owned by the installer so the lookup
-- is not subject to the executor's row policies. The approval writer calls it.
CREATE FUNCTION private.approval_actor_label(_actor uuid)
RETURNS TABLE(actor_email text, actor_role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 actor_email:=(SELECT u.email FROM auth.users u WHERE u.id=_actor);
 actor_role:=(SELECT r.role::text FROM public.user_roles r
  WHERE r.user_id=_actor AND r.role::text IN ('admin','team','coordinator')
  ORDER BY CASE r.role::text WHEN 'admin' THEN 1 WHEN 'team' THEN 2 ELSE 3 END
  LIMIT 1);
 RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION private.approval_actor_label(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.approval_actor_label(uuid) TO rr_approval_executor;

CREATE FUNCTION public.preview_approval_identity(_application_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
BEGIN PERFORM private.approval_actor();PERFORM private.approval_lock();PERFORM private.approval_actor();RETURN private.approval_snapshot(_application_id);END $$;
CREATE FUNCTION public.verify_approval_identity(_application_id uuid,_reviewed_evidence jsonb,_note text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE actor uuid; evidence jsonb; rid uuid; em text; rl text;
BEGIN
 -- Reject anon and non-staff before the global approval lock. Re-check after
 -- the lock because role membership can change while this call waits.
 actor:=private.approval_actor();
 PERFORM private.approval_lock();
 IF actor IS DISTINCT FROM private.approval_actor() THEN RAISE EXCEPTION 'actor_changed' USING ERRCODE='42501'; END IF;
 -- Scope the executor's own review insert. Callers cannot SET ROLE to this owner.
 PERFORM set_config('record.application_id',_application_id::text,true);
 PERFORM 1 FROM public.applications WHERE id=_application_id AND status IN ('partial','new','complete','reviewing','approved','active','suspended','declined','closed','duplicate') FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_state_invalid';END IF;
 evidence:=private.approval_snapshot(_application_id);
 IF _reviewed_evidence IS NULL OR evidence IS DISTINCT FROM _reviewed_evidence THEN RAISE EXCEPTION 'review_evidence_stale';END IF;
 IF _note IS NULL OR length(btrim(_note))<3 OR length(_note)>500 THEN RAISE EXCEPTION 'review_note_required';END IF;
 INSERT INTO public.application_identity_reviews(application_id,kind,status,resolution,resolution_note,resolved_by,resolved_at,approval_evidence)
 VALUES(_application_id,'approval_identity','resolved','verified',_note,actor,clock_timestamp(),evidence) RETURNING id INTO rid;
 SELECT l.actor_email, l.actor_role INTO em, rl FROM private.approval_actor_label(actor) l;
 INSERT INTO public.audit_log(actor_user_id,actor_email,actor_role,action,entity_type,entity_id,summary,metadata)
 VALUES(actor,em,rl,'identity_review.approval_verified','application',_application_id::text,'Positive identity decision recorded',jsonb_build_object('review_id',rid,'evidence_version',evidence->'version'));
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
DECLARE actor uuid;rid uuid;op private.approval_operations%ROWTYPE; em text; rl text;
BEGIN
 actor:=private.approval_actor();rid:=private.approval_validate(_id);
 SELECT * INTO op FROM private.approval_operations WHERE application_id=_id AND actor_id=actor AND transaction_id=pg_current_xact_id() ORDER BY confirmed_at DESC,operation_id DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'approval_operation_required';END IF;
 SELECT l.actor_email, l.actor_role INTO em, rl FROM private.approval_actor_label(actor) l;
 INSERT INTO public.audit_log(actor_user_id,actor_email,actor_role,action,entity_type,entity_id,summary,metadata)
 VALUES(actor,em,rl,'application.approved','application',_id::text,'Approval confirmed; invitation is a separate operation',jsonb_build_object('previous_status',_old,'review_id',rid,'operation_id',op.operation_id,'requested_mode',op.requested_mode,'approval_outcome','confirmed','invitation_requested',op.requested_mode='approve_invite','invitation_execution_outcome','not_started','delivery_outcome','unverified','agreement_sent',false));
END $$;

-- INVOKER trigger: nested legacy definers and service clients cannot impersonate
-- the dedicated executor. No membership/SET ROLE privileges for application roles.
CREATE FUNCTION private.approval_application_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status='approved' THEN RAISE EXCEPTION 'approval_insert_forbidden' USING ERRCODE='42501';END IF;
  IF NEW.approval_evidence_version<>0 THEN RAISE EXCEPTION 'evidence_version_managed';END IF;RETURN NEW;
 END IF;
 -- A direct write of the managed version is refused for every role, including the
 -- table owner. The evidence trigger's own bump is the one nested update that adds
 -- exactly 1. That trigger stays owned by the table owner so the bump is not hidden
 -- by the executor's application scope (a driver upload has no record.application_id
 -- and is not a manager). Owning the bump as rr_approval_executor would update zero
 -- rows under that policy, or raise inside approval_actor, and license uploads would
 -- still fail or stop invalidating evidence.
 IF NEW.approval_evidence_version IS DISTINCT FROM OLD.approval_evidence_version AND current_user<>'rr_approval_executor' THEN
  IF pg_catalog.pg_trigger_depth()<=1 OR NEW.approval_evidence_version IS DISTINCT FROM OLD.approval_evidence_version+1 THEN
   RAISE EXCEPTION 'evidence_version_managed';
  END IF;
 END IF;
 IF ROW(NEW.full_name,NEW.dob,NEW.email,NEW.phone,NEW.license_number,NEW.license_state,NEW.license_expiration,NEW.license_photo_url,NEW.user_id,NEW.deleted_at,NEW.purged_at,NEW.primary_application_id) IS DISTINCT FROM ROW(OLD.full_name,OLD.dob,OLD.email,OLD.phone,OLD.license_number,OLD.license_state,OLD.license_expiration,OLD.license_photo_url,OLD.user_id,OLD.deleted_at,OLD.purged_at,OLD.primary_application_id) THEN
  -- Only identity/ownership/license changes invalidate; notes/rates do not.
  NEW.approval_evidence_version:=OLD.approval_evidence_version+1;
 END IF;
 IF NEW.status='approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
  IF current_user<>'rr_approval_executor' THEN RAISE EXCEPTION 'approval_rpc_required' USING ERRCODE='42501';END IF;
  IF (OLD.status IN ('partial','new','complete','reviewing','active','suspended','declined','closed','duplicate')) IS NOT TRUE THEN RAISE EXCEPTION 'application_state_invalid';END IF;
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
 actor:=private.approval_actor();
 PERFORM private.approval_lock();
 IF actor IS DISTINCT FROM private.approval_actor() THEN RAISE EXCEPTION 'actor_changed' USING ERRCODE='42501'; END IF;
 SELECT * INTO op FROM private.approval_operations WHERE operation_id=_operation_id AND application_id=_application_id AND actor_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'approval_operation_unavailable' USING ERRCODE='42501';END IF;
 RETURN private.approval_result(op,true);
END $$;
CREATE FUNCTION public.approve_application_checked(_application_id uuid,_expected_version bigint,_operation_id uuid,_mode text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE a public.applications%ROWTYPE;actor uuid;op private.approval_operations%ROWTYPE;
BEGIN
 actor:=private.approval_actor();
 PERFORM private.approval_lock();
 IF actor IS DISTINCT FROM private.approval_actor() THEN RAISE EXCEPTION 'actor_changed' USING ERRCODE='42501'; END IF;
 PERFORM set_config('record.application_id',_application_id::text,true);
 IF _operation_id IS NULL OR (_mode IN ('approve_only','approve_invite')) IS NOT TRUE THEN RAISE EXCEPTION 'approval_request_invalid';END IF;
 SELECT * INTO op FROM private.approval_operations WHERE operation_id=_operation_id;
 IF FOUND THEN
  IF op.actor_id<>actor OR op.application_id IS DISTINCT FROM _application_id OR op.evidence_version IS DISTINCT FROM _expected_version OR op.requested_mode IS DISTINCT FROM _mode THEN RAISE EXCEPTION 'approval_operation_mismatch' USING ERRCODE='42501';END IF;
  RETURN private.approval_result(op,true);
 END IF;
 SELECT id, deleted_at, purged_at, status, approval_evidence_version
  INTO a.id, a.deleted_at, a.purged_at, a.status, a.approval_evidence_version
  FROM public.applications WHERE id=_application_id FOR UPDATE OF applications NOWAIT;
 IF NOT FOUND OR a.deleted_at IS NOT NULL OR a.purged_at IS NOT NULL OR (a.status IN ('partial','new','complete','reviewing','active','suspended','declined','closed','duplicate')) IS NOT TRUE THEN RAISE EXCEPTION 'application_state_invalid';END IF;
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
 PERFORM private.approval_actor();PERFORM private.approval_lock();PERFORM private.approval_actor();
 SELECT approval_evidence_version INTO v FROM public.applications WHERE id=_application_id AND status IN ('partial','new','complete','reviewing','active','suspended','declined','closed','duplicate');
 IF NOT FOUND THEN RAISE EXCEPTION 'application_state_invalid';END IF;
 PERFORM private.approval_validate(_application_id);
 RETURN jsonb_build_object('ready',true,'version',v);
END $$;

-- The review and approval writers must run as the executor or their guards refuse
-- the insert. approval_operations is private to that role for the application the
-- function just scoped. Reads in approval_validate stay owned by the installer so
-- the record executor can see the stored snapshot without a second membership.
GRANT USAGE ON SCHEMA private TO rr_approval_executor;
GRANT SELECT, INSERT ON private.approval_operations TO rr_approval_executor;
CREATE POLICY approval_operations_executor_v1 ON private.approval_operations
 FOR ALL TO rr_approval_executor
 USING (actor_id=private.approval_actor() AND application_id=nullif(current_setting('record.application_id',true),'')::uuid)
 WITH CHECK (actor_id=private.approval_actor() AND application_id=nullif(current_setting('record.application_id',true),'')::uuid);
ALTER FUNCTION public.verify_approval_identity(uuid,jsonb,text) OWNER TO rr_approval_executor;
ALTER FUNCTION public.approve_application_checked(uuid,bigint,uuid,text) OWNER TO rr_approval_executor;
ALTER FUNCTION private.approval_write_audit(uuid,text) OWNER TO rr_approval_executor;

-- Default function privileges include PUBLIC EXECUTE. These are SECURITY DEFINER
-- or trigger bodies. anon and PUBLIC must not execute them. The five public
-- RPCs are the staff JWT surface: PUBLIC, anon, and service_role revoked,
-- EXECUTE granted to authenticated. extend_rental_tx is service_role only
-- and is not this shape.
REVOKE ALL ON FUNCTION
 private.approval_operation_immutable(),
 private.approval_serialize(),
 private.approval_snapshot(uuid),
 private.approval_validate(uuid),
 private.approval_write_audit(uuid,text),
 private.approval_application_guard(),
 private.approval_after(),
 private.approval_evidence_changed(),
 private.approval_review_guard(),
 private.approval_audit_guard(),
 private.approval_result(private.approval_operations,boolean)
 FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.approval_snapshot(uuid), private.approval_validate(uuid),
 private.approval_result(private.approval_operations,boolean) TO rr_approval_executor;
REVOKE ALL ON FUNCTION
 public.preview_approval_identity(uuid),
 public.verify_approval_identity(uuid,jsonb,text),
 public.recover_application_approval(uuid,uuid),
 public.approve_application_checked(uuid,bigint,uuid,text),
 public.approval_readiness(uuid)
 FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
 public.preview_approval_identity(uuid),
 public.verify_approval_identity(uuid,jsonb,text),
 public.recover_application_approval(uuid,uuid),
 public.approve_application_checked(uuid,bigint,uuid,text),
 public.approval_readiness(uuid)
 TO authenticated;
COMMIT;
