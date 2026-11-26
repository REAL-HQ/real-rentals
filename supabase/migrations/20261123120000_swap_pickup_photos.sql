-- Staff-only pickup photos on a vehicle swap.
-- DO NOT apply to production until this change is reviewed. Applying it
-- creates one new table. It does not UPDATE rental_vehicle_swaps, rentals,
-- vehicles, agreements, payments or app_settings, and it does not change
-- any swap status (including a Completed swap).
--
-- Files themselves go in the existing private bucket condition-media
-- (50 MB, staff storage policies already in fleet_ops_foundation). This
-- table only records which swap they belong to. Renters have no policy.
--
-- How to apply (after review, against the target database, not from the app):
--   psql "$DATABASE_URL" -f supabase/migrations/20261123120000_swap_pickup_photos.sql
-- Rollback is commented at the bottom. Dropping the table does not delete
-- objects already stored under {vehicleId}/swap/{swapId}/.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.rental_vehicle_swap_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_id uuid NOT NULL REFERENCES public.rental_vehicle_swaps(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  storage_bucket text NOT NULL DEFAULT 'condition-media' CHECK (storage_bucket = 'condition-media'),
  storage_path text NOT NULL,
  file_name text,
  mime_type text NOT NULL,
  size_bytes bigint CHECK (size_bytes IS NULL OR (size_bytes > 0 AND size_bytes <= 52428800)),
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_vehicle_swap_photos_path_uniq UNIQUE (storage_path),
  CONSTRAINT rental_vehicle_swap_photos_path_chk CHECK (
    storage_path LIKE (vehicle_id::text || '/swap/' || swap_id::text || '/%')
    AND storage_path NOT LIKE '%..%'
    AND length(storage_path) <= 400
  )
);

CREATE INDEX IF NOT EXISTS rental_vehicle_swap_photos_swap_idx
  ON public.rental_vehicle_swap_photos (swap_id, created_at);

ALTER TABLE public.rental_vehicle_swap_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read rental vehicle swap photos" ON public.rental_vehicle_swap_photos;
CREATE POLICY "Staff read rental vehicle swap photos" ON public.rental_vehicle_swap_photos
  FOR SELECT TO authenticated USING (private.is_staff());

REVOKE ALL ON public.rental_vehicle_swap_photos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rental_vehicle_swap_photos FROM authenticated;
GRANT SELECT ON public.rental_vehicle_swap_photos TO authenticated;
GRANT ALL ON public.rental_vehicle_swap_photos TO service_role;

COMMENT ON TABLE public.rental_vehicle_swap_photos IS
  'Staff-only pickup photos for a vehicle swap (src/lib/swap-pickup-photos.server.ts). Insert-only from the server. Uploading does not change the swap.';

COMMIT;

-- ROLLBACK (drops this photo table only; does not touch swaps, rentals or vehicles):
-- BEGIN;
-- DROP TABLE IF EXISTS public.rental_vehicle_swap_photos;
-- COMMIT;
