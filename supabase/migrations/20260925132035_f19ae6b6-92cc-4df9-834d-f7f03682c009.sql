-- =============================================================================
-- HOTFIX: applicants cannot upload files
--
-- Every file upload in the application wizard — licence, insurance, gig
-- screenshots, trip totals — has been failing with "We couldn't upload that
-- file" since 2026-07-21.
--
-- What happened:
--
--   20260721191235  the scoped upload policies were tightened to verify the
--                   path's first segment is a real application, via
--                   EXISTS (SELECT 1 FROM public.applications ...). That
--                   subquery runs as `anon`, so the same migration added
--                   GRANT SELECT (id) ON public.applications TO anon.
--
--   20260721192708  fifteen minutes later, an unrelated lockdown ran
--                   REVOKE ALL ON public.applications FROM anon — which wiped
--                   that grant.
--
-- From then on the policy could not read the table it depends on, so every
-- anonymous upload failed with "permission denied for table applications".
-- Later migrations widened the check to read created_at, status and
-- current_step as well, putting it further out of reach.
--
-- Re-granting would work but is fragile: it re-exposes application columns to
-- anon and breaks again the next time somebody revokes broadly. Instead the
-- check moves into a SECURITY DEFINER function, so `anon` needs no privilege
-- on `applications` at all and the policy cannot be broken by a future grant
-- change. The function returns only a boolean — no row contents are exposed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.application_accepts_uploads(_application_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.applications a
    WHERE a.id::text = _application_id
      AND a.created_at > now() - interval '14 days'
      AND COALESCE(lower(a.status), '') NOT IN ('complete','completed','approved','rejected','active')
      AND COALESCE(lower(a.current_step), '') NOT IN ('confirmation','complete','done')
  )
$$;
COMMENT ON FUNCTION public.application_accepts_uploads(text) IS
  'True when this application is still open and may receive file uploads.
   SECURITY DEFINER so the storage policies can check it without `anon`
   holding any privilege on public.applications.';

REVOKE ALL ON FUNCTION public.application_accepts_uploads(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.application_accepts_uploads(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submission_accepts_uploads(_submission_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.fleet_owner_submissions s
    WHERE s.id::text = _submission_id
      AND s.created_at > now() - interval '14 days'
      AND COALESCE(lower(s.status), '') NOT IN ('approved','enrolled','declined')
  )
$$;
COMMENT ON FUNCTION public.submission_accepts_uploads(text) IS
  'True when this fleet-owner submission is still open and may receive uploads.';

REVOKE ALL ON FUNCTION public.submission_accepts_uploads(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submission_accepts_uploads(text) TO anon, authenticated, service_role;

-- The path shape is unchanged: <application-uuid>/<filename>, where the
-- filename is restricted to characters the wizard actually produces.
DROP POLICY IF EXISTS "Scoped upload license photos" ON storage.objects;
CREATE POLICY "Scoped upload license photos" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'license-uploads'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]+$'
    AND public.application_accepts_uploads(split_part(objects.name, '/', 1))
  );

DROP POLICY IF EXISTS "Scoped upload profile screenshots" ON storage.objects;
CREATE POLICY "Scoped upload profile screenshots" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'profile-screenshots'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]+$'
    AND public.application_accepts_uploads(split_part(objects.name, '/', 1))
  );

DROP POLICY IF EXISTS "Scoped upload owner vehicle photos" ON storage.objects;
CREATE POLICY "Scoped upload owner vehicle photos" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'owner-vehicle-photos'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]+$'
    AND public.submission_accepts_uploads(split_part(objects.name, '/', 1))
  );

-- A note on upsert, because the obvious next move is wrong.
--
-- The wizard uploads with upsert:true, so the natural instinct is to add a
-- matching UPDATE policy for the overwrite path. That policy would be inert:
-- an UPDATE with a WHERE clause also reads the row, so it is filtered by the
-- SELECT policies, and `anon` matches none of them — the update finds zero
-- rows and the upload still fails. Making it work would mean giving `anon` a
-- SELECT policy on storage.objects, i.e. letting anyone holding an
-- application id list that folder's contents.
--
-- That trade is not worth making, because the overwrite path cannot be
-- reached: every applicant-facing upload builds a fresh key from a timestamp
-- and a random suffix (ApplicationWizard) or a UUID (partners), so a given
-- object name is only ever written once. upsert:true stays in the client as
-- a harmless belt-and-braces; the INSERT policies above are what actually
-- carry every upload.
