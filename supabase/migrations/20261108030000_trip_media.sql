-- Trip media: Pickup / Return / Issues, each Ours / Yours, on the renter profile.
--
-- STAGED. Not applied to production by this PR; apply only with release approval.
--
-- 1. condition_media learns which application a file belongs to (pre-rental
--    media has no rental yet) and where its metadata-free share copy is.
-- 2. Renters read rows for their own visible rentals only — not every row on
--    a car they rent — and can no longer read GPS columns or original paths
--    through PostgREST. Inserts go through the server only.
-- 3. renter_portal_file signs the share copy, never the original.

ALTER TABLE public.condition_media
  ADD COLUMN IF NOT EXISTS application_id uuid,
  ADD COLUMN IF NOT EXISTS share_path text;

DO $$ BEGIN
  ALTER TABLE public.condition_media
    ADD CONSTRAINT condition_media_application_id_fkey
    FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS condition_media_application_idx
  ON public.condition_media (application_id, created_at DESC) WHERE application_id IS NOT NULL;

COMMENT ON COLUMN public.condition_media.application_id IS
  'Applicant this file belongs to. Set for staff trip uploads (incl. before any rental) and renter uploads.';
COMMENT ON COLUMN public.condition_media.share_path IS
  'Metadata-free copy (EXIF/XMP/GPS removed, pixels untouched) that renters may be shown. NULL = team only.';
COMMENT ON COLUMN public.condition_media.taken_at IS
  'Camera/EXIF capture time when known (taken_at_source=exif); NULL otherwise. Upload time is created_at.';

-- Renter read: own visible rentals only.
DROP POLICY IF EXISTS "Drivers read condition media on their vehicle" ON public.condition_media;
DROP POLICY IF EXISTS "Drivers read condition media on their rental" ON public.condition_media;
CREATE POLICY "Drivers read condition media on their rental" ON public.condition_media
  FOR SELECT TO authenticated
  USING (rental_id IN (SELECT private.renter_visible_rental_ids()));

-- Renter insert: server only (it sets role, binding, times and GPS itself).
DROP POLICY IF EXISTS "Drivers add condition media on their vehicle" ON public.condition_media;

-- Column privileges: GPS and original paths are not readable with a user JWT.
-- The server reads them with the service role and only returns them to staff.
REVOKE SELECT ON public.condition_media FROM authenticated;
GRANT SELECT (
  id, vehicle_id, rental_id, application_id, inspection_id, incident_id, phase, angle,
  media_type, storage_bucket, file_name, mime_type, size_bytes, captured_by,
  captured_by_role, caption, created_at, taken_at, taken_at_source
) ON public.condition_media TO authenticated;

CREATE OR REPLACE FUNCTION public.renter_portal_file(_kind text, _id uuid)
RETURNS TABLE (storage_bucket text, storage_path text) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF _kind = 'photo' THEN
    RETURN QUERY SELECT m.storage_bucket, m.share_path FROM public.condition_media m
      WHERE m.id = _id AND m.share_path IS NOT NULL
        AND m.rental_id IN (SELECT private.renter_visible_rental_ids());
  ELSIF _kind = 'registration' THEN
    RETURN QUERY SELECT d.storage_bucket, d.storage_path FROM public.documents d
      JOIN public.rentals r ON r.vehicle_id = d.vehicle_id
      WHERE d.id = _id AND d.category = 'registration' AND d.is_current
        AND r.driver_id = _uid AND private.renter_portal_stage(r.status, r.end_date) = 'active';
  ELSIF _kind = 'insurance' THEN
    RETURN QUERY SELECT d.storage_bucket, d.storage_path FROM public.documents d
      JOIN public.applications a ON a.id = d.driver_id
      WHERE d.id = _id AND a.user_id = _uid AND d.category = 'insurance' AND 'driver' = ANY (d.visibility)
        AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.driver_id = _uid
                     AND private.renter_portal_stage(r.status, r.end_date) = 'active');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.renter_portal_file(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renter_portal_file(text, uuid) TO authenticated;
