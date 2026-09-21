-- =============================================================================
-- Rental activation guards
--
-- activateRental checks that a vehicle is free before creating a rental, but
-- that check and the insert are two separate statements: two operators hitting
-- "Activate" at the same moment can both pass the check and both insert,
-- handing one car to two drivers. With a six-car fleet and paid traffic that
-- is a plausible Tuesday, not a theoretical race.
--
-- These partial unique indexes make it impossible in the database, which is
-- the only place the guarantee actually holds.
-- =============================================================================

-- A vehicle can be on at most one active rental.
CREATE UNIQUE INDEX IF NOT EXISTS rentals_one_active_per_vehicle_idx
  ON public.rentals (vehicle_id)
  WHERE status = 'active';

-- A driver can hold at most one active rental.
CREATE UNIQUE INDEX IF NOT EXISTS rentals_one_active_per_driver_idx
  ON public.rentals (driver_id)
  WHERE status = 'active';

COMMENT ON INDEX public.rentals_one_active_per_vehicle_idx IS
  'Prevents double-booking a vehicle. Enforced here because the application''s
   pre-flight check is not atomic with the insert.';
