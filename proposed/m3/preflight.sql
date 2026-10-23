-- Read-only checklist before proposed/m3/HOSTED-INSTALL.md. Do not install
-- from this file. A report row stays ok when the count is not zero.
-- An absent row must be absent on the first install. After the packet is
-- installed those absent rows are false, which means it is already there.

SELECT check_name, expected, actual, ok
FROM (
  SELECT 10 AS ord, 'server_version'::text AS check_name, 'report'::text AS expected,
         current_setting('server_version') AS actual, true AS ok
  UNION ALL
  SELECT 20, 'applications rows', 'report', count(*)::text, true
  FROM public.applications
  UNION ALL
  SELECT 30, 'waitlist rows', 'report', count(*)::text, true
  FROM public.waitlist
  UNION ALL
  SELECT 40, 'public.applications.license_expiration', 'date nullable',
         COALESCE((
           SELECT c.data_type || ' nullable=' || c.is_nullable
           FROM information_schema.columns c
           WHERE c.table_schema = 'public' AND c.table_name = 'applications' AND c.column_name = 'license_expiration'
         ), 'absent'),
         COALESCE((
           SELECT c.data_type = 'date' AND c.is_nullable = 'YES'
           FROM information_schema.columns c
           WHERE c.table_schema = 'public' AND c.table_name = 'applications' AND c.column_name = 'license_expiration'
         ), false)
  UNION ALL
  SELECT 50, 'public.applications.insurance_expires_on', 'date nullable',
         COALESCE((
           SELECT c.data_type || ' nullable=' || c.is_nullable
           FROM information_schema.columns c
           WHERE c.table_schema = 'public' AND c.table_name = 'applications' AND c.column_name = 'insurance_expires_on'
         ), 'absent'),
         COALESCE((
           SELECT c.data_type = 'date' AND c.is_nullable = 'YES'
           FROM information_schema.columns c
           WHERE c.table_schema = 'public' AND c.table_name = 'applications' AND c.column_name = 'insurance_expires_on'
         ), false)
  UNION ALL
  SELECT 60, 'public.applications.tnc_uber_approval_expires_on', 'report',
         COALESCE((
           SELECT c.data_type
           FROM information_schema.columns c
           WHERE c.table_schema = 'public' AND c.table_name = 'applications' AND c.column_name = 'tnc_uber_approval_expires_on'
         ), 'absent'),
         true
  UNION ALL
  SELECT 70, 'public.applications.tnc_lyft_approval_expires_on', 'report',
         COALESCE((
           SELECT c.data_type
           FROM information_schema.columns c
           WHERE c.table_schema = 'public' AND c.table_name = 'applications' AND c.column_name = 'tnc_lyft_approval_expires_on'
         ), 'absent'),
         true
  UNION ALL
  SELECT 80, 'role anon', 'present',
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'anon') THEN 'present' ELSE 'absent' END,
         EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'anon')
  UNION ALL
  SELECT 90, 'role authenticated', 'present',
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'authenticated') THEN 'present' ELSE 'absent' END,
         EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'authenticated')
  UNION ALL
  SELECT 100, 'role service_role', 'present',
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'service_role') THEN 'present' ELSE 'absent' END,
         EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'service_role')
  UNION ALL
  SELECT 110, 'installer owns public.applications', 'owner bypass',
         pg_catalog.pg_get_userbyid(c.relowner) || ' super=' || r.rolsuper::text || ' bypass=' || r.rolbypassrls::text,
         r.rolsuper OR r.rolbypassrls
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
  WHERE c.oid = 'public.applications'::regclass
  UNION ALL
  SELECT 120, 'installer owns public.waitlist', 'owner bypass',
         pg_catalog.pg_get_userbyid(c.relowner) || ' super=' || r.rolsuper::text || ' bypass=' || r.rolbypassrls::text,
         r.rolsuper OR r.rolbypassrls
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
  WHERE c.oid = 'public.waitlist'::regclass
  UNION ALL
  SELECT 130, 'public.waitlist_coming_soon_email_limit()', 'absent',
         COALESCE(to_regprocedure('public.waitlist_coming_soon_email_limit()')::text, 'absent'),
         to_regprocedure('public.waitlist_coming_soon_email_limit()') IS NULL
  UNION ALL
  SELECT 140, 'trigger waitlist_coming_soon_email_limit', 'absent',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_catalog.pg_trigger t
           WHERE t.tgname = 'waitlist_coming_soon_email_limit' AND NOT t.tgisinternal
         ) THEN 'present' ELSE 'absent' END,
         NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_trigger t
           WHERE t.tgname = 'waitlist_coming_soon_email_limit' AND NOT t.tgisinternal
         )
  UNION ALL
  SELECT 150, 'index waitlist_coming_soon_email_created_idx', 'absent',
         COALESCE(to_regclass('public.waitlist_coming_soon_email_created_idx')::text, 'absent'),
         to_regclass('public.waitlist_coming_soon_email_created_idx') IS NULL
  UNION ALL
  SELECT 160, 'anon waitlist insert columns',
         'driver_status,email,full_name,gclid,market_id,phone,source,utm_campaign,utm_content,utm_medium,utm_source,utm_term',
         COALESCE((
           SELECT string_agg(a.attname, ',' ORDER BY a.attname)
           FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = 'public.waitlist'::regclass
             AND a.attnum > 0
             AND NOT a.attisdropped
             AND pg_catalog.has_column_privilege('anon', a.attrelid, a.attname, 'INSERT')
         ), ''),
         COALESCE((
           SELECT string_agg(a.attname, ',' ORDER BY a.attname)
           FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = 'public.waitlist'::regclass
             AND a.attnum > 0
             AND NOT a.attisdropped
             AND pg_catalog.has_column_privilege('anon', a.attrelid, a.attname, 'INSERT')
         ), '') = 'driver_status,email,full_name,gclid,market_id,phone,source,utm_campaign,utm_content,utm_medium,utm_source,utm_term'
  UNION ALL
  SELECT 170, 'public.waitlist.claim_token_hash', 'report',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema = 'public' AND c.table_name = 'waitlist' AND c.column_name = 'claim_token_hash'
         ) THEN 'present' ELSE 'absent' END,
         true
) checks
ORDER BY ord;
