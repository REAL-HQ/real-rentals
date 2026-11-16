-- RentID switch for FLEET's applicant review (docs/fleet-rentid.md).
-- NOT APPLIED. No row = OFF. Run only with Dolmar's approval.

-- Turn on recording results and the approval requirement:
-- INSERT INTO public.app_settings (key, value, updated_at)
-- VALUES ('fleet_rentid', '{"record_results": true, "require_for_approval": true}'::jsonb, now())
-- ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Rollback (back to OFF):
-- DELETE FROM public.app_settings WHERE key = 'fleet_rentid';
