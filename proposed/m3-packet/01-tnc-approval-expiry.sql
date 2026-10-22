-- Not an install. Do not run this file.
--
-- The only Uber and Lyft date install is proposed/driver-doc-expiry-tnc.sql
-- on pull request 226. The only undo is
-- proposed/rollback/driver-doc-expiry-tnc.sql on that pull request.
-- This file used to add the columns. It does not.

BEGIN;
DO $$
BEGIN
  RAISE EXCEPTION 'tnc_install_is_pull_request_226';
END
$$;
COMMIT;
