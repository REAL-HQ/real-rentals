-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- HOSTED AM', 'ENDMENT, not part of the approved packet. Runs immediately before');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), 'e932aaa8bbdbc8ce53a1a4eda8a029e299bc65388d2d739eca64a3cb741f0c34', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) 'e932aaa8bbdbc8ce53a1a4eda8a029e299bc65388d2d739eca64a3cb741f0c34';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 1025), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '76b562ba3162ba2e554a4958cd9239fd25541f07b3620a69313f64dc64b7fc99';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 1025) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- HOSTED AMENDMENT, not part of the approved packet. Runs immediately before
-- HOSTED-INSTALL step 3 (00-approval-boundary.sql), in its own transaction.
--
-- Found by the hosted rehearsal (2026-10-23, PostgreSQL 17, postgres is not a
-- superuser). Step 3 moves three functions to rr_approval_executor with
-- ALTER FUNCTION ... OWNER TO. A non-superuser can do that only when it can
-- SET ROLE to the new owner and the new owner holds CREATE on the schema.
-- Step 1's CREATE ROLE gave postgres ADMIN on the role but not SET, so step 3
-- fails with 42501 "must be able to SET ROLE rr_approval_executor" and rolls
-- back. The local rehearsal ran as superuser, which skips both checks.
--
-- This is the same pair 03.sql (step 5) already runs for rr_record_executor.
-- 03-post-approval-executor-create.sql revokes the CREATE right after step 3,
-- the only step that transfers ownership to this role.
GRANT rr_approval_executor TO postgres WITH SET TRUE;
GRANT CREATE ON SCHEMA public, private TO rr_approval_executor;
