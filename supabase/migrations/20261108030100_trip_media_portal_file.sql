-- Trip media, step 2 of 2. STAGED — apply only after the trip-media code is
-- published AND the share-copy backfill has run.
--
-- renter_portal_file stops handing out original storage paths for photos and
-- returns the metadata-free share copy instead. Applied before the code it
-- would only make the OLD portal fail to open photos (old code signs whatever
-- path this returns, and legacy rows have no share copy yet); it would never
-- expose more. The new code ignores this function's path for photos either way.

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
