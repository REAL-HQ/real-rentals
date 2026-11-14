-- Past (ended or cancelled) rentals may have no vehicle on file.
-- Active, reserved, and any other non-ended status still require a car.
-- The existing foreign key rentals_vehicle_id_fkey is kept (nullable FK).
-- Every current row has a vehicle_id, so the CHECK is satisfied on apply.

ALTER TABLE public.rentals
  ALTER COLUMN vehicle_id DROP NOT NULL;

ALTER TABLE public.rentals
  DROP CONSTRAINT IF EXISTS rentals_vehicle_required_unless_ended;

ALTER TABLE public.rentals
  ADD CONSTRAINT rentals_vehicle_required_unless_ended
  CHECK (
    vehicle_id IS NOT NULL
    OR status IN (
      'ended',
      'completed',
      'closed',
      'returned',
      'finished',
      'cancelled',
      'canceled',
      'void',
      'voided'
    )
  );

COMMENT ON CONSTRAINT rentals_vehicle_required_unless_ended ON public.rentals IS
  'vehicle_id may be null only for ended or cancelled rentals; active and reserved still require a car.';
