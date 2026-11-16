-- Text the field-rep alert line when FLEET/AIVA hands someone to staff. NOT APPLIED.
-- Needs Dolmar's OK. No table changes: handoffs use public.fleet_review_decisions.
-- Off again: set alert_sms to false.
INSERT INTO public.app_settings (key, value)
VALUES ('fleet_handoff', jsonb_build_object('alert_sms', true, 'approved_by', 'Dolmar Cross', 'approved_at', now()))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
