-- Security 0031 read-only preflight. Generated from the approved package's own gate
-- expressions (docs/security/0031-package, sha256 32c17aa7...494f), plus gate 11
-- (supautils.policy_grants). A single SELECT: no DDL, no locks beyond AccessShare,
-- no writes. Run it in the production project immediately before the install.
--
-- GO only if: database=postgres, system_identifier=7642734024280108049,
-- current_user=postgres, drizzle_receipts=23, gate_journal_exact=true,
-- gate_partial_install_policies_present=0, gate_rls_count=5,
-- gate_role_helpers_drift=false,
-- gate_catalog_sha256=c753236ecd2c4067c9bce7262d7b4786f5c9ea8bcbb42ce531e8deba3db41446,
-- gate_audit_catalog_match=true, gate_audit_insert=true, gate_evidence_rows=0,
-- gate11_policy_grants_storage_objects=true, storage_objects_restrictive_policies=0,
-- supabase_receipts=105 (latest 20261011180000).
-- Last run 2026-10-24 against project 8cf1f99e / yuyzdsnrbfhkmfzpvhwx: every value as above.
SELECT jsonb_build_object(
 'database', current_database(), 'system_identifier', (SELECT system_identifier::text FROM pg_control_system()),
 'current_user', current_user, 'session_user', session_user,
 'superuser', (SELECT rolsuper FROM pg_roles WHERE rolname=current_user), 'server_version', current_setting('server_version'),
 'transaction_read_only', current_setting('transaction_read_only'),
 'drizzle_receipts', (SELECT count(*) FROM drizzle.__drizzle_migrations),
 'gate_journal_exact', (SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM (SELECT id,hash,created_at FROM drizzle.__drizzle_migrations) j) = '[{"created_at": 1791420975062, "hash": "60e27532f009295eb18cd9b0764093326417847d070f228be55c15afa3da53aa", "id": 1}, {"created_at": 1791421074958, "hash": "738ba1b78a229c55eaf5f4bb8446d86afd6ff25feccd5277adf5ad4409cabeb5", "id": 2}, {"created_at": 1791430766220, "hash": "cd11f5db078aaf63476e339f1cff6f581433a7978160ffdb74e328687700b138", "id": 3}, {"created_at": 1791431279577, "hash": "611235fa2841a9b977a0a9c730558f64eafe3193bb9a7799794d8af9f12f8b7b", "id": 4}, {"created_at": 1791432590443, "hash": "63623386f23a6c36cbc24cad601e469a5cb67a0ba52edf660aab72893395c033", "id": 5}, {"created_at": 1791432832737, "hash": "63695e00db5f1636954ad79f396d72937402d940fdc279e0578c43a5361cf271", "id": 6}, {"created_at": 1791458463060, "hash": "33c85b39c5410bc74e5302104d0f8cd062934f4fa4c4d8ae0c22c48d442bb808", "id": 7}, {"created_at": 1791459951490, "hash": "9442071c9712fa259c9255fbeadbb73657c552fb5c4bed1ec0114304e9257b43", "id": 8}, {"created_at": 1791462253541, "hash": "dcbabda64efa476c0b1c855807cf9747822af3dba4960771e1140a1cf56c5265", "id": 9}, {"created_at": 1791462346435, "hash": "ee0ee9066eb3e0e9fabf3415da1c64d9d68484252a4371062167e8cdfd503957", "id": 10}, {"created_at": 1791463536348, "hash": "18fb3113f234e0bb7834884e1e9c89a6d79ee880d4f59519b7399d990cbfcf77", "id": 11}, {"created_at": 1791463558283, "hash": "6a558eda9c92b87d352e3849bd509ee939d6b5801afa77c6fe7d9d7b893b743e", "id": 12}, {"created_at": 1791464019517, "hash": "873e4c4d4e4df1c0864291483d3fe805f3f4a1a5738f82572a3d2e5ab71022c4", "id": 13}, {"created_at": 1791471257211, "hash": "c5807075884bdd3f8b868b9491bec4d2c61d685d55a11653cf9bf8fbe727aae1", "id": 14}, {"created_at": 1791473301327, "hash": "0165723216a1346ae1dfab78180356c5f8b8a62038390119285a2f4ac6224890", "id": 15}, {"created_at": 1791473830599, "hash": "2f12f169a12fc3acba57fc46423c51a461f407222c5272fbf142905222eea1cc", "id": 16}, {"created_at": 1791477139776, "hash": "a3f9b526698a5f682f7b7162cec45ad75833e25a4fc16abfbf02a700944f040a", "id": 17}, {"created_at": 1791479523295, "hash": "71b806abd5211fbe63227473a03e947d6a51d9fcda68c9927c62a24481ba54c6", "id": 18}, {"created_at": 1791480452755, "hash": "cb6f88b17b356c9c6189da608829566f09ad6acd0d8411c0a38c332dd573dfc2", "id": 19}, {"created_at": 1791480942211, "hash": "6ab09e206256d0b3752f8eb4e32c60be9f78cd07837398203a52a172d2029a2e", "id": 20}, {"created_at": 1791481035617, "hash": "2c60e0bbd894ae6fd63fbafe8eb1956918169e43b7385ea11cca43f64be5cb80", "id": 21}, {"created_at": 1791496432098, "hash": "a8f14f62b9c84e02e0e07a276300e7be6ef7f0f8eec221acd9981d2604eac2de", "id": 22}, {"created_at": 1792408979135, "hash": "9ee4a1ced75ee787ab8647f67775ae4bb9c0bc7fc23d51acf17416e469948e11", "id": 23}]'::jsonb,
 'gate_partial_install_policies_present', (SELECT count(*) FROM pg_policies WHERE policyname=ANY(ARRAY['coordinator_application_containment','coordinator_review_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_agreement_containment'])),
 'gate_rls_count', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relrowsecurity AND ((n.nspname='public' AND c.relname IN ('applications','application_identity_reviews','documents','agreements')) OR (n.nspname='storage' AND c.relname='objects'))),
 'gate_role_helpers_drift', (regexp_replace(pg_get_functiondef('private.is_manager()'::regprocedure),'\s+',' ','g') IS DISTINCT FROM regexp_replace('CREATE OR REPLACE FUNCTION private.is_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN (''admin'', ''team'')
  )
$function$
','\s+',' ','g') OR regexp_replace(pg_get_functiondef('private.is_staff()'::regprocedure),'\s+',' ','g') IS DISTINCT FROM regexp_replace('CREATE OR REPLACE FUNCTION private.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN (''admin'', ''team'', ''coordinator'')
  )
$function$
','\s+',' ','g')),
 'gate_catalog_sha256', encode(sha256(convert_to((SELECT jsonb_build_object(
 'tables',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl::text,
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'def',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname)
 ) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='public' AND c.relname IN ('applications','application_identity_reviews','documents','agreements','user_roles')) OR (n.nspname='storage' AND c.relname='objects') OR (n.nspname='drizzle' AND c.relname='__drizzle_migrations')),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'bypassrls',rolbypassrls,'inherit',rolinherit) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('authenticated','anon')),
 'helpers',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'def',pg_get_functiondef(p.oid)) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN ('is_manager','is_staff') AND p.pronargs=0)
))::text,'UTF8')),'hex'),
 'gate_audit_catalog_match', (SELECT jsonb_build_object('owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl::text,'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid=c.oid),'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='audit_log')) FROM pg_class c WHERE c.oid='public.audit_log'::regclass) = '{"owner": "postgres", "rls": true, "force_rls": false, "acl": "{postgres=arwdDxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres,sandbox_exec=ar/postgres}", "columns": [{"name": "id", "type": "uuid", "notnull": true, "default": "extensions.gen_random_uuid()"}, {"name": "actor_user_id", "type": "uuid", "notnull": false, "default": null}, {"name": "actor_email", "type": "text", "notnull": false, "default": null}, {"name": "actor_role", "type": "text", "notnull": false, "default": null}, {"name": "action", "type": "text", "notnull": true, "default": null}, {"name": "entity_type", "type": "text", "notnull": false, "default": null}, {"name": "entity_id", "type": "text", "notnull": false, "default": null}, {"name": "summary", "type": "text", "notnull": true, "default": null}, {"name": "metadata", "type": "jsonb", "notnull": true, "default": "''{}''::jsonb"}, {"name": "ip", "type": "text", "notnull": false, "default": null}, {"name": "user_agent", "type": "text", "notnull": false, "default": null}, {"name": "created_at", "type": "timestamp with time zone", "notnull": true, "default": "now()"}], "constraints": ["FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL", "PRIMARY KEY (id)"], "triggers": null, "policies": [{"schemaname": "public", "tablename": "audit_log", "policyname": "Managers read the audit log", "permissive": "PERMISSIVE", "roles": ["authenticated"], "cmd": "SELECT", "qual": "private.is_manager()", "with_check": null}]}'::jsonb,
 'gate_audit_insert', has_table_privilege(current_user,'public.audit_log','INSERT'),
 'gate_evidence_rows', (SELECT count(*) FROM public.audit_log WHERE action='security_migration_verified' AND entity_type='database_migration' AND entity_id='0031_coordinator_containment'),
 'gate11_policy_grants_storage_objects', (SELECT setting FROM pg_settings WHERE name='supautils.policy_grants')::jsonb->'postgres' ? 'storage.objects',
 'privileged_role', (SELECT setting FROM pg_settings WHERE name='supautils.privileged_role'),
 'storage_objects_restrictive_policies', (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND permissive='RESTRICTIVE'),
 'supabase_receipts', (SELECT count(*) FROM supabase_migrations.schema_migrations),
 'supabase_latest', (SELECT jsonb_agg(v ORDER BY v DESC) FROM (SELECT version v FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3) x),
 'locks_waiting_on_targets', (SELECT count(*) FROM pg_locks l WHERE NOT l.granted)
) AS preflight;