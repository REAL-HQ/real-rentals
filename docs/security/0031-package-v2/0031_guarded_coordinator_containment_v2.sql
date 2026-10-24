-- PREPARATION ONLY. Single statement; send only with the pinned Lovable project ID.
-- Provider owns the outer transaction and automatic receipt. No explicit transaction commands.
DO $rr0031$
DECLARE
 profile jsonb := '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres", "catalog_sha256": "c753236ecd2c4067c9bce7262d7b4786f5c9ea8bcbb42ce531e8deba3db41446"}'::jsonb;
 approved_sql text := $approved0031$-- PROPOSED ONLY. Runner owns transaction and journal write.
-- Temporary containment; no grants or stored records are changed.
-- Preserve existing permissive policies; these boundaries only subtract access.
CREATE POLICY coordinator_application_containment ON public.applications
AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.is_manager() IS TRUE OR private.is_staff() IS FALSE);

-- Review notes and conflict details are not a safe status-only projection.
CREATE POLICY coordinator_review_containment ON public.application_identity_reviews
AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.is_manager() IS TRUE OR private.is_staff() IS FALSE);

-- Metadata can carry private identity paths. Retain unrelated vehicle documents.
CREATE POLICY coordinator_document_containment ON public.documents
AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.is_manager() IS TRUE OR private.is_staff() IS FALSE OR (
 driver_id IS NULL AND
 storage_bucket NOT IN ('license-uploads','profile-screenshots','driver-docs','rental-agreements') AND
 coalesce(category,'') NOT IN ('license_front','license_back','insurance','insurance_card','gig_profile','trip_history','verification_recording','agreement')
));

CREATE POLICY coordinator_identity_storage_containment ON storage.objects
AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.is_manager() IS TRUE OR private.is_staff() IS FALSE OR
 bucket_id NOT IN ('license-uploads','profile-screenshots','driver-docs','rental-agreements'));

-- Existing agreements can embed full licence numbers. No eSign feature change.
DO $containment$
BEGIN
 IF to_regclass('public.agreements') IS NOT NULL THEN
  EXECUTE 'CREATE POLICY coordinator_agreement_containment ON public.agreements
   AS RESTRICTIVE FOR SELECT TO authenticated
   USING (private.is_manager() IS TRUE OR private.is_staff() IS FALSE)';
 END IF;
END;
$containment$;
$approved0031$;
 before_catalog jsonb;
 after_catalog jsonb;
 policies jsonb;
 journal jsonb;
 receipt_stamp bigint;
 receipt_count integer;
BEGIN
 IF profile->>'project_ref' IS DISTINCT FROM 'yuyzdsnrbfhkmfzpvhwx'
 OR profile->>'lovable_project_id' IS DISTINCT FROM '8cf1f99e-71ad-4a93-a47c-bfbe833616d6'
 OR profile->>'system_identifier' IS NULL OR profile->>'catalog_sha256' IS NULL
 OR profile->>'execution_role' IS NULL THEN RAISE EXCEPTION 'UNSEALED_TARGET_PROFILE'; END IF;
 IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM profile->>'system_identifier'
 OR current_database() IS DISTINCT FROM profile->>'database'
 OR current_user IS DISTINCT FROM profile->>'execution_role'
 THEN RAISE EXCEPTION 'TARGET_MISMATCH'; END IF;
 IF encode(sha256(convert_to(approved_sql,'UTF8')),'hex') <> 'cf8d5572670cb3f865fc0911d623ff070e6a9be1ca8d254c87db8f2a5c3cd723' THEN RAISE EXCEPTION 'SQL_CHECKSUM_MISMATCH'; END IF;
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM set_config('statement_timeout','30s',true);
 PERFORM pg_advisory_xact_lock(7310031);
 LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE;
 LOCK TABLE public.applications,public.application_identity_reviews,public.documents,public.agreements,public.user_roles,storage.objects IN SHARE UPDATE EXCLUSIVE MODE;
 SELECT jsonb_agg(to_jsonb(j) ORDER BY id) INTO journal FROM (SELECT id,hash,created_at FROM drizzle.__drizzle_migrations) j;
 IF journal IS DISTINCT FROM '[{"created_at": 1791420975062, "hash": "60e27532f009295eb18cd9b0764093326417847d070f228be55c15afa3da53aa", "id": 1}, {"created_at": 1791421074958, "hash": "738ba1b78a229c55eaf5f4bb8446d86afd6ff25feccd5277adf5ad4409cabeb5", "id": 2}, {"created_at": 1791430766220, "hash": "cd11f5db078aaf63476e339f1cff6f581433a7978160ffdb74e328687700b138", "id": 3}, {"created_at": 1791431279577, "hash": "611235fa2841a9b977a0a9c730558f64eafe3193bb9a7799794d8af9f12f8b7b", "id": 4}, {"created_at": 1791432590443, "hash": "63623386f23a6c36cbc24cad601e469a5cb67a0ba52edf660aab72893395c033", "id": 5}, {"created_at": 1791432832737, "hash": "63695e00db5f1636954ad79f396d72937402d940fdc279e0578c43a5361cf271", "id": 6}, {"created_at": 1791458463060, "hash": "33c85b39c5410bc74e5302104d0f8cd062934f4fa4c4d8ae0c22c48d442bb808", "id": 7}, {"created_at": 1791459951490, "hash": "9442071c9712fa259c9255fbeadbb73657c552fb5c4bed1ec0114304e9257b43", "id": 8}, {"created_at": 1791462253541, "hash": "dcbabda64efa476c0b1c855807cf9747822af3dba4960771e1140a1cf56c5265", "id": 9}, {"created_at": 1791462346435, "hash": "ee0ee9066eb3e0e9fabf3415da1c64d9d68484252a4371062167e8cdfd503957", "id": 10}, {"created_at": 1791463536348, "hash": "18fb3113f234e0bb7834884e1e9c89a6d79ee880d4f59519b7399d990cbfcf77", "id": 11}, {"created_at": 1791463558283, "hash": "6a558eda9c92b87d352e3849bd509ee939d6b5801afa77c6fe7d9d7b893b743e", "id": 12}, {"created_at": 1791464019517, "hash": "873e4c4d4e4df1c0864291483d3fe805f3f4a1a5738f82572a3d2e5ab71022c4", "id": 13}, {"created_at": 1791471257211, "hash": "c5807075884bdd3f8b868b9491bec4d2c61d685d55a11653cf9bf8fbe727aae1", "id": 14}, {"created_at": 1791473301327, "hash": "0165723216a1346ae1dfab78180356c5f8b8a62038390119285a2f4ac6224890", "id": 15}, {"created_at": 1791473830599, "hash": "2f12f169a12fc3acba57fc46423c51a461f407222c5272fbf142905222eea1cc", "id": 16}, {"created_at": 1791477139776, "hash": "a3f9b526698a5f682f7b7162cec45ad75833e25a4fc16abfbf02a700944f040a", "id": 17}, {"created_at": 1791479523295, "hash": "71b806abd5211fbe63227473a03e947d6a51d9fcda68c9927c62a24481ba54c6", "id": 18}, {"created_at": 1791480452755, "hash": "cb6f88b17b356c9c6189da608829566f09ad6acd0d8411c0a38c332dd573dfc2", "id": 19}, {"created_at": 1791480942211, "hash": "6ab09e206256d0b3752f8eb4e32c60be9f78cd07837398203a52a172d2029a2e", "id": 20}, {"created_at": 1791481035617, "hash": "2c60e0bbd894ae6fd63fbafe8eb1956918169e43b7385ea11cca43f64be5cb80", "id": 21}, {"created_at": 1791496432098, "hash": "a8f14f62b9c84e02e0e07a276300e7be6ef7f0f8eec221acd9981d2604eac2de", "id": 22}, {"created_at": 1792408979135, "hash": "9ee4a1ced75ee787ab8647f67775ae4bb9c0bc7fc23d51acf17416e469948e11", "id": 23}]'::jsonb THEN RAISE EXCEPTION 'JOURNAL_DRIFT_OR_REPLAY'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policies WHERE policyname=ANY(ARRAY['coordinator_application_containment','coordinator_review_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_agreement_containment'])) THEN RAISE EXCEPTION 'PARTIAL_INSTALL'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relrowsecurity AND ((n.nspname='public' AND c.relname IN ('applications','application_identity_reviews','documents','agreements')) OR (n.nspname='storage' AND c.relname='objects')))<>5 THEN RAISE EXCEPTION 'RLS_MISMATCH'; END IF;
 IF regexp_replace(pg_get_functiondef('private.is_manager()'::regprocedure),'\s+',' ','g') IS DISTINCT FROM regexp_replace('CREATE OR REPLACE FUNCTION private.is_manager()
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
','\s+',' ','g') THEN RAISE EXCEPTION 'ROLE_HELPER_DRIFT'; END IF;
 before_catalog := (SELECT jsonb_build_object(
 'tables',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl::text,
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'def',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname)
 ) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='public' AND c.relname IN ('applications','application_identity_reviews','documents','agreements','user_roles')) OR (n.nspname='storage' AND c.relname='objects') OR (n.nspname='drizzle' AND c.relname='__drizzle_migrations')),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'bypassrls',rolbypassrls,'inherit',rolinherit) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('authenticated','anon')),
 'helpers',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'def',pg_get_functiondef(p.oid)) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN ('is_manager','is_staff') AND p.pronargs=0)
));
 IF encode(sha256(convert_to(before_catalog::text,'UTF8')),'hex') IS DISTINCT FROM profile->>'catalog_sha256' THEN RAISE EXCEPTION 'SCHEMA_POLICY_GRANT_DRIFT'; END IF;
 LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE;
 IF (SELECT jsonb_build_object('owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl::text,'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid=c.oid),'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='audit_log')) FROM pg_class c WHERE c.oid='public.audit_log'::regclass) IS DISTINCT FROM '{"owner": "postgres", "rls": true, "force_rls": false, "acl": "{postgres=arwdDxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres,sandbox_exec=ar/postgres}", "columns": [{"name": "id", "type": "uuid", "notnull": true, "default": "extensions.gen_random_uuid()"}, {"name": "actor_user_id", "type": "uuid", "notnull": false, "default": null}, {"name": "actor_email", "type": "text", "notnull": false, "default": null}, {"name": "actor_role", "type": "text", "notnull": false, "default": null}, {"name": "action", "type": "text", "notnull": true, "default": null}, {"name": "entity_type", "type": "text", "notnull": false, "default": null}, {"name": "entity_id", "type": "text", "notnull": false, "default": null}, {"name": "summary", "type": "text", "notnull": true, "default": null}, {"name": "metadata", "type": "jsonb", "notnull": true, "default": "''{}''::jsonb"}, {"name": "ip", "type": "text", "notnull": false, "default": null}, {"name": "user_agent", "type": "text", "notnull": false, "default": null}, {"name": "created_at", "type": "timestamp with time zone", "notnull": true, "default": "now()"}], "constraints": ["FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL", "PRIMARY KEY (id)"], "triggers": null, "policies": [{"schemaname": "public", "tablename": "audit_log", "policyname": "Managers read the audit log", "permissive": "PERMISSIVE", "roles": ["authenticated"], "cmd": "SELECT", "qual": "private.is_manager()", "with_check": null}]}'::jsonb THEN RAISE EXCEPTION 'AUDIT_CATALOG_DRIFT'; END IF;
 IF NOT has_table_privilege(current_user,'public.audit_log','INSERT') THEN RAISE EXCEPTION 'AUDIT_INSERT_UNAVAILABLE'; END IF;
 -- Native CREATE POLICY and INSERT permission checks remain authoritative; no role elevation.
 EXECUTE approved_sql;
 -- TEST_FAILURE_POINT (only disposable test copies may inject failure here)
 SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) INTO policies FROM (SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE policyname=ANY(ARRAY['coordinator_application_containment','coordinator_review_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_agreement_containment'])) p;
 IF policies IS DISTINCT FROM '[{"schemaname": "public", "tablename": "agreements", "policyname": "coordinator_agreement_containment", "permissive": "RESTRICTIVE", "roles": ["authenticated"], "cmd": "SELECT", "qual": "((private.is_manager() IS TRUE) OR (private.is_staff() IS FALSE))", "with_check": null}, {"schemaname": "public", "tablename": "applications", "policyname": "coordinator_application_containment", "permissive": "RESTRICTIVE", "roles": ["authenticated"], "cmd": "SELECT", "qual": "((private.is_manager() IS TRUE) OR (private.is_staff() IS FALSE))", "with_check": null}, {"schemaname": "public", "tablename": "documents", "policyname": "coordinator_document_containment", "permissive": "RESTRICTIVE", "roles": ["authenticated"], "cmd": "SELECT", "qual": "((private.is_manager() IS TRUE) OR (private.is_staff() IS FALSE) OR ((driver_id IS NULL) AND (storage_bucket <> ALL (ARRAY[''license-uploads''::text, ''profile-screenshots''::text, ''driver-docs''::text, ''rental-agreements''::text])) AND (COALESCE(category, ''''::text) <> ALL (ARRAY[''license_front''::text, ''license_back''::text, ''insurance''::text, ''insurance_card''::text, ''gig_profile''::text, ''trip_history''::text, ''verification_recording''::text, ''agreement''::text]))))", "with_check": null}, {"schemaname": "storage", "tablename": "objects", "policyname": "coordinator_identity_storage_containment", "permissive": "RESTRICTIVE", "roles": ["authenticated"], "cmd": "SELECT", "qual": "((private.is_manager() IS TRUE) OR (private.is_staff() IS FALSE) OR (bucket_id <> ALL (ARRAY[''license-uploads''::text, ''profile-screenshots''::text, ''driver-docs''::text, ''rental-agreements''::text])))", "with_check": null}, {"schemaname": "public", "tablename": "application_identity_reviews", "policyname": "coordinator_review_containment", "permissive": "RESTRICTIVE", "roles": ["authenticated"], "cmd": "SELECT", "qual": "((private.is_manager() IS TRUE) OR (private.is_staff() IS FALSE))", "with_check": null}]'::jsonb THEN RAISE EXCEPTION 'POST_POLICY_MISMATCH'; END IF;
 -- The runner must append exactly one automatic receipt AFTER this statement.
 SELECT jsonb_agg(to_jsonb(j) ORDER BY id) INTO journal FROM (SELECT id,hash,created_at FROM drizzle.__drizzle_migrations) j;
 IF journal IS DISTINCT FROM '[{"created_at": 1791420975062, "hash": "60e27532f009295eb18cd9b0764093326417847d070f228be55c15afa3da53aa", "id": 1}, {"created_at": 1791421074958, "hash": "738ba1b78a229c55eaf5f4bb8446d86afd6ff25feccd5277adf5ad4409cabeb5", "id": 2}, {"created_at": 1791430766220, "hash": "cd11f5db078aaf63476e339f1cff6f581433a7978160ffdb74e328687700b138", "id": 3}, {"created_at": 1791431279577, "hash": "611235fa2841a9b977a0a9c730558f64eafe3193bb9a7799794d8af9f12f8b7b", "id": 4}, {"created_at": 1791432590443, "hash": "63623386f23a6c36cbc24cad601e469a5cb67a0ba52edf660aab72893395c033", "id": 5}, {"created_at": 1791432832737, "hash": "63695e00db5f1636954ad79f396d72937402d940fdc279e0578c43a5361cf271", "id": 6}, {"created_at": 1791458463060, "hash": "33c85b39c5410bc74e5302104d0f8cd062934f4fa4c4d8ae0c22c48d442bb808", "id": 7}, {"created_at": 1791459951490, "hash": "9442071c9712fa259c9255fbeadbb73657c552fb5c4bed1ec0114304e9257b43", "id": 8}, {"created_at": 1791462253541, "hash": "dcbabda64efa476c0b1c855807cf9747822af3dba4960771e1140a1cf56c5265", "id": 9}, {"created_at": 1791462346435, "hash": "ee0ee9066eb3e0e9fabf3415da1c64d9d68484252a4371062167e8cdfd503957", "id": 10}, {"created_at": 1791463536348, "hash": "18fb3113f234e0bb7834884e1e9c89a6d79ee880d4f59519b7399d990cbfcf77", "id": 11}, {"created_at": 1791463558283, "hash": "6a558eda9c92b87d352e3849bd509ee939d6b5801afa77c6fe7d9d7b893b743e", "id": 12}, {"created_at": 1791464019517, "hash": "873e4c4d4e4df1c0864291483d3fe805f3f4a1a5738f82572a3d2e5ab71022c4", "id": 13}, {"created_at": 1791471257211, "hash": "c5807075884bdd3f8b868b9491bec4d2c61d685d55a11653cf9bf8fbe727aae1", "id": 14}, {"created_at": 1791473301327, "hash": "0165723216a1346ae1dfab78180356c5f8b8a62038390119285a2f4ac6224890", "id": 15}, {"created_at": 1791473830599, "hash": "2f12f169a12fc3acba57fc46423c51a461f407222c5272fbf142905222eea1cc", "id": 16}, {"created_at": 1791477139776, "hash": "a3f9b526698a5f682f7b7162cec45ad75833e25a4fc16abfbf02a700944f040a", "id": 17}, {"created_at": 1791479523295, "hash": "71b806abd5211fbe63227473a03e947d6a51d9fcda68c9927c62a24481ba54c6", "id": 18}, {"created_at": 1791480452755, "hash": "cb6f88b17b356c9c6189da608829566f09ad6acd0d8411c0a38c332dd573dfc2", "id": 19}, {"created_at": 1791480942211, "hash": "6ab09e206256d0b3752f8eb4e32c60be9f78cd07837398203a52a172d2029a2e", "id": 20}, {"created_at": 1791481035617, "hash": "2c60e0bbd894ae6fd63fbafe8eb1956918169e43b7385ea11cca43f64be5cb80", "id": 21}, {"created_at": 1791496432098, "hash": "a8f14f62b9c84e02e0e07a276300e7be6ef7f0f8eec221acd9981d2604eac2de", "id": 22}, {"created_at": 1792408979135, "hash": "9ee4a1ced75ee787ab8647f67775ae4bb9c0bc7fc23d51acf17416e469948e11", "id": 23}]'::jsonb THEN RAISE EXCEPTION 'POST_JOURNAL_CHANGED'; END IF;
 after_catalog := (SELECT jsonb_build_object(
 'tables',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl::text,
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'def',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname)
 ) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='public' AND c.relname IN ('applications','application_identity_reviews','documents','agreements','user_roles')) OR (n.nspname='storage' AND c.relname='objects') OR (n.nspname='drizzle' AND c.relname='__drizzle_migrations')),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'bypassrls',rolbypassrls,'inherit',rolinherit) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('authenticated','anon')),
 'helpers',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'def',pg_get_functiondef(p.oid)) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN ('is_manager','is_staff') AND p.pronargs=0)
));
 -- Only the five reviewed policies may differ after DDL; grants, columns and helpers must remain identical.
 SELECT jsonb_set(after_catalog,'{tables}',jsonb_agg(jsonb_set(t,'{policies}',coalesce((SELECT jsonb_agg(p ORDER BY (p->>'policyname') COLLATE "C") FROM jsonb_array_elements(coalesce(nullif(t->'policies','null'::jsonb),'[]'::jsonb)) p WHERE p->>'policyname' NOT IN ('coordinator_application_containment','coordinator_review_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_agreement_containment')),'null'::jsonb)) ORDER BY t->>'schema',t->>'name')) INTO after_catalog FROM jsonb_array_elements(after_catalog->'tables') t;
 IF after_catalog IS DISTINCT FROM before_catalog THEN RAISE EXCEPTION 'POST_UNEXPECTED_CATALOG_CHANGE'; END IF;
DECLARE
 evidence_time timestamptz := clock_timestamp();
 evidence_id uuid;
BEGIN
 LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE action='security_migration_verified' AND entity_type='database_migration' AND entity_id='0031_coordinator_containment') THEN
  RAISE EXCEPTION 'EXECUTION_EVIDENCE_REPLAY';
 END IF;
 INSERT INTO public.audit_log(actor_user_id,actor_email,actor_role,action,entity_type,entity_id,summary,metadata,created_at)
 VALUES(NULL,NULL,current_user,'security_migration_verified','database_migration','0031_coordinator_containment',
 '0031 containment postconditions verified by database migration executor',
 jsonb_build_object('project_ref','yuyzdsnrbfhkmfzpvhwx','execution_at',evidence_time,
 'transaction_id',txid_current()::text,'database_executor',current_user,'session_executor',session_user,
 'original_sql_sha256','cf8d5572670cb3f865fc0911d623ff070e6a9be1ca8d254c87db8f2a5c3cd723',
 'baseline_catalog_sha256','c753236ecd2c4067c9bce7262d7b4786f5c9ea8bcbb42ce531e8deba3db41446',
 'journal_timestamp',1791970564241,'verified_policies',policies),evidence_time)
 RETURNING id INTO evidence_id;
 IF evidence_id IS NULL OR (SELECT count(*) FROM public.audit_log WHERE action='security_migration_verified' AND entity_type='database_migration' AND entity_id='0031_coordinator_containment')<>1 THEN
  RAISE EXCEPTION 'EXECUTION_EVIDENCE_MISMATCH';
 END IF;
END;


END;
$rr0031$;
