-- PROPOSED, NOT APPLIED. Turns on automatic late fees. Charges renters money:
-- run only with Dolmar's go-ahead (approved in principle: card t298s1611,
-- "Yes, turn on automatic $50/day late fees").
--
-- Policy (D33-D36, Nov 9 + Nov 15): $50 per day, firm from the day after the
-- due date, and it keeps applying during the 48-hour grace period (the grace
-- period delays the disable, not the fee). No cap. Rent only (not tolls or
-- damage). The daily sweep (cron late-fees-daily, 6:30 AM ET) adds the fee to
-- the unpaid rent row (payments.late_fees and balance_due), once per day.
--
-- Needs the code in this PR first (feat/late-fees-50): it skips renters in an
-- approved payment deal, honors staff waivers, stops counting once the car is
-- returned to the shop, and uses the Eastern calendar day. Without that code
-- this setting would charge Damon's deal weeks. Do not run it before publish.
--
-- Preview on Nov 16, 2026 (dry run of this exact policy over production):
-- $0.00. Only two rent rows are unpaid, both on the rental in the approved
-- deal (Nov 5 week: waived by Dolmar; Nov 12 week: deal open through Nov 21).
INSERT INTO public.app_settings (key, value)
VALUES ('late_fee_policy', '{"enabled": true, "grace_days": 0, "flat_fee": 0, "daily_fee": 50, "max_fee": 0, "rent_only": true}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Verify:
-- SELECT value FROM public.app_settings WHERE key = 'late_fee_policy';
-- Rollback (back to what was there on Nov 15, 2026: off):
-- UPDATE public.app_settings SET value = '{"enabled": false, "max_fee": 100, "flat_fee": 25, "daily_fee": 0, "grace_days": 3}'::jsonb WHERE key = 'late_fee_policy';
