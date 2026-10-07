ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS sms_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_consent_source text,
  ADD COLUMN IF NOT EXISTS sms_consent_version text,
  ADD COLUMN IF NOT EXISTS sms_consent_text text,
  ADD COLUMN IF NOT EXISTS sms_consent_phone text,
  ADD COLUMN IF NOT EXISTS sms_consent_page text;

INSERT INTO public.app_settings (key, value)
VALUES ('system_preferences', jsonb_build_object('business_phone', '+18888338280'))
ON CONFLICT (key) DO UPDATE
  SET value = COALESCE(public.app_settings.value, '{}'::jsonb) || jsonb_build_object('business_phone', '+18888338280');

UPDATE public.automation_steps
   SET body = replace(replace(body, '(813) 699-9118', '{{company_phone}}'), '+1 (813) 699-9118', '{{company_phone}}')
 WHERE body LIKE '%699-9118%';