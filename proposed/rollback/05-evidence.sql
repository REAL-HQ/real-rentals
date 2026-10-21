-- Rollback for M2 rehearsal step 05: 030-evidence-v1.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
-- policies removed or replaced by this step
-- triggers added by this step
DROP TRIGGER IF EXISTS "consumption_immutable" ON "private"."record_evidence_consumed_v1";
DROP TRIGGER IF EXISTS "evidence_immutable" ON "private"."record_evidence_v1";
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
-- functions added by this step
DROP FUNCTION IF EXISTS "private"."issue_record_evidence_v1"(req jsonb, verified jsonb, expected_snapshot jsonb);
DROP FUNCTION IF EXISTS "private"."record_agreement_evidence_v1"(a uuid, v uuid, t timestamp with time zone, rate numeric);
DROP FUNCTION IF EXISTS "private"."record_existing_rental_evidence_core_v1"(_operation_id uuid, _application_id uuid, _vehicle_id uuid, _started_at timestamp with time zone, _weekly_rate numeric, _deposit numeric, _pickup_miles integer, _subscription_evidence_id uuid, _reason text);
DROP FUNCTION IF EXISTS "private"."record_session_v1"();
DROP FUNCTION IF EXISTS "private"."record_snapshot_v1"(a uuid, v uuid, g uuid, d uuid);
DROP FUNCTION IF EXISTS "private"."record_subscription_evidence_v1"(token uuid, a uuid, rate numeric);
DROP FUNCTION IF EXISTS "public"."record_existing_rental_evidence_v1"(token uuid, req jsonb);
-- functions removed by this step
-- columns added by this step
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
DROP TABLE IF EXISTS "private"."record_evidence_consumed_v1" CASCADE;
DROP TABLE IF EXISTS "private"."record_evidence_context_v1" CASCADE;
DROP TABLE IF EXISTS "private"."record_evidence_v1" CASCADE;
-- row level security flags
-- owners
-- privileges granted to roles this step created
REVOKE ALL ON SCHEMA "auth" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL TABLES IN SCHEMA "auth" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "auth" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "auth" FROM "rr_evidence_issuer";
REVOKE ALL ON SCHEMA "cron" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL TABLES IN SCHEMA "cron" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "cron" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "cron" FROM "rr_evidence_issuer";
REVOKE ALL ON SCHEMA "extensions" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL TABLES IN SCHEMA "extensions" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "extensions" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "extensions" FROM "rr_evidence_issuer";
REVOKE ALL ON SCHEMA "net" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL TABLES IN SCHEMA "net" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "net" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "net" FROM "rr_evidence_issuer";
REVOKE ALL ON SCHEMA "private" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL TABLES IN SCHEMA "private" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "private" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "private" FROM "rr_evidence_issuer";
REVOKE ALL ON SCHEMA "public" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM "rr_evidence_issuer";
REVOKE ALL ON SCHEMA "storage" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL TABLES IN SCHEMA "storage" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "storage" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "storage" FROM "rr_evidence_issuer";
REVOKE ALL ON SCHEMA "vault" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL TABLES IN SCHEMA "vault" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "vault" FROM "rr_evidence_issuer";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "vault" FROM "rr_evidence_issuer";
-- Step 5 grants USAGE on schema private to rr_evidence_issuer. REVOKE ALL
-- above removes that grant and leaves step 0's USAGE for rr_approval_executor
-- and step 3's CREATE for rr_record_executor. DROP OWNED BY removes any
-- remaining grants, so DROP ROLE does not write pg_shdepend.
-- Steps 9 and 14 rewrote column and function ACLs in place. That left
-- shared-dependency rows for rr_evidence_issuer after the privileges
-- themselves were gone. Granting each one and revoking it clears the row
-- through the privilege commands. The revoke is in this same transaction,
-- so the committed privileges match the pre-step catalog.
GRANT USAGE ON SCHEMA public TO rr_evidence_issuer;
REVOKE USAGE ON SCHEMA public FROM rr_evidence_issuer;
GRANT EXECUTE ON FUNCTION private.approval_actor(), private.approval_lock() TO rr_evidence_issuer;
REVOKE EXECUTE ON FUNCTION private.approval_actor(), private.approval_lock() FROM rr_evidence_issuer;
GRANT SELECT (id, application_id, vehicle_id, body, merge_data, status, signed_at, voided_at, document_id, completed_document_id, sha256, body_sha256) ON TABLE public.agreements TO rr_evidence_issuer;
REVOKE SELECT (id, application_id, vehicle_id, body, merge_data, status, signed_at, voided_at, document_id, completed_document_id, sha256, body_sha256) ON TABLE public.agreements FROM rr_evidence_issuer;
GRANT SELECT (id, user_id, full_name, dob, license_number, license_state, license_expiration, deleted_at) ON TABLE public.applications TO rr_evidence_issuer;
REVOKE SELECT (id, user_id, full_name, dob, license_number, license_state, license_expiration, deleted_at) ON TABLE public.applications FROM rr_evidence_issuer;
GRANT SELECT (id, driver_id, storage_bucket, storage_path, category, is_current, superseded_by, review_status, reviewed_at, reviewed_by, content_sha256) ON TABLE public.documents TO rr_evidence_issuer;
REVOKE SELECT (id, driver_id, storage_bucket, storage_path, category, is_current, superseded_by, review_status, reviewed_at, reviewed_by, content_sha256) ON TABLE public.documents FROM rr_evidence_issuer;
GRANT SELECT (user_id, role) ON TABLE public.user_roles TO rr_evidence_issuer;
REVOKE SELECT (user_id, role) ON TABLE public.user_roles FROM rr_evidence_issuer;
GRANT SELECT (id, application_id, kind, status, resolution, resolved_at) ON TABLE public.application_identity_reviews TO rr_evidence_issuer;
REVOKE SELECT (id, application_id, kind, status, resolution, resolved_at) ON TABLE public.application_identity_reviews FROM rr_evidence_issuer;
-- comments
-- role memberships added by this step
-- roles added by this step
DROP OWNED BY "rr_evidence_issuer";
DROP ROLE IF EXISTS "rr_evidence_issuer";
COMMIT;
