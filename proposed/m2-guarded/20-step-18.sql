-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- LOCAL V5 ', 'supplement. No API memberships, broad table grants, or BYPASSRLS.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), '46f72a208fb21cacf928e595ed286435ed0f1a334c20f229d3be16b801dab854', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '46f72a208fb21cacf928e595ed286435ed0f1a334c20f229d3be16b801dab854';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 724), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '4f9217759844e9344046424c54bd51586e6302ba510395e8295f3d86517c166b';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 724) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- LOCAL V5 supplement. No API memberships, broad table grants, or BYPASSRLS.
GRANT SELECT(deleted_at,full_name,dob,license_number,license_state,license_expiration) ON public.applications TO rr_evidence_issuer;
GRANT SELECT(id,application_id,kind,status,resolution,positive_evidence_v1,resolved_at) ON public.application_identity_reviews TO rr_evidence_issuer;
CREATE POLICY issuer_identity_allow_v5 ON public.application_identity_reviews AS PERMISSIVE FOR SELECT TO rr_evidence_issuer USING (private.record_issuer_scope_v2(application_id));
CREATE POLICY issuer_identity_limit_v5 ON public.application_identity_reviews AS RESTRICTIVE FOR SELECT TO rr_evidence_issuer USING (private.record_issuer_scope_v2(application_id));
