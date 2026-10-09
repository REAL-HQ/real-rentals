-- PROPOSED, NOT APPLIED. Provisional number 0024 (after Codex 0022 Resume, eSign 0023).
-- Additive only: extends the existing vehicle_defaults table (Vehicle Pricing).
-- No existing vehicle, rental or agreement rows are touched.
ALTER TABLE public.vehicle_defaults
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deposit_policy text NOT NULL DEFAULT 'not_set'
    CHECK (deposit_policy IN ('not_set','none','required','waived')),
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS updated_by uuid;
COMMENT ON COLUMN public.vehicle_defaults.active IS 'Inactive templates never pre-fill new vehicles.';
COMMENT ON COLUMN public.vehicle_defaults.display_name IS 'Optional label (e.g. Premium); matching stays by body_type.';
-- Follow-up code (after approval): loadDefaultFor filters active = true;
-- panel shows Active toggle, deposit policy, Last Updated By.
