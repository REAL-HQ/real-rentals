-- Renters may read swap pickup photos for their own visible rentals.
-- DO NOT apply to production until this change is reviewed.
--
-- Adds one SELECT policy and one helper. It does not INSERT, UPDATE, or
-- DELETE any row, and it does not send email or text. Renters still cannot
-- write photos. The driver portal signs a metadata-free copy from the
-- server; this policy is the database check if a renter queries the table.
--
-- rental_vehicle_swaps is staff-read only. The ownership check therefore
-- runs in a SECURITY DEFINER function. A policy that joined the swaps table
-- as the renter would see no swap and hide every photo.
--
-- How to apply (after review, against the target database, not from the app):
--   psql "$DATABASE_URL" -f supabase/migrations/20261123143000_renter_read_own_swap_photos.sql

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION private.renter_can_read_swap_photo(_swap_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rental_vehicle_swaps s
    WHERE s.id = _swap_id
      AND s.rental_id IN (SELECT private.renter_visible_rental_ids())
  );
$$;

REVOKE ALL ON FUNCTION private.renter_can_read_swap_photo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.renter_can_read_swap_photo(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Renters read swap photos on their rental" ON public.rental_vehicle_swap_photos;
CREATE POLICY "Renters read swap photos on their rental"
  ON public.rental_vehicle_swap_photos
  FOR SELECT TO authenticated
  USING (private.renter_can_read_swap_photo(swap_id));

-- Paths stay on the service role, the same way condition_media hides them.
-- Staff screens read this table through the service role.
REVOKE SELECT ON public.rental_vehicle_swap_photos FROM authenticated;
GRANT SELECT (
  id, swap_id, vehicle_id, mime_type, size_bytes, file_name, created_at
) ON public.rental_vehicle_swap_photos TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rental_vehicle_swap_photos FROM authenticated;
REVOKE ALL ON public.rental_vehicle_swap_photos FROM anon;

COMMENT ON POLICY "Renters read swap photos on their rental" ON public.rental_vehicle_swap_photos IS
  'A renter may read swap pickup photos only for a rental private.renter_visible_rental_ids already allows. No write.';

COMMIT;

-- ROLLBACK (drops the renter read only; staff read and the photo rows stay):
-- BEGIN;
-- DROP POLICY IF EXISTS "Renters read swap photos on their rental" ON public.rental_vehicle_swap_photos;
-- DROP FUNCTION IF EXISTS private.renter_can_read_swap_photo(uuid);
-- GRANT SELECT ON public.rental_vehicle_swap_photos TO authenticated;
-- COMMIT;
