-- Rollback for supabase/migrations/20261117020000_driver_addresses.sql
-- Restores the schema only. applications.address/city/state/zip are left alone
-- (including any primary that was flipped while the table existed).

DROP TRIGGER IF EXISTS applications_sync_primary_address ON public.applications;
DROP TRIGGER IF EXISTS driver_addresses_apply_primary ON public.driver_addresses;
DROP TRIGGER IF EXISTS driver_addresses_normalize ON public.driver_addresses;
DROP FUNCTION IF EXISTS public.applications_sync_primary_address();
DROP FUNCTION IF EXISTS public.driver_addresses_apply_primary();
DROP FUNCTION IF EXISTS public.driver_addresses_normalize();
DROP FUNCTION IF EXISTS public.normalize_driver_zip(text);
DROP FUNCTION IF EXISTS public.normalize_driver_state(text);
DROP TABLE IF EXISTS public.driver_addresses;

ALTER TABLE public.fleet_license_readings
  DROP COLUMN IF EXISTS address_line1,
  DROP COLUMN IF EXISTS address_city,
  DROP COLUMN IF EXISTS address_state,
  DROP COLUMN IF EXISTS address_zip;
