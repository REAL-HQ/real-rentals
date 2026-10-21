-- Rollback for HOSTED-INSTALL step 1: proposed/m3-packet/01-tnc-approval-expiry.sql
-- Drops only the two TNC approval dates. license_expiration and
-- insurance_expires_on stay. Run this only after that step committed
-- and its verify failed, or to leave the rehearsal where it started.

BEGIN;
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.applications
  DROP COLUMN IF EXISTS tnc_uber_approval_expires_on,
  DROP COLUMN IF EXISTS tnc_lyft_approval_expires_on;

COMMIT;
