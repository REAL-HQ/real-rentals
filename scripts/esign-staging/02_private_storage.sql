-- ===========================================================================
-- eSign STAGING — the private rental-agreements bucket.
-- PROPOSED. NOT APPLIED. Staging only (bhpdppyxnkokzhlkgcsc).
--
-- Extracted from production (yuyzdsnrbfhkmfzpvhwx) read-only on 2026-10-13.
--
-- THE FINDING THIS FILE IS BUILT ON, because it is easy to get wrong:
--
--   Production has NO staff policy and NO driver policy on
--   storage.objects for the rental-agreements bucket. Exactly one policy
--   names the bucket at all — the partner read below.
--
-- That is not an oversight, it is the design. A signed PDF is reached only
-- through the service role: getAgreementPdf checks the caller
-- (getActor -> requireManager, PR #25), looks the document up, and calls
-- supabaseAdmin.storage.download(). A driver gets their own copy the same
-- way, through a server function that has already checked they own it.
--
-- So this file adds NO staff or driver storage policy. Adding one would be
-- WEAKER than production: it would make signed contracts readable straight
-- from PostgREST with a back-office session, bypassing the Manager check in
-- the server function. Manager-level restriction and Driver-own access are
-- preserved where production actually keeps them — in the server functions,
-- over a bucket that answers nobody directly.
--
-- public = false. Signed PDFs are never publicly readable.
-- ===========================================================================

-- NO BEGIN/COMMIT HERE. The runner owns the transaction: install.sh wraps
-- preflight, this payload, the ledger receipt and postflight in ONE
-- transaction, which is what makes the stage and its receipt atomic. A
-- COMMIT in this file would end that transaction early and let the work
-- land without — or before — its receipt.

-- The bucket. Private, no size cap and no MIME allow-list, as production has
-- it. ON CONFLICT so a re-run cannot flip an existing bucket's visibility.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('rental-agreements', 'rental-agreements', false, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- A bucket that already existed must still be private. Stop rather than
-- silently serving signed contracts to the internet.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='rental-agreements' AND public IS TRUE) THEN
    RAISE EXCEPTION 'STOP: the rental-agreements bucket is public. Signed PDFs must never be publicly readable.';
  END IF;
END $$;

-- The one policy production carries for this bucket: a partner reads a
-- document only when a documents row says it is theirs and marks it
-- partner-visible. Not a blanket bucket grant — every condition is checked
-- against the vault row, so an object with no row is unreachable.
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
  END IF;
END $$;

-- Deliberately NOT created here, and asserted absent by the verification
-- script: any policy granting authenticated/anon a direct read of
-- rental-agreements objects. If one appears later, the server-side Manager
-- gate on getAgreementPdf has been bypassed and signed contracts are
-- readable from the browser.

