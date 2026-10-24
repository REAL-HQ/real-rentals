-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- Apply aft', 'er HOSTED-INSTALL step 13: proposed/m2-packet/10.sql, and before HOSTED-INSTALL step 15: proposed/m2-packet/11.sql. A hosted run follows proposed/HOSTED-INSTALL.md.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), 'e5040cd8285803027f498518363a3cf29ab21c59130fd579cfc85ca60b1c354c', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) 'e5040cd8285803027f498518363a3cf29ab21c59130fd579cfc85ca60b1c354c';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 2532), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '0c2cbbad3a3a741f5f069e222327da78acea0891e4544d2c73de8d87d47f5392';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 2532) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- Apply after HOSTED-INSTALL step 13: proposed/m2-packet/10.sql, and before HOSTED-INSTALL step 15: proposed/m2-packet/11.sql. A hosted run follows proposed/HOSTED-INSTALL.md.
-- Step 10 grants the executor the positive-license columns and an audit policy
-- that allows only identity_review.positive_license_v1. verify_approval_identity
-- and approve_application_checked run as rr_approval_executor. They write
-- approval_evidence, resolution_note, applications.status, and the two approval
-- audit actions. Those writes stay inside the existing application scope.
-- No authenticated or service-role policy is added or widened.
-- This file is one transaction. Run it with ON_ERROR_STOP. Do not also pass psql -1.
BEGIN;

GRANT SELECT (status, purged_at, approval_evidence_version, contacted_at), UPDATE (status, contacted_at) ON public.applications TO rr_approval_executor;
GRANT INSERT (resolution_note, approval_evidence) ON public.application_identity_reviews TO rr_approval_executor;
-- The approval audit rows carry the same actor columns as the legacy logAudit insert.
GRANT INSERT (actor_email, actor_role) ON public.audit_log TO rr_approval_executor;

DROP POLICY IF EXISTS approval_scope_permissive_v3 ON public.audit_log;
DROP POLICY IF EXISTS approval_scope_restrictive_v3 ON public.audit_log;
CREATE POLICY approval_scope_permissive_v3 ON public.audit_log AS PERMISSIVE FOR ALL TO rr_approval_executor
 USING (actor_user_id=private.approval_actor() AND action IN ('identity_review.positive_license_v1','identity_review.approval_verified','application.approved') AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid))
 WITH CHECK (actor_user_id=private.approval_actor() AND action IN ('identity_review.positive_license_v1','identity_review.approval_verified','application.approved') AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid));
CREATE POLICY approval_scope_restrictive_v3 ON public.audit_log AS RESTRICTIVE FOR ALL TO rr_approval_executor
 USING (actor_user_id=private.approval_actor() AND action IN ('identity_review.positive_license_v1','identity_review.approval_verified','application.approved') AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid))
 WITH CHECK (actor_user_id=private.approval_actor() AND action IN ('identity_review.positive_license_v1','identity_review.approval_verified','application.approved') AND entity_type='application' AND private.record_approval_scope_v3(entity_id::uuid));
COMMIT;
