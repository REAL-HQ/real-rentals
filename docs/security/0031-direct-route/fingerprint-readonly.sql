-- READ-ONLY wide fingerprint before and after 0031 (the query that produced the 2026-10-24 fingerprints). The five 0031 policy names are excluded from the policy hash.
SELECT jsonb_build_object(
 'policies_total', (SELECT count(*) FROM pg_policies),
 'policies_other_md5', (SELECT md5(string_agg(concat_ws('|',schemaname,tablename,policyname,permissive,roles::text,cmd,qual,with_check), E'\n' ORDER BY schemaname,tablename,policyname)) FROM pg_policies WHERE policyname <> ALL (ARRAY['coordinator_application_containment','coordinator_review_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_agreement_containment'])),
 'storage_objects_policies', (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects'),
 'relation_acl_rls_md5', (SELECT md5(string_agg(concat_ws('|',n.nspname,c.relname,c.relkind::text,pg_get_userbyid(c.relowner),c.relacl::text,c.relrowsecurity,c.relforcerowsecurity), E'\n' ORDER BY n.nspname,c.relname)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','storage','auth','drizzle','supabase_migrations','extensions')),
 'columns_md5', (SELECT md5(string_agg(concat_ws('|',n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attacl::text), E'\n' ORDER BY n.nspname,c.relname,a.attnum)) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','storage') AND a.attnum>0 AND NOT a.attisdropped),
 'functions_md5', (SELECT md5(string_agg(p.oid::regprocedure::text||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'')||'|'||md5(pg_get_functiondef(p.oid)), E'\n' ORDER BY p.oid::regprocedure::text)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind IN ('f','p')),
 'schema_acl_md5', (SELECT md5(string_agg(nspname||'|'||pg_get_userbyid(nspowner)||'|'||coalesce(nspacl::text,''), E'\n' ORDER BY nspname)) FROM pg_namespace),
 'role_memberships_md5', (SELECT md5(string_agg(concat_ws('|',roleid::regrole::text,member::regrole::text,grantor::regrole::text,admin_option,inherit_option,set_option), E'\n' ORDER BY roleid::regrole::text,member::regrole::text,grantor::regrole::text)) FROM pg_auth_members),
 'roles_md5', (SELECT md5(string_agg(concat_ws('|',rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls), E'\n' ORDER BY rolname)) FROM pg_roles),
 'triggers_md5', (SELECT md5(string_agg(concat_ws('|',tgrelid::regclass::text,tgname,tgenabled::text), E'\n' ORDER BY tgrelid::regclass::text,tgname)) FROM pg_trigger WHERE NOT tgisinternal),
 'audit_log_rows', (SELECT count(*) FROM public.audit_log),
 'supabase_receipts', (SELECT count(*) FROM supabase_migrations.schema_migrations),
 'drizzle_receipts', (SELECT count(*) FROM drizzle.__drizzle_migrations),
 'policy_grants_md5', md5((SELECT setting FROM pg_settings WHERE name='supautils.policy_grants'))
) AS before_fingerprint;