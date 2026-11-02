DO $g$ BEGIN IF (SELECT system_identifier::text FROM pg_control_system()) <> '7702070854497379551' THEN RAISE EXCEPTION 'refused'; END IF; END $g$;
-- READ-ONLY. Security S1 post-install verification. One SELECT; counts, flags, names and hashes only.
-- Run once, right after request-s1.sql. Every entry of 'gates' must be true ('all_gates'). The fingerprint
-- and the exploded ACL must equal what the package recorded in its audit_log evidence row.
WITH k AS (
 SELECT ARRAY['id','status','created_at','deposit_status','deposit_amount','deposit_paid','weekly_rent','payment_status','user_id','primary_application_id','stripe_customer_id','stripe_payment_method_id','card_brand','card_last4','card_exp_month','card_exp_year','card_on_file_at','reviewed_at','reviewed_by']::text[] AS revoke_cols,
  ARRAY['ai_score','ai_tier','ai_flags','ai_summary','scored_at','sms_consent_at','sms_consent_source','sms_consent_version','sms_consent_text','sms_consent_phone','sms_consent_page','deleted_at','deleted_by','deleted_reason','purged_at','legal_hold','contact_status','contact_status_note','contact_follow_up_on','contact_status_at','contact_status_by']::text[] AS closed_cols,
  ARRAY['full_name','email','phone','city','state','vehicle_id','rental_term','platform_status','rental_length','market_id','source','utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','pickup_date','return_date','sms_consent','resubmission_count','resubmission_history','landing_page','referrer']::text[] AS form_cols
), acl AS (
 SELECT pg_catalog.jsonb_agg(x ORDER BY x COLLATE "C") AS items FROM (
  SELECT pg_catalog.concat_ws(':', '', CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(e.grantee) END, e.privilege_type, pg_catalog.pg_get_userbyid(e.grantor), e.is_grantable::text) AS x
  FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) e WHERE c.oid = 'public.applications'::pg_catalog.regclass
  UNION ALL
  SELECT pg_catalog.concat_ws(':', a.attname, CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(e.grantee) END, e.privilege_type, pg_catalog.pg_get_userbyid(e.grantor), e.is_grantable::text)
  FROM pg_catalog.pg_attribute a, LATERAL pg_catalog.aclexplode(a.attacl) e WHERE a.attrelid = 'public.applications'::pg_catalog.regclass AND a.attnum > 0 AND NOT a.attisdropped) s
), snap AS (
 SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled, t.tgattr::text) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid),
   'guard_functions', (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'private' AND p.proname = 'application_write_guard')) AS core,
  pg_catalog.jsonb_build_object('relacl', c.relacl::text, 'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)) AS raw,
  c.relacl::text AS relacl
 FROM pg_catalog.pg_class c WHERE c.oid = 'public.applications'::pg_catalog.regclass
), ev AS (
 SELECT pg_catalog.count(*) AS n, (pg_catalog.array_agg(l.metadata))[1] AS m, (pg_catalog.array_agg(l.actor_role))[1] AS actor, (pg_catalog.array_agg(l.action))[1] AS action
 FROM public.audit_log l WHERE l.entity_type = 'database_migration' AND l.entity_id = 's1_application_write_guard' AND l.action = 'security_migration_verified'
), fn AS (
 SELECT p.oid, p.prosecdef, l.lanname, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.prorettype,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') AS prosrc_sha
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang JOIN pg_catalog.pg_namespace s ON s.oid = p.pronamespace
 WHERE s.nspname = 'private' AND p.proname = 'application_write_guard' AND p.pronargs = 0
), gt AS (
 SELECT pg_catalog.jsonb_build_object(
  'evidence_one_well_formed', ev.n = 1 AND ev.actor = 'postgres' AND ev.m->>'package' = 'security-s1 v1'
     AND ev.m->>'inner_sql_sha256' = '1b18be0c3db863715e44c3a7576b42c6f014753706dd255dd4903f0565708fac' AND ev.m->>'guard_function_prosrc_sha256' = '34ce374b15e106597e7c6f9bd8bbb03607c3b7b68ab30e1aad75f4597fa6a292',
  'not_rolled_back', NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 's1_application_write_guard' AND action = 'security_migration_rolled_back'),
  'trigger_exact', (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t, fn WHERE t.tgrelid = 'public.applications'::pg_catalog.regclass AND t.tgname = 'zz_application_write_guard'
     AND NOT t.tgisinternal AND t.tgtype = 23 AND t.tgenabled = 'O' AND t.tgattr::text = '' AND t.tgfoid = fn.oid) = 1,
  'trigger_sorts_last', (SELECT pg_catalog.max(t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.applications'::pg_catalog.regclass AND NOT t.tgisinternal
     AND (t.tgtype & 3) = 3) = 'zz_application_write_guard',
  'function_exact', (SELECT pg_catalog.count(*) FROM fn) = 1 AND (SELECT NOT fn.prosecdef AND fn.lanname = 'plpgsql' AND fn.proconfig = ARRAY['search_path=""'] AND fn.owner = 'postgres'
     AND fn.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype AND fn.prosrc_sha = '34ce374b15e106597e7c6f9bd8bbb03607c3b7b68ab30e1aad75f4597fa6a292'
     AND NOT pg_catalog.has_function_privilege('authenticated', fn.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', fn.oid, 'EXECUTE')
     AND NOT pg_catalog.has_function_privilege('service_role', fn.oid, 'EXECUTE') FROM fn),
  'protected_columns_closed', NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(k.revoke_cols || k.closed_cols) c WHERE pg_catalog.has_column_privilege('authenticated', 'public.applications', c, 'UPDATE')),
  'authenticated_insert_form_only', NOT pg_catalog.has_table_privilege('authenticated', 'public.applications', 'INSERT')
     AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attname COLLATE "C") FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.applications'::pg_catalog.regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND pg_catalog.has_column_privilege('authenticated', 'public.applications', a.attnum, 'INSERT')) = (SELECT pg_catalog.array_agg(c ORDER BY c COLLATE "C") FROM pg_catalog.unnest(k.form_cols) c),
  'anon_insert_unchanged', (SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attname COLLATE "C") FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.applications'::pg_catalog.regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND pg_catalog.has_column_privilege('anon', 'public.applications', a.attnum, 'INSERT')) = (SELECT pg_catalog.array_agg(c ORDER BY c COLLATE "C") FROM pg_catalog.unnest(k.form_cols || ARRAY['primary_application_id']) c),
  'acl_matches_evidence', acl.items = ev.m->'post_install_acl',
  'fingerprint_matches_evidence', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object('core', snap.core, 'acl', snap.raw)::text, 'UTF8')), 'hex') = ev.m->>'post_install_fingerprint_sha256',
  'policies_0031_exact', (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
     FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')) = 'd33877618a9f40924d14e49b6653d7fa',
  'journal_exact_23', (SELECT pg_catalog.md5((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY id) FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations) j)::text)) = '5cfa7e88ccac860637339bd9bdaab72c'
 ) AS gates
 FROM k, acl, snap, ev
)
SELECT pg_catalog.jsonb_build_object(
 'at', pg_catalog.now(),
 'target', pg_catalog.jsonb_build_object('system_identifier', (SELECT system_identifier::text FROM pg_catalog.pg_control_system()), 'database', pg_catalog.current_database(), 'current_user', current_user),
 'transaction_read_only', pg_catalog.current_setting('transaction_read_only'),
 'gates', gt.gates,
 'all_gates', (SELECT pg_catalog.bool_and(COALESCE(v::boolean, false)) FROM pg_catalog.jsonb_each_text(gt.gates) AS e(key, v)),
 'evidence', (SELECT pg_catalog.jsonb_build_object('rows', ev.n, 'actor_role', ev.actor, 'execution_at', ev.m->>'execution_at', 'transaction_id', ev.m->>'transaction_id',
     'pre_install_fingerprint_sha256', ev.m->>'pre_install_fingerprint_sha256', 'post_install_fingerprint_sha256', ev.m->>'post_install_fingerprint_sha256') FROM ev),
 'facts', pg_catalog.jsonb_build_object('relacl', snap.relacl, 'acl_items', pg_catalog.jsonb_array_length(acl.items),
   'triggers', (SELECT pg_catalog.jsonb_agg(t.tgname ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.applications'::pg_catalog.regclass AND NOT t.tgisinternal),
   'policies_total', (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies), 'drizzle_receipts', (SELECT pg_catalog.count(*) FROM drizzle.__drizzle_migrations),
   'supabase_receipts', (SELECT CASE WHEN pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 0 END) /* ADAPTED: staging has no supabase receipts */,
   'audit_log_rows', (SELECT pg_catalog.count(*) FROM public.audit_log)),
 'fingerprint_sha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object('core', snap.core, 'acl', snap.raw)::text, 'UTF8')), 'hex')
) AS s1_verify
FROM k, acl, snap, gt;
