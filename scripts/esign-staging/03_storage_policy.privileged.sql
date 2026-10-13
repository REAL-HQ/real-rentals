-- ===========================================================================
-- eSign STAGING — the partner read policy on storage.objects.
-- PROPOSED. NOT APPLIED. Staging only (bhpdppyxnkokzhlkgcsc).
--
-- REQUIRES A PRIVILEGED EXECUTION PATH. THIS INSTALLER CANNOT RUN IT.
--
-- Postgres requires superuser or ownership of the table to CREATE POLICY on
-- it. storage.objects is owned by supabase_storage_admin, and the staging
-- connection the installer uses runs as postgres, which is neither a
-- superuser nor a member of that role. Verified read-only against the
-- catalogue on 2026-10-13:
--
--   storage.objects owner             supabase_storage_admin
--   member of supabase_storage_admin  false
--   is_superuser                      false
--   can INSERT storage.buckets        true
--
-- So the bucket INSERT (02_private_storage.sql) succeeds on the ordinary SQL
-- path and this file does NOT. The ten historical migrations in
-- supabase/migrations that create storage policies were applied through the
-- provider's own privileged pipeline, not a SQL console session. This file
-- goes the same way.
--
-- The rule is Postgres's own, not a Supabase one, so this is also correct on
-- a plain cluster where supabase_storage_admin does not exist at all.
--
-- ORDER: apply this FIRST, then stage10. stage10's preflight refuses to run
-- until the policy below exists, because a bucket without it is a partial
-- installation of the reviewed design.
--
-- Candidate privileged paths, none of them yet reviewed or chosen:
--   - the Supabase Dashboard Storage policy editor
--   - the provider migration pipeline that applied the ten existing policies
--   - a session as a role that owns storage.objects, if the provider grants one
-- Whichever is chosen needs its own review before it is used. Nothing here
-- selects one, and nothing here escalates: no ownership change, no role
-- grant, no ALTER TABLE ... OWNER TO.
--
-- WHAT THE POLICY IS, and why it is not wider:
--
--   Production has NO staff policy and NO driver policy on storage.objects
--   for rental-agreements. Exactly one policy names the bucket — this one.
--   That is the design, not an oversight. A signed PDF is reached through
--   the service role: getAgreementPdf checks the caller (getActor ->
--   requireManager, PR #25), looks the document up, and calls
--   supabaseAdmin.storage.download(). A driver gets their own copy the same
--   way, through a server function that has already checked they own it.
--
--   Adding a staff or driver storage policy would be WEAKER than production:
--   it would make signed contracts readable straight from PostgREST with a
--   back-office session, bypassing the Manager check in the server function.
-- ===========================================================================

-- NO BEGIN/COMMIT HERE. Whoever runs this owns the transaction.

-- Refuse early and plainly if the executing role cannot do this, rather than
-- failing on a bare "must be owner of table objects" from deep inside.
DO $$
DECLARE may_create boolean;
BEGIN
  SELECT coalesce((SELECT usesuper FROM pg_user WHERE usename = current_user), false)
      OR pg_has_role(current_user,
           (SELECT tableowner FROM pg_tables WHERE schemaname='storage' AND tablename='objects'),
           'MEMBER')
    INTO may_create;
  IF NOT may_create THEN
    RAISE EXCEPTION
      'STOP: % cannot CREATE POLICY on storage.objects (owner is %). This file needs the privileged execution path; it is not part of what install.sh can apply. Do not work around this by changing ownership or granting roles.',
      current_user,
      coalesce((SELECT tableowner FROM pg_tables WHERE schemaname='storage' AND tablename='objects'), 'unknown');
  END IF;
END $$;

-- The prerequisites the policy body reads. A policy that cannot resolve its
-- columns is a policy that never matches — which looks like security and is
-- actually a silent denial.
DO $$
DECLARE missing text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='private' AND p.proname='is_partner_owner') THEN
    RAISE EXCEPTION 'STOP: private.is_partner_owner is missing; this policy cannot be created without it.';
  END IF;
  SELECT string_agg(c, ', ') INTO missing FROM unnest(ARRAY[
    'storage_bucket','storage_path','visibility','partner_id'
  ]) c WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='documents' AND column_name=c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: public.documents is missing column(s) this policy reads: %', missing;
  END IF;
END $$;

-- The one policy production carries for this bucket: a partner reads a
-- document only when a documents row says it is theirs and marks it
-- partner-visible. Not a blanket bucket grant — every condition is checked
-- against the vault row, so an object with no row is unreachable.
--
-- Idempotent: re-running this file is a no-op, never a duplicate policy and
-- never a silent redefinition of one somebody else reviewed.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects'
       AND policyname='Partners read their driver documents'
  ) THEN
    CREATE POLICY "Partners read their driver documents" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        (bucket_id = ANY (ARRAY['rental-agreements'::text, 'license-uploads'::text]))
        AND EXISTS (
          SELECT 1 FROM public.documents d
           WHERE d.storage_bucket = objects.bucket_id
             AND d.storage_path = objects.name
             AND 'partner'::text = ANY (d.visibility)
             AND d.partner_id IS NOT NULL
             AND private.is_partner_owner(d.partner_id)
        )
      );
    RAISE NOTICE 'created policy "Partners read their driver documents" on storage.objects';
  ELSE
    RAISE NOTICE 'policy "Partners read their driver documents" already present; nothing changed';
  END IF;
END $$;
