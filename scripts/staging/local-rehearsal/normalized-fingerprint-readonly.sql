-- ADAPTED/LABELLED cross-database fingerprint (RECONSTRUCTED S1 era). Read-only. Excludes OIDs, attnums and
-- other internal ids: functions by signature + whitespace-normalised definition + ACL; tables by column NAME order;
-- policies, triggers (by name), constraints by definition. Output: object|md5 rows, then one overall md5.
-- On a remote database run inside: SET TRANSACTION READ ONLY; (requires separate Owner approval).
WITH f AS (
 SELECT 'function:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS obj,
  md5(regexp_replace(pg_get_functiondef(p.oid),'\s+',' ','g')||'|'||coalesce(p.proacl::text,'')||'|'||pg_get_userbyid(p.proowner)||'|'||p.prosecdef::text) AS h
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f'),
t AS (
 SELECT 'table:'||n.nspname||'.'||c.relname AS obj, md5(concat_ws('|',pg_get_userbyid(c.relowner),c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,
  (SELECT string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'')||':'||coalesce(a.attacl::text,''),',' ORDER BY a.attname)
     FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  (SELECT string_agg(pg_get_constraintdef(k.oid),',' ORDER BY pg_get_constraintdef(k.oid)) FROM pg_constraint k WHERE k.conrelid=c.oid),
  (SELECT string_agg(tg.tgname||':'||tg.tgenabled::text||':'||pg_get_triggerdef(tg.oid),',' ORDER BY tg.tgname) FROM pg_trigger tg WHERE tg.tgrelid=c.oid AND NOT tg.tgisinternal),
  (SELECT string_agg(concat_ws(':',policyname,permissive,roles::text,cmd,qual,with_check),',' ORDER BY policyname) FROM pg_policies pp WHERE pp.schemaname=n.nspname AND pp.tablename=c.relname))) AS h
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')),
a AS (SELECT * FROM f UNION ALL SELECT * FROM t)
SELECT obj||'|'||h FROM a UNION ALL SELECT 'OVERALL|'||md5(string_agg(obj||h,',' ORDER BY obj)) FROM a ORDER BY 1;
