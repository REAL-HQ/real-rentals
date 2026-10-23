-- Read-only catalog fingerprint over the M2 packet's dependency surface.
-- One row per object: kind, object identity, sha256 of its definition.
-- Run identically on production and on the rehearsal; rows must be equal.
-- Excludes extension-owned objects and the rehearsal's own scaffolding.
WITH s AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('public','private','drizzle')),
rel AS (
  SELECT c.oid, s.nspname, c.relname, c.relkind FROM pg_class c JOIN s ON s.oid=c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','S')
    AND c.relname NOT LIKE 'zz\_rehearsal%' AND c.relname <> '__rehearsal_ledger'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype='e')),
o AS (
  SELECT 'rel' AS kind, r.nspname||'.'||r.relname AS obj, jsonb_build_object(
    'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'acl',c.relacl::text,
    'cols',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid),a.attacl::text) ORDER BY a.attnum)
            FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    'view',CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid) END)::text AS def
  FROM rel r JOIN pg_class c ON c.oid=r.oid
  UNION ALL
  SELECT 'con', r.nspname||'.'||r.relname||'.'||k.conname, pg_get_constraintdef(k.oid) FROM rel r JOIN pg_constraint k ON k.conrelid=r.oid
  UNION ALL
  SELECT 'idx', r.nspname||'.'||i.relname, pg_get_indexdef(i.oid) FROM rel r JOIN pg_index x ON x.indrelid=r.oid JOIN pg_class i ON i.oid=x.indexrelid
  UNION ALL
  SELECT 'trg', r.nspname||'.'||r.relname||'.'||t.tgname, pg_get_triggerdef(t.oid) FROM rel r JOIN pg_trigger t ON t.tgrelid=r.oid AND NOT t.tgisinternal
  UNION ALL
  SELECT 'pol', p.schemaname||'.'||p.tablename||'.'||p.policyname, jsonb_build_array(p.permissive,p.roles,p.cmd,p.qual,p.with_check)::text
  FROM pg_policies p WHERE p.schemaname IN ('public','private','drizzle','storage') AND p.policyname NOT LIKE 'zz\_%'
  UNION ALL
  SELECT 'fn', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    jsonb_build_array(pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),p.proacl::text,p.prosecdef,p.proconfig)::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','private') AND p.prokind IN ('f','p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')
  UNION ALL
  SELECT 'enum', n.nspname||'.'||t.typname, (SELECT string_agg(e.enumlabel,',' ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid)
  FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typtype='e' AND n.nspname IN ('public','private')
  UNION ALL
  SELECT 'nsp', s.nspname, (SELECT pg_get_userbyid(nspowner)||' '||coalesce(nspacl::text,'') FROM pg_namespace WHERE oid=s.oid) FROM s
  UNION ALL
  SELECT 'bucket', b.id, jsonb_build_array(b.public,b.file_size_limit,b.allowed_mime_types)::text FROM storage.buckets b
  UNION ALL
  SELECT 'ext', e.extname, e.extnamespace::regnamespace::text FROM pg_extension e
  UNION ALL
  SELECT 'role', r.rolname, r.rolsuper||' '||r.rolbypassrls FROM pg_roles r WHERE r.rolname LIKE 'rr\_%'
)
SELECT string_agg(kind||'|'||obj||'|'||left(encode(sha256(convert_to(coalesce(def,'<null>'),'UTF8')),'hex'),16), E'\n' ORDER BY kind, obj) AS fp FROM o
