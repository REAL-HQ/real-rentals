-- Metadata defense, not a claim of platform blob immutability. No Storage ownership/grants.
-- Corrected before install:
--   * finalized_archive_invalid runs on INSERT of an archived row, and on UPDATE
--     only when archive_status, document_id, completed_document_id, or sha256 changes.
--     A legacy archived row with a null sha256 can still receive unrelated updates.
--   * The document trigger is SECURITY DEFINER so the agreement pointer is visible
--     regardless of the caller's RLS. It does not read documents.integrity_v1
--     (that column is created by 040-document-identity-v2.sql) and it does not
--     grant an issuer rewrite onto immutable-v1.
CREATE FUNCTION private.finalized_archive_pointer_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.completed_document_id IS NOT NULL AND OLD.sha256 IS NOT NULL THEN RAISE EXCEPTION 'finalized_archive_retained'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.completed_document_id IS NOT NULL AND OLD.sha256 IS NOT NULL AND
 ROW(NEW.document_id,NEW.completed_document_id,NEW.sha256,NEW.body_sha256,NEW.application_id,NEW.vehicle_id,NEW.body,NEW.signed_at)
 IS DISTINCT FROM ROW(OLD.document_id,OLD.completed_document_id,OLD.sha256,OLD.body_sha256,OLD.application_id,OLD.vehicle_id,OLD.body,OLD.signed_at)
 THEN RAISE EXCEPTION 'finalized_archive_immutable'; END IF;
 IF NEW.archive_status='archived' AND (NEW.document_id IS NULL OR NEW.document_id IS DISTINCT FROM NEW.completed_document_id OR NEW.sha256 IS NULL OR NEW.sha256 !~ '^[a-f0-9]{64}$') THEN
  IF TG_OP='INSERT' THEN RAISE EXCEPTION 'finalized_archive_invalid'; END IF;
  IF OLD.archive_status IS DISTINCT FROM NEW.archive_status
     OR OLD.document_id IS DISTINCT FROM NEW.document_id
     OR OLD.completed_document_id IS DISTINCT FROM NEW.completed_document_id
     OR OLD.sha256 IS DISTINCT FROM NEW.sha256
  THEN RAISE EXCEPTION 'finalized_archive_invalid'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finalized_archive_pointer_v1 BEFORE INSERT OR UPDATE OR DELETE ON public.agreements FOR EACH ROW EXECUTE FUNCTION private.finalized_archive_pointer_v1();
CREATE FUNCTION private.finalized_archive_document_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.storage_path ~ '^(immutable|completed)-v1/' OR EXISTS(SELECT 1 FROM public.agreements WHERE sha256 IS NOT NULL AND (document_id=OLD.id OR completed_document_id=OLD.id)) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'finalized_archive_retained'; END IF;
  IF ROW(NEW.storage_bucket,NEW.storage_path,NEW.content_sha256,NEW.driver_id) IS DISTINCT FROM ROW(OLD.storage_bucket,OLD.storage_path,OLD.content_sha256,OLD.driver_id) THEN RAISE EXCEPTION 'finalized_archive_immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finalized_archive_document_v1 BEFORE UPDATE OR DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION private.finalized_archive_document_v1();
REVOKE ALL ON FUNCTION private.finalized_archive_pointer_v1(),private.finalized_archive_document_v1() FROM PUBLIC,anon,authenticated,service_role;
-- Reuse the already-reviewed storage_integrity_v1 trigger for immutable-v1 metadata.
-- Service-key HTTP/S3/TUS behavior must be accepted independently. No blanket DELETE or retention exception is added.

CREATE FUNCTION private.completed_archive_storage_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'completed_archive_truncate_denied'; END IF;
 IF OLD.name LIKE 'completed-v1/%' OR (TG_OP='UPDATE' AND NEW.name LIKE 'completed-v1/%') THEN RAISE EXCEPTION 'completed_archive_retained'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.completed_archive_storage_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER completed_archive_storage_v1 BEFORE UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION private.completed_archive_storage_v1();
CREATE TRIGGER completed_archive_storage_truncate_v1 BEFORE TRUNCATE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION private.completed_archive_storage_v1();
