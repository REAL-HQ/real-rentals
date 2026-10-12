-- =============================================================================
-- CONTACT STATUS (Phase 1A) — POST-INSTALLATION VERIFICATION
--
-- SELECT-only. Reads nothing but schema metadata and counts; touches no
-- applicant data and writes nothing. Safe to run at any time, by anyone with
-- read access, before or after the installer.
--
-- Every row must read PASS. A FAIL row names what is wrong.
-- =============================================================================

WITH checks AS (
  SELECT 'columns' AS check_name,
         (SELECT count(*) FROM information_schema.columns
           WHERE table_schema='public' AND table_name='applications'
             AND column_name IN ('contact_status','contact_status_note','contact_follow_up_on','contact_status_at','contact_status_by'))::text AS actual,
         '5' AS expected,
         'the five contact columns exist' AS what
  UNION ALL
  SELECT 'contact_status type',
         (SELECT data_type || '/' || is_nullable || '/' || coalesce(column_default,'-')
            FROM information_schema.columns
           WHERE table_schema='public' AND table_name='applications' AND column_name='contact_status'),
         'text/NO/''new''::text',
         'it is text, NOT NULL, defaulting to new'
  UNION ALL
  SELECT 'follow-up is a date',
         (SELECT data_type FROM information_schema.columns
           WHERE table_schema='public' AND table_name='applications' AND column_name='contact_follow_up_on'),
         'date',
         'a follow-up cannot shift by a timezone'
  UNION ALL
  SELECT 'who and when',
         (SELECT string_agg(column_name || ':' || data_type, ', ' ORDER BY column_name)
            FROM information_schema.columns
           WHERE table_schema='public' AND table_name='applications'
             AND column_name IN ('contact_status_at','contact_status_by')),
         'contact_status_at:timestamp with time zone, contact_status_by:uuid',
         'the row records who set it and when'
  UNION ALL
  SELECT 'no foreign key on the author',
         (SELECT count(*) FROM information_schema.key_column_usage k
             JOIN information_schema.table_constraints c USING (constraint_name)
            WHERE k.table_name='applications' AND k.column_name='contact_status_by'
              AND c.constraint_type='FOREIGN KEY')::text,
         '0',
         'removing a staff account cannot delete the record of what they did'
  UNION ALL
  SELECT 'check constraint',
         (SELECT count(*) FROM pg_constraint
           WHERE conrelid='public.applications'::regclass AND conname='applications_contact_status_check')::text,
         '1',
         'exactly one CHECK, not two'
  UNION ALL
  SELECT 'nine statuses',
         (SELECT count(*) FROM (
            SELECT unnest(ARRAY['new','attempted','voicemail','contacted','interested','follow_up','documents','unqualified','unresponsive']) AS s
          ) t WHERE pg_get_constraintdef(
            (SELECT oid FROM pg_constraint WHERE conrelid='public.applications'::regclass
              AND conname='applications_contact_status_check')) LIKE '%''' || t.s || '''%')::text,
         '9',
         'the CHECK lists all nine statuses'
  UNION ALL
  SELECT 'indexes',
         (SELECT count(*) FROM pg_indexes WHERE tablename='applications'
            AND indexname IN ('applications_contact_status_idx','applications_contact_follow_up_idx'))::text,
         '2',
         'the filter and the follow-up date are indexed'
  UNION ALL
  SELECT 'every applicant reads New',
         (SELECT count(*) FROM public.applications WHERE contact_status <> 'new')::text,
         '0',
         'no back-fill was needed and none was invented'
  UNION ALL
  SELECT 'no invented contact data',
         (SELECT count(*) FROM public.applications
           WHERE contact_status_note IS NOT NULL OR contact_follow_up_on IS NOT NULL
              OR contact_status_at IS NOT NULL OR contact_status_by IS NOT NULL)::text,
         '0',
         'nobody has a note, a date or an author they did not get from staff'
  UNION ALL
  SELECT 'row level security',
         (SELECT relrowsecurity FROM pg_class WHERE oid='public.applications'::regclass)::text,
         'true',
         'RLS is still on'
  UNION ALL
  SELECT 'staff policies',
         (SELECT count(*) FROM pg_policies WHERE tablename='applications'
            AND policyname IN ('Staff view applications','Staff update applications'))::text,
         '2',
         'the staff read and update policies are still there'
  UNION ALL
  SELECT 'no applicant UPDATE policy',
         (SELECT count(*) FROM pg_policies WHERE tablename='applications'
            AND cmd='UPDATE' AND qual NOT LIKE '%is_staff%' AND qual NOT LIKE '%is_manager%')::text,
         '0',
         'no applicant can write their own contact status'
  UNION ALL
  SELECT 'ledger receipt',
         (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261011180000')::text,
         '1',
         'the migration ledger records this version'
  UNION ALL
  SELECT 'ledger checksum',
         (SELECT idempotency_key FROM supabase_migrations.schema_migrations WHERE version='20261011180000'),
         'sha256:400e1071856e7c4e62fc2a13822afd14ee98b31525b1ebf999f6bf486d6c710e',
         'and the reviewed file''s checksum, so a different file cannot claim this version'
  UNION ALL
  SELECT 'audit receipt',
         (SELECT count(*) FROM public.audit_log
           WHERE action='migration.applied' AND entity_id='20261011180000')::text,
         '1',
         'the application''s own immutable record of the install'
  UNION ALL
  SELECT 'audit receipt checksum',
         (SELECT metadata->>'sha256' FROM public.audit_log
           WHERE action='migration.applied' AND entity_id='20261011180000' ORDER BY created_at DESC LIMIT 1),
         '400e1071856e7c4e62fc2a13822afd14ee98b31525b1ebf999f6bf486d6c710e',
         'naming what was installed'
)
SELECT
  CASE WHEN actual IS NOT DISTINCT FROM expected THEN 'PASS' ELSE 'FAIL' END AS result,
  check_name,
  what,
  expected,
  coalesce(actual, '(null)') AS actual
FROM checks
ORDER BY (CASE WHEN actual IS NOT DISTINCT FROM expected THEN 1 ELSE 0 END), check_name;

-- A separate, deliberate smoke test of the constraint. Read-only: the UPDATE
-- is rolled back by the surrounding transaction, so run it on its own.
--   BEGIN;
--     UPDATE public.applications SET contact_status='nope' WHERE id = (SELECT id FROM public.applications LIMIT 1);
--     -- expected: ERROR  new row violates check constraint "applications_contact_status_check"
--   ROLLBACK;
