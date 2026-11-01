-- LOCAL REHEARSAL GAP-FILL (ASSUMPTION, NOT PRODUCTION SQL). Production receipt 20260628200526 (1 statement,
-- md5 af982277…) has no repo file. 20260721192708 (applied in production) needs applications.sms_consent, which
-- the repo only adds later (20260722205426, "ADD COLUMN IF NOT EXISTS sms_consent boolean DEFAULT false").
-- Assumed equivalent; type matches production catalog (boolean). Must be confirmed before any staging use.
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS sms_consent boolean DEFAULT false;
