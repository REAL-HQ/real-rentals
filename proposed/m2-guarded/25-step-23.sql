-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- Metadata ', 'defense, not a claim of platform blob immutability. No Storage ownership/grants.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), 'ba0188ffea9588c6a1cbf3973eb8330ddbe3835c112d5a13bff74a06930a4f75', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) 'ba0188ffea9588c6a1cbf3973eb8330ddbe3835c112d5a13bff74a06930a4f75';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 4181), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '8ddf84ce34a9ecbddafc9c626a4acc8ce6ed0f867e3a5d8e0014ca81dd7775c9';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 4181) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
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
