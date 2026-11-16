-- PROPOSED, NOT APPLIED. Turns on automatic higher weekly rates for insurance
-- quotes over $350/month (Dolmar, card t299s1618: "Automatically offer a higher
-- weekly rate to cover it"). Changes what renters are quoted: run only with
-- Dolmar's go-ahead, after the code in feat/sop-fleet-rules is published.
--
-- Formula (src/lib/insurance-rate.ts):
--   surcharge/week = (monthly quote - 350) x 12 / 52, rounded UP to the next $5
--   offered weekly = the car's listed weekly rate + surcharge/week
--   e.g. $450/month on a $325/week car -> +$25 -> $350/week.
-- Quotes over max_auto_monthly ($1,000) still go to staff.
--
-- With no row (today) the switch is OFF: FLEET's assign-vehicle refuses a quote
-- over $350/month with needs_staff, and staff price it.
INSERT INTO public.app_settings (key, value)
VALUES ('insurance_rate_adjust', '{"enabled": true, "included_monthly": 350, "max_auto_monthly": 1000}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Verify:   SELECT value FROM public.app_settings WHERE key = 'insurance_rate_adjust';
-- Rollback: UPDATE public.app_settings SET value = jsonb_set(value, '{enabled}', 'false') WHERE key = 'insurance_rate_adjust';
