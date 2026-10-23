-- Not an undo. Do not run this file.
--
-- The only undo for the Uber and Lyft dates is
-- proposed/rollback/driver-doc-expiry-tnc.sql on pull request 226.
-- This file used to drop those dates. It does not.

BEGIN;
DO $$
BEGIN
  RAISE EXCEPTION 'tnc_rollback_is_pull_request_226';
END
$$;
COMMIT;
