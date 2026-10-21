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
-- privileges captured on the pre-step catalog
-- Step 0 grants USAGE to rr_approval_executor before step 5. Keep that grant.
UPDATE pg_catalog.pg_namespace SET nspacl = $acl${postgres=UC/postgres,service_role=U/postgres,rr_approval_executor=U/postgres,rr_record_executor=C/postgres}$acl$::aclitem[] WHERE nspname = 'private';
-- comments
-- role memberships added by this step
-- roles added by this step
DELETE FROM pg_catalog.pg_shdepend WHERE refclassid = 'pg_authid'::regclass AND refobjid = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'rr_evidence_issuer') AND deptype = 'a';
DROP OWNED BY "rr_evidence_issuer";
DROP ROLE IF EXISTS "rr_evidence_issuer";
COMMIT;
