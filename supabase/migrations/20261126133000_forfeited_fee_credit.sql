-- Forfeited Reservation Fee credits. FILE ONLY. Do not apply until approved.
--
-- 1. renter_credits.expires_at: the app sets this at creation to
--    created_at + the configured number of days. A null expiry (a credit
--    saved before this column existed) stays usable.
-- 2. app_settings.forfeited_fee_credit defaults to case by case, 90 days.
--    Modes: auto | case_by_case | off.

ALTER TABLE public.renter_credits
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

COMMENT ON COLUMN public.renter_credits.expires_at IS
  'When an available credit stops being usable. Null means no expiry (saved before this column).';

INSERT INTO public.app_settings (key, value)
VALUES ('forfeited_fee_credit', jsonb_build_object('mode', 'case_by_case', 'days', 90))
ON CONFLICT (key) DO NOTHING;
