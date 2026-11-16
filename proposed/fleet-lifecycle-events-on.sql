-- Turn on FLEET lifecycle events. NOT APPLIED. Needs Dolmar's OK.
-- Requires fleet-lifecycle-events-v1.sql first. Only looks back 30 minutes,
-- so turning it on never replays history. Off again: set enabled to false.
INSERT INTO public.app_settings (key, value)
VALUES ('fleet_lifecycle_events', jsonb_build_object('enabled', true, 'approved_by', 'Dolmar Cross', 'approved_at', now()))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
