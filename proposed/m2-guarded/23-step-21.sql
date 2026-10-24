-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- Packet fi', 'le. Local rehearsal applies it with psql -1. A hosted run follows proposed/HOSTED-INSTALL.md and runs this file as its own transaction.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), '3c2f03c3335a3c8e5ffe8f7790282810982f818d047d17284f8d69bb7adb3366', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '3c2f03c3335a3c8e5ffe8f7790282810982f818d047d17284f8d69bb7adb3366';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 1291), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '36b3d8e9525bbe6f688b3fd865f005cb09bcccccdb3ed21767a6cee71e831b25';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 1291) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- Packet file. Local rehearsal applies it with psql -1. A hosted run follows proposed/HOSTED-INSTALL.md and runs this file as its own transaction.
-- New namespace only; no legacy paths, policy grants or security 0031 modifications.
CREATE FUNCTION private.storage_integrity_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'immutable_storage_truncate_denied'; END IF;
 IF OLD.name LIKE 'immutable-v1/%' THEN RAISE EXCEPTION 'immutable_object_overwrite_or_delete_denied'; END IF;
 IF TG_OP='UPDATE' AND NEW.name LIKE 'immutable-v1/%' THEN RAISE EXCEPTION 'immutable_object_requires_insert'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER storage_integrity_v1 BEFORE UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION private.storage_integrity_v1();
CREATE TRIGGER storage_integrity_truncate_v1 BEFORE TRUNCATE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION private.storage_integrity_v1();
REVOKE ALL ON FUNCTION private.storage_integrity_v1() FROM PUBLIC, anon, authenticated, service_role;
-- Provider object-layer no-overwrite semantics must ALSO be accepted against actual Storage.
-- A PostgreSQL metadata trigger alone does not prove remote blob immutability.
