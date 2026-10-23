-- Verify for HOSTED-INSTALL step 2: proposed/m3-packet/02-waitlist-coming-soon-rate.sql
-- Read-only. One row, ok true, after that step commits.

SELECT (
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'waitlist_coming_soon_email_limit'
      AND p.prosecdef IS TRUE
      AND p.prolang = (SELECT l.oid FROM pg_catalog.pg_language l WHERE l.lanname = 'plpgsql')
      AND EXISTS (
        SELECT 1
        FROM unnest(p.proconfig) AS item
        WHERE pg_catalog.replace(item, '"', '') = 'search_path='
      )
      AND p.prosrc LIKE '%waitlist coming soon rate limit%'
      AND p.prosrc LIKE '%pg_catalog.pg_advisory_xact_lock%'
      AND p.prosrc NOT LIKE '%claim_token_hash%'
      AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
  )
  AND NOT has_function_privilege('anon', 'public.waitlist_coming_soon_email_limit()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.waitlist_coming_soon_email_limit()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.waitlist_coming_soon_email_limit()', 'EXECUTE')
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    WHERE t.tgname = 'waitlist_coming_soon_email_limit'
      AND NOT t.tgisinternal
      AND t.tgrelid = 'public.waitlist'::regclass
      AND t.tgfoid = 'public.waitlist_coming_soon_email_limit()'::regprocedure
      AND t.tgtype = 7
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.tablename = 'waitlist'
      AND i.indexname = 'waitlist_coming_soon_email_created_idx'
      AND i.indexdef LIKE '%btrim%'
      AND i.indexdef LIKE '%lower%'
      AND i.indexdef LIKE '%created_at%'
  )
  AND to_regclass('public.waitlist') IS NOT NULL
) AS ok;
