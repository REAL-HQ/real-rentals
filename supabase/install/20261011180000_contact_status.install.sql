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
-- TWO RECOGNISED STATES, AND NO GENERAL OVERRIDE.
--
-- The installer compares the live schema against a fingerprint — the column
-- count, the policy inventory and the trigger inventory of public.applications
-- — and runs only if it matches a state that has been reviewed:
--
--   STATE A  the production schema verified read-only on 2026-10-11, before
--            migration 0031. Defined below.
--   STATE B  the exact inventory after Codex's 0031. NOT DEFINED: that
--            package was not available when this installer was prepared, and
--            an inventory nobody has reviewed is not a state worth accepting.
--
-- Anything else stops. There is deliberately no "proceed anyway" switch: an
-- escape hatch that accepts arbitrary drift is the thing that turns a
-- preflight into decoration. To add State B, paste Codex's reviewed
-- post-0031 inventory into c_state_b below — which changes this file, and
-- therefore its checksum, and therefore needs the same approval everything
-- else here got.
--
-- WHAT IT DOES
--   1. refuses unless the database is in a recognised, reviewed state
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
-- INDEPENDENT OF 0031: it touches nothing 0031 governs. Order is a matter of
-- which state is recognised, not of conflict — see the installation sequence
-- in supabase/install/README.md.
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------------- preflight
DO $preflight$
DECLARE
  -- STATE A — verified read-only against yuyzdsnrbfhkmfzpvhwx on 2026-10-11:
  -- 120 columns, six policies, two triggers, RLS on, 82 applicants, no
  -- contact columns, and no 20261011180000 in the ledger.
  --   <column count>|<md5 of every policy DEFINITION>|<trigger:function pairs>
  --
  -- The policy part is a hash of the full definition of every policy on the
  -- table — name, command, permissive, roles, USING and WITH CHECK — not the
  -- names. A migration that rewrites "Staff view applications" to be
  -- manager-only keeps the name and changes the rule, which is exactly the
  -- change this installer must notice, and a name list does not see it.
  c_state_a  CONSTANT text :=
    '120|40a44e65dceca27b52195ac5ba665ff1|applications_active_guard:application_active_guard, applications_updated_at:set_updated_at';

  -- STATE B — the reviewed inventory AFTER Codex's 0031.
  --
  -- Left NULL on purpose. The 0031 package is not in this repository, not on
  -- any branch reachable from it, and not in the production ledger (which
  -- holds 22 drizzle entries, 0000-0021). Writing a guess here would turn a
  -- safety check into a rubber stamp. Replace NULL with the fingerprint in
  -- the same shape as State A once the 0031 package has been read:
  --
  --     '<column count>|<policy md5>|<trigger:function pairs>'
  --
  -- The md5 is what the live database reports for the reviewed post-0031
  -- state; the query that produces it is at the foot of this file.
  --
  c_state_b  CONSTANT text := NULL;

  v_cols       int;
  v_contact    int;
  v_check      int;
  v_indexes    int;
  v_rls        boolean;
  v_policies   text;
  v_polmd5     text;
  v_triggers   text;
  v_ledger     int;
  v_print      text;
  v_state      text;
BEGIN
  -- STOP: the table itself.
  IF to_regclass('public.applications') IS NULL THEN
    RAISE EXCEPTION 'STOP: public.applications does not exist. This is not the REAL RENTALS database.';
  END IF;

  -- STOP: anything of ours already present. A half-installed state is not
  -- something to paper over; this installer and its receipt run exactly once.
  SELECT count(*) INTO v_contact FROM information_schema.columns
   WHERE table_schema='public' AND table_name='applications'
     AND column_name IN ('contact_status','contact_status_note','contact_follow_up_on','contact_status_at','contact_status_by');
  IF v_contact <> 0 THEN
    RAISE EXCEPTION 'STOP: % of the five contact columns already exist. Contact Status looks already installed — run the companion .verify.sql before doing anything else.', v_contact;
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

  -- The fingerprint, and the allow-list.
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema='public' AND table_name='applications';
  -- The whole definition of every policy, hashed. A changed USING clause
  -- under an unchanged name must not read as "no change".
  SELECT md5(coalesce(string_agg(
           policyname || '/' || cmd || '/' || coalesce(permissive,'') || '/' ||
           coalesce(array_to_string(roles, '+'), '') || '/' ||
           coalesce(qual,'') || '/' || coalesce(with_check,''), E'\n' ORDER BY policyname), ''))
    INTO v_polmd5
    FROM pg_policies WHERE schemaname='public' AND tablename='applications';
  -- Readable, for the receipt and the refusal message.
  SELECT string_agg(policyname, ', ' ORDER BY policyname) INTO v_policies
    FROM pg_policies WHERE schemaname='public' AND tablename='applications';
  -- Trigger names AND the functions behind them: a trigger repointed at a
  -- different function is a different trigger.
  SELECT string_agg(t.tgname || ':' || p.proname, ', ' ORDER BY t.tgname) INTO v_triggers
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid='public.applications'::regclass AND NOT t.tgisinternal;

  v_print := format('%s|%s|%s', v_cols, v_polmd5, coalesce(v_triggers, '(none)'));

  IF v_print = c_state_a THEN
    v_state := 'A';
  ELSIF c_state_b IS NOT NULL AND v_print = c_state_b THEN
    v_state := 'B';
  ELSE
    RAISE EXCEPTION E'STOP: public.applications is not in a recognised state.\n  found    : %\n  STATE A  : %\n  STATE B  : %\n  policies : %\nNothing was changed. If this is the reviewed post-0031 state, put its fingerprint in c_state_b and have the amended installer approved; do not relax this check.',
      v_print, c_state_a,
      coalesce(c_state_b, '(not defined — the 0031 package was not available when this installer was prepared)'),
      coalesce(v_policies, '(none)');
  END IF;

  PERFORM set_config('ccs.state', v_state, true);
  PERFORM set_config('ccs.fingerprint', v_print, true);
  PERFORM set_config('ccs.cols_before', v_cols::text, true);
  PERFORM set_config('ccs.policies', coalesce(v_policies, ''), true);
  PERFORM set_config('ccs.triggers', coalesce(v_triggers, ''), true);
  RAISE NOTICE 'Preflight: recognised STATE % (%)', v_state, v_print;
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

  -- The policy and trigger inventory is the one the preflight recognised.
  -- Nothing here changes it, so a difference would mean something else did.
  IF (SELECT md5(coalesce(string_agg(
          policyname || '/' || cmd || '/' || coalesce(permissive,'') || '/' ||
          coalesce(array_to_string(roles, '+'), '') || '/' ||
          coalesce(qual,'') || '/' || coalesce(with_check,''), E'\n' ORDER BY policyname), ''))
        FROM pg_policies WHERE schemaname='public' AND tablename='applications')
       IS DISTINCT FROM split_part(current_setting('ccs.fingerprint', true), '|', 2) THEN
    RAISE EXCEPTION 'ROLLBACK: a policy on public.applications changed while this ran.';
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
    'preflight_state', current_setting('ccs.state', true),
    'preflight_fingerprint', current_setting('ccs.fingerprint', true),
    'rows_before', current_setting('ccs.rows_before', true),
    'rows_after', current_setting('ccs.rows_after', true),
    'columns_before', current_setting('ccs.cols_before', true),
    'policies_at_install', current_setting('ccs.policies', true),
    'triggers_at_install', current_setting('ccs.triggers', true),
    'independent_of', '0031'
  )
);

COMMIT;

-- Nothing below runs as part of the transaction. Run the companion
-- 20261011180000_contact_status.verify.sql next; it is SELECT-only.

-- -----------------------------------------------------------------------
-- The fingerprint query. Run it read-only against the target database to
-- read the current state — that is what goes into c_state_a or c_state_b.
--
--   SELECT format('%s|%s|%s',
--     (SELECT count(*) FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='applications'),
--     md5(coalesce((SELECT string_agg(policyname || '/' || cmd || '/' ||
--            coalesce(permissive,'') || '/' || coalesce(array_to_string(roles,'+'),'') || '/' ||
--            coalesce(qual,'') || '/' || coalesce(with_check,''), E'\n' ORDER BY policyname)
--          FROM pg_policies WHERE schemaname='public' AND tablename='applications'), '')),
--     (SELECT string_agg(t.tgname || ':' || p.proname, ', ' ORDER BY t.tgname)
--        FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
--       WHERE t.tgrelid='public.applications'::regclass AND NOT t.tgisinternal));
-- -----------------------------------------------------------------------
