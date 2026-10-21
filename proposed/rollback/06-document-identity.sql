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
ALTER TABLE "public"."application_identity_reviews" ADD CONSTRAINT "application_identity_reviews_resolution_check" CHECK (((resolution IS NULL) OR (resolution = ANY (ARRAY['same_person'::text, 'different_person'::text, 'dismissed'::text]))));
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
