-- READ-ONLY. M2 evidence fingerprint: counts and md5 hashes only, never row values.
-- Used (a) before and after any Window 2 forward fix, standalone, and (b) inlined by
-- scripts/m2-forward-fix.mjs into the fix request itself, which refuses (rolls back) if it changes.
-- Covers what a forward fix must never alter: identity evidence, approval operations, approval
-- audit history, agreement evidence, server hash bindings, bound documents, approval versions,
-- the Security 0031 policies, and the triggers and trigger functions that enforce the
-- approval boundary and immutability on those tables, and every approval-boundary function
-- definition (approval_*, the identity RPCs, and any function that raises
-- positive_identity_required). A fix may replace a boundary function only when the owner names it;
-- the generator then substitutes the RRFP-EXCLUDE list and enforces that no refusal code is removed.
-- RRFP-BEGIN
SELECT pg_catalog.jsonb_build_object(
 'identity_reviews', (SELECT pg_catalog.jsonb_build_array(count(*), md5(string_agg(to_jsonb(r)::text, E'\n' ORDER BY r.id))) FROM public.application_identity_reviews r),
 'approval_operations', (SELECT pg_catalog.jsonb_build_array(count(*), md5(string_agg(to_jsonb(o)::text, E'\n' ORDER BY o.operation_id))) FROM private.approval_operations o),
 'approval_audit', (SELECT pg_catalog.jsonb_build_array(count(*), md5(string_agg(to_jsonb(l)::text, E'\n' ORDER BY l.id))) FROM public.audit_log l WHERE l.action = 'application.approved' OR l.action LIKE 'identity\_review.%'),
 'agreement_evidence', (SELECT pg_catalog.jsonb_build_array(count(*), md5(string_agg(to_jsonb(e)::text, E'\n' ORDER BY to_jsonb(e)::text))) FROM private.agreement_evidence e),
 'content_bindings', (SELECT pg_catalog.jsonb_build_array(count(*), md5(string_agg(to_jsonb(b)::text, E'\n' ORDER BY b.bucket_id, b.name))) FROM private.uploaded_content_sha b),
 'bound_documents', (SELECT pg_catalog.jsonb_build_array(count(*), md5(string_agg(to_jsonb(d)::text, E'\n' ORDER BY d.id))) FROM public.documents d WHERE (to_jsonb(d) -> 'integrity_v1') IS NOT NULL AND (to_jsonb(d) -> 'integrity_v1') <> 'null'::jsonb),
 'approval_versions', (SELECT pg_catalog.jsonb_build_array(count(*), md5(string_agg(a.id::text || ':' || coalesce(to_jsonb(a) ->> 'approval_evidence_version', ''), E'\n' ORDER BY a.id))) FROM public.applications a WHERE coalesce((to_jsonb(a) ->> 'approval_evidence_version')::int, 0) <> 0),
 'policies_0031', (SELECT pg_catalog.jsonb_build_array(count(*), md5(string_agg(concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))) FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')),
 'boundary_triggers', (SELECT pg_catalog.jsonb_build_array(count(*), md5(string_agg(n.nspname || '.' || c.relname || '|' || t.tgname || '|' || t.tgenabled::text || '|' || t.tgtype::text || '|' || t.tgattr::text || '|' || encode(t.tgargs, 'hex') || '|' || coalesce(t.tgqual::text, '') || '|' || (SELECT pn.nspname FROM pg_catalog.pg_namespace pn WHERE pn.oid = fp.pronamespace) || '.' || fp.proname || '(' || pg_catalog.pg_get_function_identity_arguments(fp.oid) || ')' || '|' || CASE WHEN ((SELECT pn.nspname FROM pg_catalog.pg_namespace pn WHERE pn.oid = fp.pronamespace) || '.' || fp.proname || '(' || pg_catalog.pg_get_function_identity_arguments(fp.oid) || ')') = ANY (/*RRFP-EXCLUDE*/ARRAY[]::text[]) THEN 'named-in-fix' ELSE md5(pg_get_functiondef(t.tgfoid)) END, E'\n' ORDER BY n.nspname, c.relname, t.tgname)))
   FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace JOIN pg_catalog.pg_proc fp ON fp.oid = t.tgfoid
   WHERE NOT t.tgisinternal AND (n.nspname, c.relname) IN (('public','application_identity_reviews'),('public','applications'),('public','documents'),('public','audit_log'),('public','agreements'),('public','user_roles'),('private','approval_operations'),('private','agreement_evidence'),('private','uploaded_content_sha'),('storage','objects'))),
 'boundary_functions', (SELECT pg_catalog.jsonb_build_array(count(*), md5(string_agg((SELECT pn.nspname FROM pg_catalog.pg_namespace pn WHERE pn.oid = p.pronamespace) || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce(p.proacl::text, '') || '|' || md5(pg_get_functiondef(p.oid)), E'\n' ORDER BY n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid))))
   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f'
     AND (p.proname LIKE 'approval\_%' OR p.proname IN ('approve_application_checked','verify_approval_identity','preview_approval_identity','recover_application_approval','license_snapshot_v1','integrity_serialize_v1','record_approval_scope_v3')
          OR (CASE WHEN p.prokind = 'f' THEN pg_get_functiondef(p.oid) END) LIKE '%positive\_identity\_required%')
     AND NOT (((SELECT pn.nspname FROM pg_catalog.pg_namespace pn WHERE pn.oid = p.pronamespace) || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')') = ANY (/*RRFP-EXCLUDE*/ARRAY[]::text[])))
) AS evidence_fingerprint
-- RRFP-END
;
