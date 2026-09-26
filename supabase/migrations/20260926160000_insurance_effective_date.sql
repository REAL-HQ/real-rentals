-- =============================================================================
-- One column the editor needs: when cover started.
--
-- insurance_expires_on has always been here, and the expiry is what drives the
-- warnings — but a policy has two ends, and "is this car covered today?" is not
-- answerable from the expiry alone when a policy was bought mid-term or
-- switched carriers. Additive, nullable, no backfill: an unknown start date is
-- unknown, not today's.
-- =============================================================================

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS insurance_effective_on date;

COMMENT ON COLUMN public.vehicles.insurance_effective_on IS
  'Date the current policy took effect. Null means nobody recorded it, not
   that cover is absent — insurance_expires_on is what the alerts read.';

NOTIFY pgrst, 'reload schema';
