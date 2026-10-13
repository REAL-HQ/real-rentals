-- ===========================================================================
-- Per-stage preflight. Runs INSIDE the stage transaction, before the payload.
-- Every failure is a RAISE EXCEPTION, so the stage rolls back whole.
--
-- psql variables the runner sets:
--   :stage_name     e.g. 'stage10_agreements_baseline'
--   :payload_sha    the sha256 of the payload file as executed
--   :expect_receipt the number of receipts that must already exist (9 before
--                   the first eSign stage, then 10, then 11)
-- ===========================================================================

-- psql does not substitute :variables inside dollar-quoted blocks, so the
-- stage name and the expected receipt count are carried as transaction-local
-- settings. `true` makes them local: they vanish with the transaction, so a
-- rolled-back stage leaves nothing set.
SELECT set_config('install.stage_name', :'stage_name', true),
       set_config('install.expect_receipt', :'expect_receipt', true);

-- 1. The receipt ledger must exist, with the columns the receipt needs.
--    Staging's ledger is private.staging_install_receipts and it already
--    holds nine rows through Stage 09. This installer never creates it:
--    if it is missing or shaped differently, the operator is looking at the
--    wrong database, and guessing would corrupt a real ledger.
DO $$
DECLARE missing text;
BEGIN
  IF to_regclass('private.staging_install_receipts') IS NULL THEN
    RAISE EXCEPTION 'STOP: private.staging_install_receipts does not exist. This is not the prepared staging backend, or the ledger was not created by the earlier stages.';
  END IF;
  SELECT string_agg(c, ', ') INTO missing
    FROM unnest(ARRAY['stage','sha256','applied_at']) c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema='private' AND table_name='staging_install_receipts' AND column_name=c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: private.staging_install_receipts is missing column(s): %. Confirm the real ledger shape against staging before running this installer.', missing;
  END IF;
END $$;

-- 2. The existing receipts must be exactly what we were told to preserve.
--    A different count means somebody else has installed something since the
--    package was reviewed, and this sequence was reviewed against a state
--    that no longer exists.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM private.staging_install_receipts;
  IF n <> current_setting('install.expect_receipt')::int THEN
    RAISE EXCEPTION 'STOP: expected % existing staging receipt(s), found %. The reviewed sequence assumes the nine receipts through Stage 09 and nothing else.', current_setting('install.expect_receipt'), n;
  END IF;
END $$;

-- 3. Replay refusal. A stage installs once.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM private.staging_install_receipts WHERE stage = current_setting('install.stage_name')) THEN
    RAISE EXCEPTION 'STOP: stage % is already recorded in the staging ledger. This installer never replays a stage.', current_setting('install.stage_name');
  END IF;
END $$;

-- 4. Prerequisites. The agreements baseline references all of these; a
--    missing one would otherwise fail halfway through with a FK error.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO missing FROM unnest(ARRAY[
    'public.applications','public.vehicles','public.rentals','public.documents','public.user_roles'
  ]) t WHERE to_regclass(t) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: missing prerequisite table(s): %', missing;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='app_role') THEN
    RAISE EXCEPTION 'STOP: the app_role enum does not exist.';
  END IF;

  SELECT string_agg(f, ', ') INTO missing FROM unnest(ARRAY['is_staff','is_manager','has_role']) f
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='private' AND p.proname=f);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: missing prerequisite function(s) in schema private: %', missing;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='private' AND p.proname='is_partner_owner') THEN
    RAISE EXCEPTION 'STOP: private.is_partner_owner is missing; the partner storage policy cannot be created without it.';
  END IF;
END $$;

-- 5. Drift. A partially-installed baseline is the dangerous state: some
--    objects present, some not, no receipt. Either all three tables are
--    absent (a clean install) or all three are present (0023/0024 stages).
--    Anything between means a previous run died outside a transaction, and
--    the operator has to look before anything else is written.
DO $$
DECLARE present int;
BEGIN
  SELECT count(*) INTO present FROM unnest(ARRAY[
    'public.agreements','public.agreement_templates','public.esign_recipients'
  ]) t WHERE to_regclass(t) IS NOT NULL;
  IF present <> 0 AND present <> 3 THEN
    RAISE EXCEPTION 'STOP: partial agreements schema — % of 3 tables present. Investigate before installing; do not let this installer complete the set.', present;
  END IF;
  -- The later stages need the baseline to be there.
  IF current_setting('install.stage_name') <> 'stage10_agreements_baseline' AND present <> 3 THEN
    RAISE EXCEPTION 'STOP: % requires the agreements baseline (stage10) to be installed first.', current_setting('install.stage_name');
  END IF;
END $$;

-- 6. Signed history is never at risk from this installer, but say so out
--    loud: if a signed agreement already exists here, every stage below is
--    additive and none of them may touch it. 0023 freezes content; nothing
--    rewrites a body.
DO $$
DECLARE signed_rows int;
BEGIN
  IF to_regclass('public.agreements') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.agreements WHERE status = ''signed''' INTO signed_rows;
    RAISE NOTICE 'preflight: % signed agreement(s) present; this stage is additive and must not alter them.', signed_rows;
  END IF;
END $$;
