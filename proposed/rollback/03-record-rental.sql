-- Rollback for M2 rehearsal step 03: 010-record-rental-v3.sql (installer-ownership)
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
-- policies removed or replaced by this step
-- triggers added by this step
DROP TRIGGER IF EXISTS "assignment_close_interval" ON "private"."assignment_closures";
DROP TRIGGER IF EXISTS "record_immutable" ON "private"."assignment_closures";
DROP TRIGGER IF EXISTS "record_immutable" ON "private"."record_customers";
DROP TRIGGER IF EXISTS "record_immutable" ON "private"."record_operations";
DROP TRIGGER IF EXISTS "record_immutable" ON "private"."record_subscription_links";
DROP TRIGGER IF EXISTS "record_audit_immutable" ON "public"."audit_log";
DROP TRIGGER IF EXISTS "record_audit_no_truncate" ON "public"."audit_log";
DROP TRIGGER IF EXISTS "assignment_interval" ON "public"."booking_vehicle_assignments";
DROP TRIGGER IF EXISTS "record_immutable" ON "public"."booking_vehicle_assignments";
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
DROP INDEX IF EXISTS "public"."record_one_original";
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
-- functions added by this step
DROP FUNCTION IF EXISTS "private"."record_agreement_evidence"(uuid, uuid, timestamp with time zone, numeric);
DROP FUNCTION IF EXISTS "private"."record_assignment_interval_guard"();
DROP FUNCTION IF EXISTS "private"."record_audit_guard"();
DROP FUNCTION IF EXISTS "private"."record_immutable"();
DROP FUNCTION IF EXISTS "private"."record_subscription_evidence"(uuid, uuid, numeric);
DROP FUNCTION IF EXISTS "public"."record_existing_rental_tx"(_operation_id uuid, _application_id uuid, _vehicle_id uuid, _started_at timestamp with time zone, _weekly_rate numeric, _deposit numeric, _pickup_miles integer, _subscription_evidence_id uuid, _reason text);
-- functions removed by this step
-- columns added by this step
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
REVOKE ALL ("rental_id") ON TABLE "public"."booking_vehicle_assignments" FROM "rr_record_executor";
-- relations added by this step
DROP VIEW IF EXISTS "private"."record_assignment_history" CASCADE;
DROP TABLE IF EXISTS "private"."assignment_closures" CASCADE;
DROP TABLE IF EXISTS "private"."record_customers" CASCADE;
DROP TABLE IF EXISTS "private"."record_operations" CASCADE;
DROP TABLE IF EXISTS "private"."record_subscription_links" CASCADE;
DROP TABLE IF EXISTS "public"."booking_vehicle_assignments" CASCADE;
DROP SEQUENCE IF EXISTS "private"."record_booking_number_seq" CASCADE;
DROP SEQUENCE IF EXISTS "private"."record_customer_number_seq" CASCADE;
-- row level security flags
-- owners
-- privileges granted to roles this step created
REVOKE ALL ON SCHEMA "auth" FROM "rr_record_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "auth" FROM "rr_record_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "auth" FROM "rr_record_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "auth" FROM "rr_record_executor";
REVOKE ALL ON SCHEMA "cron" FROM "rr_record_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "cron" FROM "rr_record_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "cron" FROM "rr_record_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "cron" FROM "rr_record_executor";
REVOKE ALL ON SCHEMA "extensions" FROM "rr_record_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "extensions" FROM "rr_record_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "extensions" FROM "rr_record_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "extensions" FROM "rr_record_executor";
REVOKE ALL ON SCHEMA "net" FROM "rr_record_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "net" FROM "rr_record_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "net" FROM "rr_record_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "net" FROM "rr_record_executor";
REVOKE ALL ON SCHEMA "private" FROM "rr_record_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "private" FROM "rr_record_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "private" FROM "rr_record_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "private" FROM "rr_record_executor";
REVOKE ALL ON SCHEMA "public" FROM "rr_record_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM "rr_record_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM "rr_record_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM "rr_record_executor";
REVOKE ALL ON SCHEMA "storage" FROM "rr_record_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "storage" FROM "rr_record_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "storage" FROM "rr_record_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "storage" FROM "rr_record_executor";
REVOKE ALL ON SCHEMA "vault" FROM "rr_record_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "vault" FROM "rr_record_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "vault" FROM "rr_record_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "vault" FROM "rr_record_executor";
-- Step 3's schema grant is CREATE on private and public. REVOKE ALL above
-- removes that grant and leaves step 0's USAGE for rr_approval_executor.
-- DROP OWNED BY removes any remaining grants, so DROP ROLE does not write
-- pg_shdepend.
-- comments
-- role memberships added by this step
REVOKE "rr_record_executor" FROM "postgres";
-- roles added by this step
DROP OWNED BY "rr_record_executor";
DROP ROLE IF EXISTS "rr_record_executor";
COMMIT;
