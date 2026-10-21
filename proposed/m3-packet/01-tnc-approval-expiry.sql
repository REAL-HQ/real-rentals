-- HOSTED-INSTALL step 1: proposed/m3-packet/01-tnc-approval-expiry.sql
-- Proposed only. Not a drizzle or supabase migration. Nothing in this
-- repository applies this file. Owner approval is required before any
-- hosted run.
--
-- Source: proposed/driver-doc-expiry-tnc.sql on PR #226 at 7bfe60e4.
-- Already present, and left unchanged:
--   public.applications.license_expiration
--   public.applications.insurance_expires_on
-- The new columns are the Uber and Lyft (TNC) approval expirations that
-- Driver Doc Expiry does not have yet. They are nullable dates with no
-- default, so existing rows stay in place and the row count does not
-- change. They inherit the existing applications row policies. This file
-- does not grant, and it does not create a policy.

BEGIN;
SET LOCAL lock_timeout = '2s';

DO $m3$
DECLARE
  apps bigint;
  kind text;
  nullable text;
  wanted text;
BEGIN
  SELECT count(*) INTO apps FROM public.applications;
  IF apps IS NULL THEN
    RAISE EXCEPTION 'applications_count_failed';
  END IF;
  FOREACH wanted IN ARRAY ARRAY[
    'tnc_uber_approval_expires_on',
    'tnc_lyft_approval_expires_on'
  ]
  LOOP
    kind := NULL;
    nullable := NULL;
    SELECT c.data_type, c.is_nullable INTO kind, nullable
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'applications'
      AND c.column_name = wanted;
    IF FOUND AND (kind IS DISTINCT FROM 'date' OR nullable IS DISTINCT FROM 'YES') THEN
      RAISE EXCEPTION 'tnc_column_shape_%_%_%', wanted, kind, nullable;
    END IF;
  END LOOP;
  RAISE NOTICE 'm3 step 1 preflight applications=%', apps;
END
$m3$;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS tnc_uber_approval_expires_on date,
  ADD COLUMN IF NOT EXISTS tnc_lyft_approval_expires_on date;

COMMENT ON COLUMN public.applications.tnc_uber_approval_expires_on IS
  'Calendar day the driver Uber (TNC) approval expires.';

COMMENT ON COLUMN public.applications.tnc_lyft_approval_expires_on IS
  'Calendar day the driver Lyft (TNC) approval expires.';

COMMIT;
