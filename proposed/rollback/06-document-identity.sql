-- Rollback for M2 rehearsal step 06: 040-document-identity-v2.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
DROP POLICY IF EXISTS "positive_review_privacy_v1" ON "public"."application_identity_reviews";
-- policies removed or replaced by this step
-- triggers added by this step
DROP TRIGGER IF EXISTS "integrity_serialize_v1" ON "public"."agreements";
DROP TRIGGER IF EXISTS "signed_binding_truncate_v1" ON "public"."agreements";
DROP TRIGGER IF EXISTS "signed_binding_v1" ON "public"."agreements";
DROP TRIGGER IF EXISTS "integrity_serialize_v1" ON "public"."application_identity_reviews";
DROP TRIGGER IF EXISTS "positive_review_truncate_v1" ON "public"."application_identity_reviews";
DROP TRIGGER IF EXISTS "positive_review_v1" ON "public"."application_identity_reviews";
DROP TRIGGER IF EXISTS "integrity_serialize_v1" ON "public"."applications";
DROP TRIGGER IF EXISTS "positive_audit_truncate_v1" ON "public"."audit_log";
DROP TRIGGER IF EXISTS "positive_audit_v1" ON "public"."audit_log";
DROP TRIGGER IF EXISTS "document_integrity_truncate_v1" ON "public"."documents";
DROP TRIGGER IF EXISTS "document_integrity_v1" ON "public"."documents";
DROP TRIGGER IF EXISTS "integrity_serialize_v1" ON "public"."documents";
DROP TRIGGER IF EXISTS "integrity_serialize_v1" ON "public"."user_roles";
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
ALTER TABLE "public"."application_identity_reviews" DROP CONSTRAINT IF EXISTS "application_identity_reviews_resolution_check";
-- Step 0 already replaced the original resolution list. Step 6 replaces
-- that check, so rolling step 6 back restores the step 0 check.
ALTER TABLE "public"."application_identity_reviews" ADD CONSTRAINT "application_identity_reviews_resolution_check" CHECK (((((kind = 'approval_identity'::text) AND (status = 'resolved'::text) AND (resolution = 'verified'::text) AND (resolved_by IS NOT NULL) AND (resolved_at IS NOT NULL) AND (approval_evidence IS NOT NULL) AND (jsonb_typeof(approval_evidence) = 'object'::text) AND (approval_evidence ?& ARRAY['application'::text, 'version'::text, 'identity'::text, 'front'::text, 'back'::text]) AND (jsonb_typeof((approval_evidence -> 'identity'::text)) = 'object'::text) AND (jsonb_typeof((approval_evidence -> 'front'::text)) = 'object'::text) AND (jsonb_typeof((approval_evidence -> 'back'::text)) = 'object'::text) AND ((approval_evidence ->> 'application'::text) = (application_id)::text) AND ((approval_evidence ->> 'version'::text) ~ '^[0-9]+$'::text) AND (((approval_evidence -> 'identity'::text) ->> 'license_number'::text) IS NOT NULL) AND (((approval_evidence -> 'identity'::text) ->> 'license_expiration'::text) IS NOT NULL) AND ((approval_evidence -> 'front'::text) ?& ARRAY['id'::text, 'bucket'::text, 'path'::text, 'sha256'::text, 'reviewer'::text, 'reviewed_at'::text, 'object_version'::text]) AND ((approval_evidence -> 'back'::text) ?& ARRAY['id'::text, 'bucket'::text, 'path'::text, 'sha256'::text, 'reviewer'::text, 'reviewed_at'::text, 'object_version'::text]) AND (((approval_evidence -> 'front'::text) ->> 'sha256'::text) ~ '^[0-9a-f]{64}$'::text) AND (((approval_evidence -> 'back'::text) ->> 'sha256'::text) ~ '^[0-9a-f]{64}$'::text) AND (((approval_evidence -> 'front'::text) ->> 'id'::text) IS NOT NULL) AND (((approval_evidence -> 'back'::text) ->> 'id'::text) IS NOT NULL) AND (((approval_evidence -> 'front'::text) ->> 'reviewer'::text) IS NOT NULL) AND (((approval_evidence -> 'back'::text) ->> 'reviewer'::text) IS NOT NULL) AND (((approval_evidence -> 'front'::text) ->> 'reviewed_at'::text) IS NOT NULL) AND (((approval_evidence -> 'back'::text) ->> 'reviewed_at'::text) IS NOT NULL) AND (jsonb_typeof((approval_evidence -> 'version'::text)) = 'number'::text) AND (NULLIF(btrim(((approval_evidence -> 'identity'::text) ->> 'license_number'::text)), ''::text) IS NOT NULL) AND (NULLIF(((approval_evidence -> 'front'::text) ->> 'id'::text), ''::text) IS NOT NULL) AND (NULLIF(((approval_evidence -> 'front'::text) ->> 'bucket'::text), ''::text) IS NOT NULL) AND (NULLIF(((approval_evidence -> 'front'::text) ->> 'path'::text), ''::text) IS NOT NULL) AND (NULLIF(((approval_evidence -> 'front'::text) ->> 'reviewer'::text), ''::text) IS NOT NULL) AND (NULLIF(((approval_evidence -> 'front'::text) ->> 'reviewed_at'::text), ''::text) IS NOT NULL) AND ((((approval_evidence -> 'front'::text) -> 'object_version'::text) ->> 'bucket'::text) = ((approval_evidence -> 'front'::text) ->> 'bucket'::text)) AND ((((approval_evidence -> 'front'::text) -> 'object_version'::text) ->> 'path'::text) = ((approval_evidence -> 'front'::text) ->> 'path'::text)) AND ((((approval_evidence -> 'front'::text) -> 'object_version'::text) ->> 'sha256'::text) = ((approval_evidence -> 'front'::text) ->> 'sha256'::text)) AND (NULLIF((((approval_evidence -> 'front'::text) -> 'object_version'::text) ->> 'version'::text), ''::text) IS NOT NULL) AND (NULLIF(((approval_evidence -> 'back'::text) ->> 'id'::text), ''::text) IS NOT NULL) AND (NULLIF(((approval_evidence -> 'back'::text) ->> 'bucket'::text), ''::text) IS NOT NULL) AND (NULLIF(((approval_evidence -> 'back'::text) ->> 'path'::text), ''::text) IS NOT NULL) AND (NULLIF(((approval_evidence -> 'back'::text) ->> 'reviewer'::text), ''::text) IS NOT NULL) AND (NULLIF(((approval_evidence -> 'back'::text) ->> 'reviewed_at'::text), ''::text) IS NOT NULL) AND ((((approval_evidence -> 'back'::text) -> 'object_version'::text) ->> 'bucket'::text) = ((approval_evidence -> 'back'::text) ->> 'bucket'::text)) AND ((((approval_evidence -> 'back'::text) -> 'object_version'::text) ->> 'path'::text) = ((approval_evidence -> 'back'::text) ->> 'path'::text)) AND ((((approval_evidence -> 'back'::text) -> 'object_version'::text) ->> 'sha256'::text) = ((approval_evidence -> 'back'::text) ->> 'sha256'::text)) AND (NULLIF((((approval_evidence -> 'back'::text) -> 'object_version'::text) ->> 'version'::text), ''::text) IS NOT NULL)) OR ((kind <> 'approval_identity'::text) AND (approval_evidence IS NULL) AND ((resolution IS NULL) OR (resolution = ANY (ARRAY['same_person'::text, 'different_person'::text, 'dismissed'::text]))))) IS TRUE));
-- indexes removed by this step
-- functions whose bodies changed
-- functions added by this step
DROP FUNCTION IF EXISTS "private"."bind_document_integrity_v1"(d uuid, expected_document jsonb, sha text, immutable_path text, agreement uuid);
DROP FUNCTION IF EXISTS "private"."document_integrity_guard_v1"();
DROP FUNCTION IF EXISTS "private"."integrity_serialize_v1"();
DROP FUNCTION IF EXISTS "private"."license_snapshot_v1"(app uuid);
DROP FUNCTION IF EXISTS "private"."positive_audit_guard_v1"();
DROP FUNCTION IF EXISTS "private"."positive_review_guard_v1"();
DROP FUNCTION IF EXISTS "private"."signed_binding_guard_v1"();
DROP FUNCTION IF EXISTS "private"."validate_license_v1"(app uuid);
DROP FUNCTION IF EXISTS "private"."verify_license_v1"(app uuid, expected jsonb);
-- functions removed by this step
-- columns added by this step
ALTER TABLE "public"."application_identity_reviews" DROP COLUMN IF EXISTS "positive_evidence_v1";
ALTER TABLE "public"."documents" DROP COLUMN IF EXISTS "integrity_v1";
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
-- row level security flags
-- owners
-- privileges captured on the pre-step catalog
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
