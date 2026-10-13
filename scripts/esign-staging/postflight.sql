-- ===========================================================================
-- Per-stage postflight. Runs INSIDE the stage transaction, after the payload
-- and the receipt. Any failure raises, so the stage — work and receipt
-- together — rolls back. This is what makes "installed completely or not at
-- all" true rather than hoped for.
--
-- psql variables the runner sets:
--   :stage_name           the stage just applied
--   :expect_receipt_after what the ledger must hold now (one more than before)
--   :baseline_digest      the nine pinned receipts, as in preflight
-- ===========================================================================

SELECT set_config('install.stage_name', :'stage_name', true) AS _p1,
       set_config('install.expect_receipt_after', :'expect_receipt_after', true) AS _p2,
       set_config('install.baseline_digest', :'baseline_digest', true) AS _p3
\gset

-- The receipt landed, exactly once, and nothing else moved in the ledger.
DO $$
DECLARE n int; mine int;
BEGIN
  SELECT count(*) INTO n FROM private.staging_install_receipts;
  IF n <> current_setting('install.expect_receipt_after')::int THEN
    RAISE EXCEPTION 'STOP: ledger holds % receipt(s), expected %. Rolling back.', n, current_setting('install.expect_receipt_after');
  END IF;
  SELECT count(*) INTO mine FROM private.staging_install_receipts WHERE stage = current_setting('install.stage_name');
  IF mine <> 1 THEN
    RAISE EXCEPTION 'STOP: % receipt row(s) for this stage, expected exactly 1. Rolling back.', mine;
  END IF;
END $$;

-- The nine are still the nine. Preflight proved it before the payload ran;
-- this proves the payload did not touch them on its way past. A migration
-- that rewrote a historical receipt would otherwise commit silently, and the
-- ledger is the only record of what staging has had installed.
DO $$
DECLARE want text; got text;
BEGIN
  want := current_setting('install.baseline_digest');
  SELECT string_agg(ord || ':' || stage || ':' || sha256, '|' ORDER BY ord) INTO got
    FROM (SELECT row_number() OVER (ORDER BY installed_at, stage) AS ord, stage, sha256
            FROM private.staging_install_receipts
           WHERE stage NOT IN ('stage10_agreements_baseline','stage11_esign_0023','stage12_esign_0024')) r;
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION E'STOP: this stage altered the nine pre-existing receipts. Rolling back.\npinned: %\nnow:    %', want, got;
  END IF;
END $$;

-- Time only moves forward in the journal. A receipt dated before the nine it
-- follows would make the install order unreadable, and the install order is
-- what the baseline comparison keys on.
DO $$
DECLARE newest timestamptz; mine timestamptz;
BEGIN
  SELECT max(installed_at) INTO newest FROM private.staging_install_receipts
   WHERE stage <> current_setting('install.stage_name');
  SELECT installed_at INTO mine FROM private.staging_install_receipts
   WHERE stage = current_setting('install.stage_name');
  IF newest IS NOT NULL AND mine < newest THEN
    RAISE EXCEPTION 'STOP: this receipt is dated % but the ledger already holds one at %. Receipts are never backdated. Rolling back.', mine, newest;
  END IF;
END $$;

-- ------------------------------------------------- stage10: the baseline
DO $$
DECLARE missing text;
BEGIN
  IF current_setting('install.stage_name') <> 'stage10_agreements_baseline' THEN RETURN; END IF;

  SELECT string_agg(t, ', ') INTO missing FROM unnest(ARRAY[
    'public.agreements','public.agreement_templates','public.esign_recipients'
  ]) t WHERE to_regclass(t) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'STOP: table(s) not created: %', missing; END IF;

  -- The two signing RPCs, which are the whole concurrency story.
  SELECT string_agg(f, ', ') INTO missing FROM unnest(ARRAY['esign_claim','esign_void']) f
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                      WHERE n.nspname='public' AND p.proname=f);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'STOP: signing function(s) not created: %', missing; END IF;

  -- Column counts, against the production shape this baseline was taken from.
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='agreements') <> 44 THEN
    RAISE EXCEPTION 'STOP: public.agreements has % columns, expected 44.',
      (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='agreements');
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='esign_recipients') <> 19 THEN
    RAISE EXCEPTION 'STOP: public.esign_recipients has % columns, expected 19.',
      (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='esign_recipients');
  END IF;

  -- RLS on all three. A table with policies but RLS off enforces nothing.
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='public'
                AND c.relname IN ('agreements','agreement_templates','esign_recipients')
                AND NOT c.relrowsecurity) THEN
    RAISE EXCEPTION 'STOP: row level security is not enabled on every agreements table.';
  END IF;

  -- The four reviewed policies.
  SELECT string_agg(p, ', ') INTO missing FROM unnest(ARRAY[
    'Managers manage agreements','Staff read agreements','Drivers view their own agreements'
  ]) p WHERE NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agreements' AND policyname=p);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'STOP: agreements policy/policies missing: %', missing; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='esign_recipients' AND policyname='Staff read recipients') THEN
    RAISE EXCEPTION 'STOP: the recipients read policy is missing.';
  END IF;

  -- The partial signer index: one signer per position, CC rows unconstrained.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='esign_recipients_signer_uidx') THEN
    RAISE EXCEPTION 'STOP: esign_recipients_signer_uidx is missing.';
  END IF;

  -- Private storage. The bucket exists and is not public, and nothing has
  -- granted a direct browser read of a signed contract.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='rental-agreements') THEN
    RAISE EXCEPTION 'STOP: the rental-agreements bucket was not created.';
  END IF;
  -- The privileged step ran before this stage and must still be in place.
  -- Required, not optional: a bucket without it is a partial installation of
  -- the reviewed design.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
                  AND policyname='Partners read their driver documents') THEN
    RAISE EXCEPTION 'STOP: the partner storage policy is gone. It is applied by the privileged path before this stage and must survive it.';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='rental-agreements' AND public IS TRUE) THEN
    RAISE EXCEPTION 'STOP: the rental-agreements bucket is public.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects'
       AND policyname <> 'Partners read their driver documents'
       AND (coalesce(qual,'')||coalesce(with_check,'')) LIKE '%rental-agreements%'
  ) THEN
    RAISE EXCEPTION 'STOP: a storage policy other than the reviewed partner read reaches rental-agreements. Signed PDFs are served through the service role only.';
  END IF;
END $$;

-- ----------------------------------------------------- stage11: 0023
DO $$
DECLARE missing text;
BEGIN
  IF current_setting('install.stage_name') <> 'stage11_esign_0023' THEN RETURN; END IF;

  SELECT string_agg(c, ', ') INTO missing FROM unnest(ARRAY[
    'template_key','display_version','insurance_required','approval_status','content_sha256','effective_date'
  ]) c WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='agreement_templates' AND column_name=c);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'STOP: 0023 did not add agreement_templates column(s): %', missing; END IF;

  SELECT string_agg(c, ', ') INTO missing FROM unnest(ARRAY['template_key','insurance_snapshot']) c
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='agreements' AND column_name=c);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'STOP: 0023 did not add agreements column(s): %', missing; END IF;

  IF to_regclass('public.rental_insurance_verifications') IS NULL THEN
    RAISE EXCEPTION 'STOP: 0023 did not create rental_insurance_verifications.';
  END IF;

  -- The restrictive boundary is the point of 0023 for agreements: a staff
  -- read is a Manager read from here on.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agreements'
                  AND policyname='identity_agreement_boundary' AND permissive='RESTRICTIVE') THEN
    RAISE EXCEPTION 'STOP: identity_agreement_boundary is missing or is not RESTRICTIVE.';
  END IF;

  -- Content immutability and at most one approved version per family.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='agreement_template_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'STOP: agreement_template_guard is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='agreement_content_freeze' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'STOP: agreement_content_freeze is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='agreement_templates_one_approved_per_key') THEN
    RAISE EXCEPTION 'STOP: the one-approved-version-per-family index is missing.';
  END IF;
END $$;

-- ----------------------------------------------------- stage12: 0024
DO $$ BEGIN
  IF current_setting('install.stage_name') <> 'stage12_esign_0024' THEN RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='agreements' AND column_name='agreement_number') THEN
    RAISE EXCEPTION 'STOP: 0024 did not add agreements.agreement_number.';
  END IF;
  IF to_regclass('public.agreement_number_seq') IS NULL THEN
    RAISE EXCEPTION 'STOP: 0024 did not create public.agreement_number_seq.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='next_agreement_number') THEN
    RAISE EXCEPTION 'STOP: 0024 did not create public.next_agreement_number().';
  END IF;
  -- A number, once printed on a contract, is that contract's number forever.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='agreements_number_immutable' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'STOP: the agreement_number immutability trigger is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='agreements_agreement_number_key') THEN
    RAISE EXCEPTION 'STOP: the unique agreement_number index is missing.';
  END IF;
  -- Minting is service-role only; a browser session must never allocate one.
  IF has_function_privilege('authenticated', 'public.next_agreement_number()', 'EXECUTE') THEN
    RAISE EXCEPTION 'STOP: authenticated can execute next_agreement_number(); numbering must be service-role only.';
  END IF;
END $$;
