-- Pending Reservation.
--
-- vehicles.status and rentals.status are free text. Neither is an enum and
-- neither has a CHECK that lists allowed values, so storing
-- 'pending_reservation' does not add an enum value or a new column.
--
-- This migration only:
--   1. One pending hold per vehicle, per driver, and per application.
--   2. The blacklist guard also refuses a new pending hold.
--
-- Do not apply this file from the app. An owner applies it.
-- The one-off backfill is proposed/pending-reservation-backfill.sql and is
-- not part of this migration.

CREATE UNIQUE INDEX IF NOT EXISTS rentals_one_pending_reservation_per_vehicle_idx
  ON public.rentals (vehicle_id)
  WHERE status = 'pending_reservation';

CREATE UNIQUE INDEX IF NOT EXISTS rentals_one_pending_reservation_per_driver_idx
  ON public.rentals (driver_id)
  WHERE status = 'pending_reservation';

CREATE UNIQUE INDEX IF NOT EXISTS rentals_one_pending_reservation_per_application_idx
  ON public.rentals (application_id)
  WHERE status = 'pending_reservation' AND application_id IS NOT NULL;

COMMENT ON INDEX public.rentals_one_pending_reservation_per_vehicle_idx IS
  'One Pending Reservation per vehicle. The car is not Available and is not yet Reserved.';

CREATE OR REPLACE FUNCTION private.rentals_blacklist_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE why text;
BEGIN
  IF NEW.status IN ('reserved', 'active', 'pending_reservation') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    why := private.blacklist_block_reason(NEW.application_id, NEW.driver_id);
    IF why IS NOT NULL THEN
      RAISE EXCEPTION '%: no new rental, reservation or activation (rental %)', why, NEW.id USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
