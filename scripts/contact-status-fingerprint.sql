-- The state fingerprint the Contact Status installer recognises.
-- Read-only. One row, one column: '<columns>|<policy md5>|<trigger:function>'.
SELECT format('%s|%s|%s',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='applications'),
  md5(coalesce((SELECT string_agg(policyname || '/' || cmd || '/' ||
         coalesce(permissive,'') || '/' || coalesce(array_to_string(roles,'+'),'') || '/' ||
         coalesce(qual,'') || '/' || coalesce(with_check,''), E'\n' ORDER BY policyname)
       FROM pg_policies WHERE schemaname='public' AND tablename='applications'), '')),
  (SELECT string_agg(t.tgname || ':' || p.proname, ', ' ORDER BY t.tgname)
     FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public.applications'::regclass AND NOT t.tgisinternal));
