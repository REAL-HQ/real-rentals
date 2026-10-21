-- Rollback for M2 rehearsal step 00: 00-approval-boundary.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
DROP POLICY IF EXISTS "approval_operations_executor_v1" ON "private"."approval_operations";
-- policies removed or replaced by this step
-- triggers added by this step
DROP TRIGGER IF EXISTS "immutable_operation" ON "private"."approval_operations";
DROP TRIGGER IF EXISTS "approval_evidence_changed" ON "public"."application_identity_reviews";
DROP TRIGGER IF EXISTS "approval_review_guard" ON "public"."application_identity_reviews";
DROP TRIGGER IF EXISTS "approval_reviews_truncate" ON "public"."application_identity_reviews";
DROP TRIGGER IF EXISTS "approval_serialize" ON "public"."application_identity_reviews";
DROP TRIGGER IF EXISTS "approval_audit" ON "public"."applications";
DROP TRIGGER IF EXISTS "approval_boundary" ON "public"."applications";
DROP TRIGGER IF EXISTS "approval_serialize" ON "public"."applications";
DROP TRIGGER IF EXISTS "approval_audit_guard" ON "public"."audit_log";
DROP TRIGGER IF EXISTS "approval_audit_truncate" ON "public"."audit_log";
DROP TRIGGER IF EXISTS "approval_evidence_changed" ON "public"."documents";
DROP TRIGGER IF EXISTS "approval_serialize" ON "public"."documents";
DROP TRIGGER IF EXISTS "approval_serialize" ON "public"."user_roles";
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
ALTER TABLE "public"."application_identity_reviews" DROP CONSTRAINT IF EXISTS "application_identity_reviews_resolution_check";
ALTER TABLE "public"."application_identity_reviews" ADD CONSTRAINT "application_identity_reviews_resolution_check" CHECK (((resolution IS NULL) OR (resolution = ANY (ARRAY['same_person'::text, 'different_person'::text, 'dismissed'::text]))));
-- indexes removed by this step
-- functions whose bodies changed
-- functions added by this step
DROP FUNCTION IF EXISTS "private"."approval_after"();
DROP FUNCTION IF EXISTS "private"."approval_application_guard"();
DROP FUNCTION IF EXISTS "private"."approval_audit_guard"();
DROP FUNCTION IF EXISTS "private"."approval_evidence_changed"();
DROP FUNCTION IF EXISTS "private"."approval_object_version"(_document uuid);
DROP FUNCTION IF EXISTS "private"."approval_operation_immutable"();
DROP FUNCTION IF EXISTS "private"."approval_result"(_op private.approval_operations, _recovered boolean);
DROP FUNCTION IF EXISTS "private"."approval_review_guard"();
DROP FUNCTION IF EXISTS "private"."approval_serialize"();
DROP FUNCTION IF EXISTS "private"."approval_snapshot"(_id uuid);
DROP FUNCTION IF EXISTS "private"."approval_validate"(_id uuid);
DROP FUNCTION IF EXISTS "private"."approval_write_audit"(_id uuid, _old text);
DROP FUNCTION IF EXISTS "public"."approval_readiness"(_application_id uuid);
DROP FUNCTION IF EXISTS "public"."approve_application_checked"(_application_id uuid, _expected_version bigint, _operation_id uuid, _mode text);
DROP FUNCTION IF EXISTS "public"."preview_approval_identity"(_application_id uuid);
DROP FUNCTION IF EXISTS "public"."recover_application_approval"(_application_id uuid, _operation_id uuid);
DROP FUNCTION IF EXISTS "public"."verify_approval_identity"(_application_id uuid, _reviewed_evidence jsonb, _note text);
-- functions removed by this step
-- columns added by this step
ALTER TABLE "public"."application_identity_reviews" DROP COLUMN IF EXISTS "approval_evidence";
ALTER TABLE "public"."applications" DROP COLUMN IF EXISTS "approval_evidence_version";
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
DROP TABLE IF EXISTS "private"."approval_operations" CASCADE;
-- row level security flags
-- owners
-- privileges captured on the pre-step catalog
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
