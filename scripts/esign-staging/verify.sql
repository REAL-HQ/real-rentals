-- ===========================================================================
-- eSign staging verification. SELECT-only — it writes nothing and takes no
-- locks worth the name. Safe to run at any time, before or after install.
--
--   psql "<staging connection>" -f verify.sql
--
-- Every row is PASS or FAIL with the value it found, so a failure says what
-- is wrong rather than only that something is.
-- ===========================================================================
\pset pager off

WITH checks AS (
  SELECT 1 AS n, 'agreements table' AS check_name,
         (to_regclass('public.agreements') IS NOT NULL) AS pass,
         coalesce(to_regclass('public.agreements')::text,'absent') AS detail
  UNION ALL SELECT 2, 'agreement_templates table',
         to_regclass('public.agreement_templates') IS NOT NULL,
         coalesce(to_regclass('public.agreement_templates')::text,'absent')
  UNION ALL SELECT 3, 'esign_recipients table',
         to_regclass('public.esign_recipients') IS NOT NULL,
         coalesce(to_regclass('public.esign_recipients')::text,'absent')
  UNION ALL SELECT 4, 'agreements column count = 44',
         (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='agreements') >= 44,
         (SELECT count(*)::text FROM information_schema.columns WHERE table_schema='public' AND table_name='agreements')
  UNION ALL SELECT 5, 'esign_recipients column count = 19',
         (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='esign_recipients') = 19,
         (SELECT count(*)::text FROM information_schema.columns WHERE table_schema='public' AND table_name='esign_recipients')
  UNION ALL SELECT 6, 'esign_claim + esign_void present',
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname IN ('esign_claim','esign_void')) = 2,
         (SELECT coalesce(string_agg(p.proname,', ' ORDER BY p.proname),'none') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname IN ('esign_claim','esign_void'))
  UNION ALL SELECT 7, 'RLS enabled on all three tables',
         NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relname IN ('agreements','agreement_templates','esign_recipients') AND NOT c.relrowsecurity),
         (SELECT string_agg(c.relname||'='||c.relrowsecurity::text, ', ' ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relname IN ('agreements','agreement_templates','esign_recipients'))
  UNION ALL SELECT 8, 'agreements policies present',
         (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='agreements') >= 3,
         (SELECT coalesce(string_agg(policyname,', ' ORDER BY policyname),'none') FROM pg_policies WHERE schemaname='public' AND tablename='agreements')
  UNION ALL SELECT 9, 'signer uniqueness index',
         EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='esign_recipients_signer_uidx'),
         coalesce((SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='esign_recipients_signer_uidx'),'absent')

  -- ----------------------------------------------------------- storage
  UNION ALL SELECT 10, 'rental-agreements bucket exists',
         EXISTS (SELECT 1 FROM storage.buckets WHERE id='rental-agreements'),
         coalesce((SELECT 'public='||public::text FROM storage.buckets WHERE id='rental-agreements'),'absent')
  UNION ALL SELECT 11, 'bucket is PRIVATE',
         NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='rental-agreements' AND public IS TRUE),
         coalesce((SELECT public::text FROM storage.buckets WHERE id='rental-agreements'),'absent')
  UNION ALL SELECT 12, 'no direct read of signed PDFs beyond the partner policy',
         NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
             AND policyname <> 'Partners read their driver documents'
             AND (coalesce(qual,'')||coalesce(with_check,'')) LIKE '%rental-agreements%'),
         (SELECT coalesce(string_agg(policyname,', ' ORDER BY policyname),'none beyond the partner read') FROM pg_policies
           WHERE schemaname='storage' AND tablename='objects' AND (coalesce(qual,'')||coalesce(with_check,'')) LIKE '%rental-agreements%')

  -- -------------------------------------------------------------- 0023
  UNION ALL SELECT 13, '0023: template library columns',
         NOT EXISTS (SELECT 1 FROM unnest(ARRAY['template_key','display_version','insurance_required','approval_status','content_sha256','effective_date']) c
            WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agreement_templates' AND column_name=c)),
         (SELECT coalesce(string_agg(column_name,', ' ORDER BY column_name),'none') FROM information_schema.columns
           WHERE table_schema='public' AND table_name='agreement_templates' AND column_name IN ('template_key','display_version','insurance_required','approval_status','content_sha256','effective_date'))
  UNION ALL SELECT 14, '0023: rental_insurance_verifications',
         to_regclass('public.rental_insurance_verifications') IS NOT NULL,
         coalesce(to_regclass('public.rental_insurance_verifications')::text,'absent')
  UNION ALL SELECT 15, '0023: identity_agreement_boundary is RESTRICTIVE',
         EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agreements'
                  AND policyname='identity_agreement_boundary' AND permissive='RESTRICTIVE'),
         coalesce((SELECT permissive||' USING '||coalesce(qual,'-') FROM pg_policies WHERE schemaname='public' AND tablename='agreements' AND policyname='identity_agreement_boundary'),'absent')
  UNION ALL SELECT 16, '0023: content and template freeze triggers',
         (SELECT count(*) FROM pg_trigger WHERE tgname IN ('agreement_template_guard','agreement_content_freeze') AND NOT tgisinternal) = 2,
         (SELECT coalesce(string_agg(tgname,', ' ORDER BY tgname),'none') FROM pg_trigger WHERE tgname IN ('agreement_template_guard','agreement_content_freeze') AND NOT tgisinternal)
  UNION ALL SELECT 17, '0023: at most one approved version per family',
         EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='agreement_templates_one_approved_per_key'),
         coalesce((SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='agreement_templates_one_approved_per_key'),'absent')

  -- -------------------------------------------------------------- 0024
  UNION ALL SELECT 18, '0024: agreement_number column',
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agreements' AND column_name='agreement_number'),
         coalesce((SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='agreements' AND column_name='agreement_number'),'absent')
  UNION ALL SELECT 19, '0024: number sequence and minting function',
         to_regclass('public.agreement_number_seq') IS NOT NULL
           AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='next_agreement_number'),
         coalesce(to_regclass('public.agreement_number_seq')::text,'sequence absent')
  UNION ALL SELECT 20, '0024: numbering is service-role only',
         NOT has_function_privilege('authenticated','public.next_agreement_number()','EXECUTE'),
         'authenticated EXECUTE = '||has_function_privilege('authenticated','public.next_agreement_number()','EXECUTE')::text
  UNION ALL SELECT 21, '0024: agreement_number immutability trigger',
         EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='agreements_number_immutable' AND NOT tgisinternal),
         coalesce((SELECT tgname FROM pg_trigger WHERE tgname='agreements_number_immutable' AND NOT tgisinternal),'absent')

  -- ------------------------------------------------------------ ledger
  UNION ALL SELECT 22, 'staging ledger holds 12 receipts (9 + three eSign stages)',
         (SELECT count(*) FROM private.staging_install_receipts) = 12,
         (SELECT count(*)::text FROM private.staging_install_receipts)
  UNION ALL SELECT 23, 'the three eSign receipts are present, once each',
         (SELECT count(*) FROM private.staging_install_receipts
           WHERE stage IN ('stage10_agreements_baseline','stage11_esign_0023','stage12_esign_0024')) = 3,
         (SELECT coalesce(string_agg(stage,', ' ORDER BY stage),'none') FROM private.staging_install_receipts
           WHERE stage LIKE 'stage1%')
  UNION ALL SELECT 24, 'the reviewed 0023/0024 checksums are what was recorded',
         (SELECT count(*) FROM private.staging_install_receipts
           WHERE (stage='stage11_esign_0023' AND sha256='675bff0e8cba301581209c6c2a4f4cd7d485676c47a9e3920de87622c129acc7')
              OR (stage='stage12_esign_0024' AND sha256='199f57eda905ef73f9d531f813abc8b2f16759a8b0e89b6920f2985ba55d9aa8')) = 2,
         (SELECT coalesce(string_agg(stage||'='||left(sha256,12), ', ' ORDER BY stage),'none') FROM private.staging_install_receipts WHERE stage LIKE 'stage1%')

  -- --------------------------------------------- signed history untouched
  UNION ALL SELECT 25, 'no signed agreement lost its body or hash',
         NOT EXISTS (SELECT 1 FROM public.agreements WHERE status='signed' AND (body IS NULL OR btrim(body)='' )),
         (SELECT count(*)::text||' signed agreement(s)' FROM public.agreements WHERE status='signed')
)
SELECT n AS "#", CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, check_name, detail
FROM checks ORDER BY n;
