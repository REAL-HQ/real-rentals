-- PROPOSED. Record Rental evidence transport login. Owner approval required; run
-- only after M2 Window 2 has verified (rr_evidence_issuer must exist).
-- One transaction. Creates the login WITHOUT a password: it cannot sign in until
-- 02-set-transport-password is run with a SCRAM verifier made by
-- scripts/record-rental-transport-scram.mjs, so no password ever passes through SQL.
--
-- Least privilege: membership in rr_evidence_issuer only, usable through SET ROLE,
-- never inherited. Not rr_approval_executor: the runtime never needs it. Not an API
-- role, so PostgREST can never reach it. private.approval_provider_actor accepts
-- this login only while its role is rr_evidence_issuer and the JWT claims it sets
-- name a live staff session.
BEGIN;
CREATE ROLE rr_evidence_transport LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
  NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 10;
GRANT rr_evidence_issuer TO rr_evidence_transport WITH INHERIT FALSE, SET TRUE;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO rr_evidence_transport', current_database()); END $$;
ALTER ROLE rr_evidence_transport SET statement_timeout = '15s';
ALTER ROLE rr_evidence_transport SET idle_in_transaction_session_timeout = '15s';
-- Verify before COMMIT: exactly one membership, SET only, no inheritance, no API role in it.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_auth_members m WHERE m.member = 'rr_evidence_transport'::regrole) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = 'rr_evidence_transport'::regrole
                    AND m.roleid = 'rr_evidence_issuer'::regrole AND m.set_option AND NOT m.inherit_option)
     OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = 'rr_evidence_transport'::regrole)
  THEN RAISE EXCEPTION 'rr_evidence_transport shape is not as reviewed'; END IF;
END $$;
COMMIT;
