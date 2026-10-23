-- Rehearsal-only prestep, run immediately before baseline seq 39.
-- Seq 39 (20260721192708_1efcc7f8) grants INSERT on applications.sms_consent,
-- which seq 44 (20260722205426_c7483f5d) adds. This is seq 44's own
-- definition, verbatim, so seq 44 becomes a no-op for this column exactly as
-- it is in production. No migration file is modified.
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS sms_consent boolean DEFAULT false;
