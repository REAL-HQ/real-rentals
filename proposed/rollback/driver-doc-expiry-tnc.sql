-- Rollback for proposed/driver-doc-expiry-tnc.sql.
-- Drops only the two TNC approval dates. license_expiration and
-- insurance_expires_on stay. Run as the local superuser.

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE public.applications
  DROP COLUMN IF EXISTS tnc_uber_approval_expires_on,
  DROP COLUMN IF EXISTS tnc_lyft_approval_expires_on;

COMMIT;
