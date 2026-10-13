-- ===========================================================================
-- Per-stage preflight. Runs INSIDE the stage transaction, before the payload.
-- Every failure is a RAISE EXCEPTION, so the stage rolls back whole.
--
-- psql variables the runner sets:
--   :stage_name        e.g. 'stage10_agreements_baseline'
--   :payload_sha       the sha256 of the payload file as executed
--   :expect_receipt    receipts that must already exist (9, then 10, then 11)
--   :baseline_digest   the nine pinned receipts as
--                      ordinal:stage:sha256 joined by '|', from
--                      baseline-receipts.json
--   :expect_database   the database name the manifest was captured from
-- ===========================================================================

-- psql does not substitute :variables inside dollar-quoted blocks, so
-- everything the DO blocks need is carried as transaction-local settings.
-- `true` makes them local: they vanish with the transaction, so a rolled-back
-- stage leaves nothing set.
-- \gset rather than a bare SELECT: a plain one prints a result set, and the
-- baseline digest is 600-odd characters that would scroll the operator's
-- console on every stage. Distinct aliases because \gset needs them.
SELECT set_config('install.stage_name',      :'stage_name',      true) AS _s1,
       set_config('install.expect_receipt',  :'expect_receipt',  true) AS _s2,
       set_config('install.baseline_digest', :'baseline_digest', true) AS _s3,
       set_config('install.expect_database', :'expect_database', true) AS _s4
\gset

-- ---------------------------------------------------------------------------
-- 0. CONCURRENCY. Two installers against one ledger is the one failure this
--    package cannot roll back cleanly: both read nine receipts, both pass
--    preflight, and the second writes its payload on top of the first's
--    half-visible work.
--
--    The advisory lock is transaction-scoped, so it releases on COMMIT or
--    ROLLBACK with no cleanup path to forget. `try` rather than plain: a
--    second installer is told to stop, not left blocking for a timeout.
DO $$ BEGIN
  IF NOT pg_try_advisory_xact_lock(4919, hashtext('esign_staging_install')) THEN
    RAISE EXCEPTION 'STOP: another eSign staging installation holds the install lock on this database. Wait for it to finish or roll back, then re-run. Never run two stages at once.';
  END IF;
END $$;

-- And anything else writing the ledger — a hand-run INSERT, a second tool —
-- is locked out for the rest of this transaction. NOWAIT so a contended
-- ledger refuses immediately instead of parking the stage behind it.
LOCK TABLE private.staging_install_receipts IN SHARE ROW EXCLUSIVE MODE NOWAIT;

-- ---------------------------------------------------------------------------
-- 1. The receipt ledger must exist, with the columns the receipt needs.
--    Staging's ledger is private.staging_install_receipts (stage, sha256,
--    installed_at) and it already holds nine rows through Stage 09. This
--    installer never creates it: if it is missing or shaped differently, the
--    operator is looking at the wrong database, and guessing would corrupt a
--    real ledger.
DO $$
DECLARE missing text;
BEGIN
  IF to_regclass('private.staging_install_receipts') IS NULL THEN
    RAISE EXCEPTION 'STOP: private.staging_install_receipts does not exist. This is not the prepared staging backend, or the ledger was not created by the earlier stages.';
  END IF;
  SELECT string_agg(c, ', ') INTO missing
    FROM unnest(ARRAY['stage','sha256','installed_at']) c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema='private' AND table_name='staging_install_receipts' AND column_name=c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: private.staging_install_receipts is missing column(s): %. The verified staging ledger is (stage, sha256, installed_at); a different shape means a different database.', missing;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. TARGET BINDING, part one: the database the manifest was captured from.
DO $$ BEGIN
  IF current_setting('install.expect_database') <> '' 
     AND current_database() <> current_setting('install.expect_database') THEN
    RAISE EXCEPTION 'STOP: connected to database %, but the pinned baseline was captured from %. This is not the verified staging target.',
      current_database(), current_setting('install.expect_database');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. THE NINE EXISTING RECEIPTS, EXACTLY.
--
--    Names, checksums AND ordering, compared as one string against the
--    pinned manifest. This is both the "do not disturb Stage 01-09" check and
--    TARGET BINDING part two: a ledger that reproduces all nine is the
--    verified staging backend, and a hostname is not evidence of that.
--
--    Ordering is by installed_at then stage — the order the stages actually
--    ran, which is what the manifest's ordinals record. Ties break by name so
--    two receipts written in the same transaction still compare stably.
DO $$
DECLARE want text; got text; n int;
BEGIN
  want := current_setting('install.baseline_digest');
  IF want IS NULL OR want = '' THEN
    RAISE EXCEPTION 'STOP: no pinned baseline. scripts/esign-staging/baseline-receipts.json is still UNPOPULATED — the nine existing receipts have not been recorded, so there is nothing to compare the live ledger against. Populate it from the read-only query in that file and have the result reviewed.';
  END IF;

  -- Only the receipts that predate this installation are compared. The
  -- stages this package adds are matched separately, in 4 and 5 below.
  SELECT count(*) INTO n
    FROM private.staging_install_receipts
   WHERE stage NOT IN ('stage10_agreements_baseline','stage11_esign_0023','stage12_esign_0024');
  IF n <> 9 THEN
    RAISE EXCEPTION 'STOP: found % pre-existing receipt(s), expected the nine through Stage 09. Somebody has installed something since this package was reviewed; the reviewed sequence assumes a ledger that no longer exists.', n;
  END IF;

  SELECT string_agg(ord || ':' || stage || ':' || sha256, '|' ORDER BY ord) INTO got
    FROM (SELECT row_number() OVER (ORDER BY installed_at, stage) AS ord, stage, sha256
            FROM private.staging_install_receipts
           WHERE stage NOT IN ('stage10_agreements_baseline','stage11_esign_0023','stage12_esign_0024')) r;

  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION E'STOP: the nine existing receipts are not the nine that were verified.\npinned: %\nlive:   %\nA name, a checksum or the install order has changed. Do not install over this; re-verify staging first.', want, got;
  END IF;
  RAISE NOTICE 'preflight: the nine existing receipts match the pinned baseline exactly.';
END $$;

-- ---------------------------------------------------------------------------
-- 4. The total count is what this point in the sequence expects.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM private.staging_install_receipts;
  IF n <> current_setting('install.expect_receipt')::int THEN
    RAISE EXCEPTION 'STOP: expected % receipt(s) in the ledger at this point, found %. Stages run 10, 11, 12 in order and none may be skipped.', current_setting('install.expect_receipt'), n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Replay refusal. A stage installs once.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM private.staging_install_receipts WHERE stage = current_setting('install.stage_name')) THEN
    RAISE EXCEPTION 'STOP: stage % is already recorded in the staging ledger. This installer never replays a stage.', current_setting('install.stage_name');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Prerequisites. The agreements baseline references all of these; a
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

-- ---------------------------------------------------------------------------
-- 7. EXISTING POLICIES AND SCHEMA OBJECTS, validated before anything is
--    written. These are the things the stage's own objects depend on, and a
--    missing one turns a security boundary into a no-op rather than an error.
DO $$
DECLARE missing text;
BEGIN
  -- The partner storage policy reads these four columns off public.documents.
  -- Without them the policy is unbuildable, and worse, a policy that cannot
  -- find its columns is a policy that never matches.
  SELECT string_agg(c, ', ') INTO missing FROM unnest(ARRAY[
    'storage_bucket','storage_path','visibility','partner_id'
  ]) c WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='documents' AND column_name=c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: public.documents is missing column(s) the partner storage policy reads: %', missing;
  END IF;

  -- RLS off on storage.objects makes every storage policy decorative.
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'STOP: storage.objects does not exist.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='storage' AND c.relname='objects') THEN
    RAISE EXCEPTION 'STOP: row level security is not enabled on storage.objects. Every storage policy here would enforce nothing.';
  END IF;

  -- No policy other than the reviewed partner read may already reach the
  -- bucket. One that does would make signed contracts readable straight from
  -- PostgREST, bypassing the Manager gate in getAgreementPdf.
  SELECT string_agg(policyname, ', ') INTO missing FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects'
     AND policyname <> 'Partners read their driver documents'
     AND (coalesce(qual,'')||coalesce(with_check,'')) LIKE '%rental-agreements%';
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: storage polic(ies) other than the reviewed partner read already reach rental-agreements: %. Signed PDFs are served through the service role only.', missing;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. THE PRIVILEGED STORAGE STEP MUST ALREADY HAVE RUN.
--
--    CREATE POLICY on storage.objects requires superuser or ownership of the
--    table, and the ordinary staging connection has neither — storage.objects
--    is owned by supabase_storage_admin. So the partner read policy is NOT in
--    this installer's reach and is applied first, through the separately
--    reviewed privileged path (03_storage_policy.privileged.sql).
--
--    Required, not optional: a stage10 that created the bucket and left the
--    policy out would be a partial installation of the reviewed design, and
--    this package refuses partial installations.
DO $$ BEGIN
  IF current_setting('install.stage_name') <> 'stage10_agreements_baseline' THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects'
       AND policyname='Partners read their driver documents') THEN
    RAISE EXCEPTION 'STOP: the storage policy "Partners read their driver documents" is not present. It must be applied FIRST, through the privileged path, because % cannot CREATE POLICY on storage.objects (owner: %). See scripts/esign-staging/03_storage_policy.privileged.sql.',
      current_user,
      coalesce((SELECT tableowner FROM pg_tables WHERE schemaname='storage' AND tablename='objects'), 'unknown');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Drift. A partially-installed baseline is the dangerous state: some
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
  -- Objects present with no receipt to account for them, and the reverse.
  IF current_setting('install.stage_name') = 'stage10_agreements_baseline' AND present = 3 THEN
    RAISE EXCEPTION 'STOP: the agreements tables already exist but no stage10 receipt records them. Something installed them outside this package; reconcile before continuing.';
  END IF;
  IF current_setting('install.stage_name') <> 'stage10_agreements_baseline' AND present <> 3 THEN
    RAISE EXCEPTION 'STOP: % requires the agreements baseline (stage10) to be installed first.', current_setting('install.stage_name');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 10. Signed history is never at risk from this installer, but say so out
--     loud: if a signed agreement already exists here, every stage below is
--     additive and none of them may touch it. 0023 freezes content; nothing
--     rewrites a body.
DO $$
DECLARE signed_rows int;
BEGIN
  IF to_regclass('public.agreements') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.agreements WHERE status = ''signed''' INTO signed_rows;
    RAISE NOTICE 'preflight: % signed agreement(s) present; this stage is additive and must not alter them.', signed_rows;
  END IF;
END $$;
