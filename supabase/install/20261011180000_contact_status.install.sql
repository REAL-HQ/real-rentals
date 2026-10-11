-- =============================================================================
-- CONTACT STATUS (Phase 1A) — PRODUCTION INSTALLER
--
-- Target project : yuyzdsnrbfhkmfzpvhwx
-- Reviewed file  : supabase/migrations/20261011180000_contact_status.sql
-- Reviewed sha256: 400e1071856e7c4e62fc2a13822afd14ee98b31525b1ebf999f6bf486d6c710e
-- Prepared from  : main 31ed33055614705c978f638728d06f0931dee3c1
--
-- ONE TRANSACTION. Either every statement below commits, or none of them do.
-- Any precondition that does not hold raises and the whole thing rolls back,
-- so a surprise leaves the database exactly as it was.
--
-- Pure SQL: no psql meta-commands, so it runs through psql, the Supabase SQL
-- editor or any other client that can send one script.
--
-- WHAT IT DOES
--   1. refuses to run if the database is not the one that was verified
--   2. snapshots the applicant rows
--   3. applies the reviewed migration VERBATIM, between the markers below
--   4. re-checks: five columns, one CHECK, two indexes, same row count,
--      every applicant reading New, RLS still on
--   5. writes two durable receipts, inside the same transaction
--
-- WHAT IT NEVER DOES
--   no UPDATE or DELETE of applicant data, no DROP, no policy, no trigger,
--   no grant, no role change, no Auth, no Stripe.
--
-- INDEPENDENT OF 0031. It touches no policy and no grant, so it neither
-- needs 0031 nor blocks it, and it installs cleanly before or after. 0031 may
-- legitimately change the policy set on public.applications, so a changed
-- policy or trigger inventory is treated as RECORDED DRIFT rather than a
-- stop — see ccs.allow_drift below. Anything that would make THIS migration
-- wrong is always a stop.
-- =============================================================================

BEGIN;

-- Set to '1' ONLY to proceed past recorded baseline drift (a changed policy
-- or trigger inventory, or a column count that is no longer 120 — for
-- example because 0031 landed first). It never relaxes the checks that
-- protect this migration itself.
SET LOCAL ccs.allow_drift = '0';

-- ----------------------------------------------------------------- preflight
DO $preflight$
DECLARE
  v_allow      boolean := coalesce(current_setting('ccs.allow_drift', true), '0') = '1';
  v_cols       int;
  v_contact    int;
  v_check      int;
  v_indexes    int;
  v_rls        boolean;
  v_policies   text;
  v_triggers   text;
  v_ledger     int;
  v_drift      text[] := ARRAY[]::text[];
BEGIN
  -- STOP: the table itself.
  IF to_regclass('public.applications') IS NULL THEN
    RAISE EXCEPTION 'STOP: public.applications does not exist. This is not the REAL RENTALS database.';
  END IF;

  -- STOP: anything of ours already present. A half-installed state is not
  -- something to paper over; re-running the reviewed migration by hand is
  -- safe, but this installer and its receipt must run exactly once.
  SELECT count(*) INTO v_contact FROM information_schema.columns
   WHERE table_schema='public' AND table_name='applications'
     AND column_name IN ('contact_status','contact_status_note','contact_follow_up_on','contact_status_at','contact_status_by');
  IF v_contact <> 0 THEN
    RAISE EXCEPTION 'STOP: % of the five contact columns already exist. Contact Status looks already installed — verify with the companion .verify.sql before doing anything else.', v_contact;
  END IF;

  SELECT count(*) INTO v_check FROM pg_constraint
   WHERE conrelid='public.applications'::regclass AND conname='applications_contact_status_check';
  IF v_check <> 0 THEN
    RAISE EXCEPTION 'STOP: applications_contact_status_check already exists.';
  END IF;

  SELECT count(*) INTO v_indexes FROM pg_indexes
   WHERE tablename='applications'
     AND indexname IN ('applications_contact_status_idx','applications_contact_follow_up_idx');
  IF v_indexes <> 0 THEN
    RAISE EXCEPTION 'STOP: % of the two contact indexes already exist.', v_indexes;
  END IF;

  SELECT count(*) INTO v_ledger FROM supabase_migrations.schema_migrations WHERE version = '20261011180000';
  IF v_ledger <> 0 THEN
    RAISE EXCEPTION 'STOP: the migration ledger already records version 20261011180000.';
  END IF;

  -- STOP: row level security. Adding columns to an unprotected applications
  -- table is not a thing to do quietly.
  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid='public.applications'::regclass;
  IF NOT v_rls THEN
    RAISE EXCEPTION 'STOP: row level security is OFF on public.applications.';
  END IF;

  -- RECORDED DRIFT: the shape verified on 2026-10-11. Different is not
  -- necessarily wrong — 0031 may have landed first — but it is not what was
  -- reviewed, so it stops unless ccs.allow_drift is set, and either way it
  -- is written into the receipt.
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema='public' AND table_name='applications';
  IF v_cols <> 120 THEN
    v_drift := v_drift || format('applications has %s columns, verified 120', v_cols);
  END IF;

  SELECT string_agg(policyname, ', ' ORDER BY policyname) INTO v_policies
    FROM pg_policies WHERE tablename='applications';
  IF v_policies IS DISTINCT FROM 'Anyone can submit applications, No direct application deletes, Partners can view their assigned drivers, Staff update applications, Staff view applications, Users can view their own application' THEN
    v_drift := v_drift || format('policy set is now: %s', coalesce(v_policies, '(none)'));
  END IF;

  SELECT string_agg(tgname, ', ' ORDER BY tgname) INTO v_triggers
    FROM pg_trigger WHERE tgrelid='public.applications'::regclass AND NOT tgisinternal;
  IF v_triggers IS DISTINCT FROM 'applications_active_guard, applications_updated_at' THEN
    v_drift := v_drift || format('trigger set is now: %s', coalesce(v_triggers, '(none)'));
  END IF;

  IF array_length(v_drift, 1) IS NOT NULL THEN
    IF v_allow THEN
      RAISE WARNING 'RECORDED DRIFT (proceeding because ccs.allow_drift=1): %', array_to_string(v_drift, ' ; ');
    ELSE
      RAISE EXCEPTION 'STOP ON DRIFT: % . Review it. If it is expected (0031 landed first, say), set ccs.allow_drift to 1 at the top of this file and run again — the deviation is written into the receipt either way.', array_to_string(v_drift, ' ; ');
    END IF;
  END IF;

  PERFORM set_config('ccs.drift', coalesce(array_to_string(v_drift, ' ; '), ''), true);
  PERFORM set_config('ccs.cols_before', v_cols::text, true);
  PERFORM set_config('ccs.policies', coalesce(v_policies, ''), true);
  PERFORM set_config('ccs.triggers', coalesce(v_triggers, ''), true);
END
$preflight$;

-- The applicant rows, counted before anything happens.
DO $snapshot$
BEGIN
  PERFORM set_config('ccs.rows_before', (SELECT count(*) FROM public.applications)::text, true);
END
$snapshot$;

-- ========================= THE REVIEWED MIGRATION, VERBATIM =================
-- >>> BEGIN 20261011180000_contact_status.sql sha256=400e1071856e7c4e62fc2a13822afd14ee98b31525b1ebf999f6bf486d6c710e
-- =============================================================================
-- Contact Status (Phase 1A)
--
-- Where the CONVERSATION with a person stands: did we reach them, are they
-- interested, when are we calling back. This is NOT applications.status, which
-- is the lifecycle of the paperwork and is read by approval, activation and
-- agreements. The two are deliberately separate, and this migration does not
-- touch the other one: no status value is renamed, no row's status is changed,
-- no trigger or policy on the lifecycle is altered.
--
-- Additive and reversible. Five columns, one CHECK, one index. Every column is
-- nullable or defaulted, so existing rows need no back-fill:
--
--   contact_status        defaults to 'new', so all 'N' applicants already on
--                         file — and every applicant created from now on —
--                         read as New without anybody touching them.
--   contact_status_note   what was said / what is outstanding / why not.
--   contact_follow_up_on  a DATE, not a timestamp: "call her Tuesday" is a
--                         calendar day, and storing it as an instant is how a
--                         follow-up ends up a day early in another timezone.
--   contact_status_at     when it was last set.
--   contact_status_by     who set it (auth user id), left unconstrained by a
--                         foreign key so removing a staff account never
--                         deletes or blocks the record of what they did.
--
-- No new RLS policy is needed or wanted. applications already carries
--   "Staff view applications"   SELECT  private.is_staff()
--   "Staff update applications" UPDATE  private.is_staff()
-- which is exactly the intended audience (Owner, Manager, Coordinator), and a
-- driver has only "Users can view their own application" — SELECT, never
-- UPDATE — so no applicant can set their own contact status, and anon has
-- neither. The server function checks the tier again on its own account,
-- because it writes through the service role, which bypasses RLS.
--
-- History is audit_log, under action 'contact_status.set'. audit_log has no
-- INSERT policy or grant for `authenticated`, so the record of who changed
-- what cannot be forged or erased from a browser session.
-- =============================================================================

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS contact_status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS contact_status_note text,
  ADD COLUMN IF NOT EXISTS contact_follow_up_on date,
  ADD COLUMN IF NOT EXISTS contact_status_at timestamptz,
  ADD COLUMN IF NOT EXISTS contact_status_by uuid;

-- The nine Phase 1A statuses, and nothing else. A typo in a hand-written
-- UPDATE is refused here rather than appearing in the list as a blank badge.
-- Adding a status later is one ALTER ... DROP CONSTRAINT / ADD CONSTRAINT.
ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_contact_status_check;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_contact_status_check
  CHECK (contact_status IN (
    'new', 'attempted', 'voicemail', 'contacted', 'interested',
    'follow_up', 'documents', 'unqualified', 'unresponsive'
  ));

COMMENT ON COLUMN public.applications.contact_status IS
  'Contact Status: where the conversation stands. Separate from applications.status (the application lifecycle); nothing in approval, activation or agreements reads this.';
COMMENT ON COLUMN public.applications.contact_follow_up_on IS
  'Calendar day staff said they would come back to this person. Date, not timestamp.';

-- The Drivers list filters on it and Rosa sorts her day by the follow-up date.
-- Partial on the dates, because most rows have none.
CREATE INDEX IF NOT EXISTS applications_contact_status_idx
  ON public.applications (contact_status);
CREATE INDEX IF NOT EXISTS applications_contact_follow_up_idx
  ON public.applications (contact_follow_up_on)
  WHERE contact_follow_up_on IS NOT NULL;
-- <<< END 20261011180000_contact_status.sql
-- ============================================================================

-- --------------------------------------------------------------- postflight
DO $postflight$
DECLARE
  v_contact int;
  v_check   int;
  v_indexes int;
  v_rls     boolean;
  v_before  bigint := current_setting('ccs.rows_before', true)::bigint;
  v_after   bigint;
  v_new     bigint;
  v_touched bigint;
BEGIN
  SELECT count(*) INTO v_contact FROM information_schema.columns
   WHERE table_schema='public' AND table_name='applications'
     AND column_name IN ('contact_status','contact_status_note','contact_follow_up_on','contact_status_at','contact_status_by');
  IF v_contact <> 5 THEN
    RAISE EXCEPTION 'ROLLBACK: expected five contact columns, found %.', v_contact;
  END IF;

  SELECT count(*) INTO v_check FROM pg_constraint
   WHERE conrelid='public.applications'::regclass AND conname='applications_contact_status_check';
  IF v_check <> 1 THEN
    RAISE EXCEPTION 'ROLLBACK: the contact status CHECK constraint is missing.';
  END IF;

  SELECT count(*) INTO v_indexes FROM pg_indexes
   WHERE tablename='applications'
     AND indexname IN ('applications_contact_status_idx','applications_contact_follow_up_idx');
  IF v_indexes <> 2 THEN
    RAISE EXCEPTION 'ROLLBACK: expected two contact indexes, found %.', v_indexes;
  END IF;

  -- No applicant was added, removed or altered.
  SELECT count(*) INTO v_after FROM public.applications;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'ROLLBACK: applicant rows went from % to %.', v_before, v_after;
  END IF;

  -- Every applicant reads New, and carries no invented note, date or author.
  SELECT count(*) INTO v_new FROM public.applications WHERE contact_status = 'new';
  IF v_new <> v_after THEN
    RAISE EXCEPTION 'ROLLBACK: % of % applicants do not read New.', v_after - v_new, v_after;
  END IF;
  SELECT count(*) INTO v_touched FROM public.applications
   WHERE contact_status_note IS NOT NULL OR contact_follow_up_on IS NOT NULL
      OR contact_status_at IS NOT NULL OR contact_status_by IS NOT NULL;
  IF v_touched <> 0 THEN
    RAISE EXCEPTION 'ROLLBACK: % applicants carry contact data nobody entered.', v_touched;
  END IF;

  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid='public.applications'::regclass;
  IF NOT v_rls THEN
    RAISE EXCEPTION 'ROLLBACK: row level security is no longer on.';
  END IF;

  PERFORM set_config('ccs.rows_after', v_after::text, true);
END
$postflight$;

-- ------------------------------------------------------------------ receipts
-- 1. The migration ledger, so the next `supabase db` operation knows this
--    version is installed. idempotency_key is the reviewed file's sha256 and
--    the column is UNIQUE, so a second run of this installer is refused by
--    the database itself even if somebody edits the preflight out.
INSERT INTO supabase_migrations.schema_migrations (version, name, idempotency_key, statements)
VALUES (
  '20261011180000',
  'contact_status',
  'sha256:400e1071856e7c4e62fc2a13822afd14ee98b31525b1ebf999f6bf486d6c710e',
  ARRAY['Installed by supabase/install/20261011180000_contact_status.install.sql from main 31ed33055614705c978f638728d06f0931dee3c1; body sha256 400e1071856e7c4e62fc2a13822afd14ee98b31525b1ebf999f6bf486d6c710e']
);

-- 2. The application's own immutable record. audit_log has no INSERT policy
--    or grant for `authenticated`, so this entry cannot be forged or erased
--    from any browser session.
INSERT INTO public.audit_log (actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata)
VALUES (
  NULL, NULL, 'release',
  'migration.applied',
  'migration',
  '20261011180000',
  'Contact Status (Phase 1A) installed: five additive columns, one CHECK, two indexes on public.applications',
  jsonb_build_object(
    'file', 'supabase/migrations/20261011180000_contact_status.sql',
    'sha256', '400e1071856e7c4e62fc2a13822afd14ee98b31525b1ebf999f6bf486d6c710e',
    'source_commit', '31ed33055614705c978f638728d06f0931dee3c1',
    'rows_before', current_setting('ccs.rows_before', true),
    'rows_after', current_setting('ccs.rows_after', true),
    'columns_before', current_setting('ccs.cols_before', true),
    'policies_at_install', current_setting('ccs.policies', true),
    'triggers_at_install', current_setting('ccs.triggers', true),
    'recorded_drift', current_setting('ccs.drift', true),
    'independent_of', '0031'
  )
);

COMMIT;

-- Nothing below runs as part of the transaction. Run the companion
-- 20261011180000_contact_status.verify.sql next; it is SELECT-only.
