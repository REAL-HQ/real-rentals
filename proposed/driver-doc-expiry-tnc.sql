-- Driver document expiry: TNC approval dates. NOT INSTALLED. Do not execute.
-- Not a drizzle or supabase migration. Owner approval is required before any
-- install. Nothing in this repository applies this file.
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

-- INSTALL (proposed, not installed):

ALTER TABLE public.applications
  ADD COLUMN tnc_uber_approval_expires_on date,
  ADD COLUMN tnc_lyft_approval_expires_on date;

COMMENT ON COLUMN public.applications.tnc_uber_approval_expires_on IS
  'Calendar day the driver Uber (TNC) approval expires. Proposal only; not installed.';

COMMENT ON COLUMN public.applications.tnc_lyft_approval_expires_on IS
  'Calendar day the driver Lyft (TNC) approval expires. Proposal only; not installed.';

-- ROLLBACK (not installed). Run this only to undo the install above.
-- It drops the two proposed columns and nothing else.

-- ALTER TABLE public.applications
--   DROP COLUMN IF EXISTS tnc_uber_approval_expires_on,
--   DROP COLUMN IF EXISTS tnc_lyft_approval_expires_on;
