-- Rollback for HOSTED-INSTALL step 18: proposed/m2-packet/14.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
DROP POLICY IF EXISTS "issuer_identity_allow_v5" ON "public"."application_identity_reviews";
DROP POLICY IF EXISTS "issuer_identity_limit_v5" ON "public"."application_identity_reviews";
-- policies removed or replaced by this step
-- triggers added by this step
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
-- functions added by this step
-- functions removed by this step
-- columns added by this step
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
-- row level security flags
-- owners
-- Privileges step 14 granted to rr_evidence_issuer, removed with REVOKE.
-- rr_approval_executor, rr_record_executor, anon, and authenticated keep the
-- column grants from earlier steps because these revokes name rr_evidence_issuer.
REVOKE SELECT (deleted_at, full_name, dob, license_number, license_state, license_expiration) ON TABLE public.applications FROM rr_evidence_issuer;
REVOKE SELECT (id, application_id, kind, status, resolution, positive_evidence_v1, resolved_at) ON TABLE public.application_identity_reviews FROM rr_evidence_issuer;
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
