-- Driver document expiry: TNC approval dates. NOT INSTALLED. Do not execute
-- on production from this pull request. Not a drizzle or supabase migration.
-- Owner approval is required before any install. Nothing in this repository
-- applies this file.
--
-- Already present, and already named by the shared readiness application:
--   public.applications.license_expiration
--   public.applications.insurance_expires_on
--     (personal policy expiration collected on the application)
--
-- Not present on applications, driver_screenings, or documents: a date the
-- driver's Uber or Lyft (TNC) approval expires. documents.expires_at is a
-- file expiration, and gig_profile is not an expiring approval. Until the
-- columns below exist, that fact stays Unknown and a driver is not marked OK.
--
-- The new columns are nullable dates. They inherit the existing applications
-- row policies. This file does not grant a new read to anon or authenticated.
-- There is no function, so there is no execute grant.
--
-- The alter locks public.applications. Fail that lock after 5 seconds
-- instead of waiting. Re-running this file keeps the same two columns.
-- Undo is proposed/rollback/driver-doc-expiry-tnc.sql. #232 step 1 is a
-- different file with a 2 second lock timeout. Install one copy.

-- Session setting, so the same connection can show it after this file.
-- The following transaction keeps the check and the alter together.
SET lock_timeout = '5s';

BEGIN;

DO $tnc$
DECLARE
  wanted text;
  kind text;
  nullable text;
BEGIN
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
END
$tnc$;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS tnc_uber_approval_expires_on date,
  ADD COLUMN IF NOT EXISTS tnc_lyft_approval_expires_on date;

COMMENT ON COLUMN public.applications.tnc_uber_approval_expires_on IS
  'Calendar day the driver Uber (TNC) approval expires. Proposal only; not installed.';

COMMENT ON COLUMN public.applications.tnc_lyft_approval_expires_on IS
  'Calendar day the driver Lyft (TNC) approval expires. Proposal only; not installed.';

COMMIT;
