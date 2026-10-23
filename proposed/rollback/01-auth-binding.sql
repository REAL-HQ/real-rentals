-- Rollback for M2 rehearsal step 01: 010-auth-binding.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
-- policies removed or replaced by this step
-- triggers added by this step
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
-- functions added by this step
DROP FUNCTION IF EXISTS "private"."approval_actor"();
DROP FUNCTION IF EXISTS "private"."approval_lock"();
DROP FUNCTION IF EXISTS "private"."approval_provider_actor"();
-- functions removed by this step
-- columns added by this step
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
-- row level security flags
-- owners
-- privileges granted to roles this step created
REVOKE ALL ON SCHEMA "auth" FROM "rr_approval_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "auth" FROM "rr_approval_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "auth" FROM "rr_approval_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "auth" FROM "rr_approval_executor";
REVOKE ALL ON SCHEMA "cron" FROM "rr_approval_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "cron" FROM "rr_approval_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "cron" FROM "rr_approval_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "cron" FROM "rr_approval_executor";
REVOKE ALL ON SCHEMA "extensions" FROM "rr_approval_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "extensions" FROM "rr_approval_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "extensions" FROM "rr_approval_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "extensions" FROM "rr_approval_executor";
REVOKE ALL ON SCHEMA "net" FROM "rr_approval_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "net" FROM "rr_approval_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "net" FROM "rr_approval_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "net" FROM "rr_approval_executor";
REVOKE ALL ON SCHEMA "private" FROM "rr_approval_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "private" FROM "rr_approval_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "private" FROM "rr_approval_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "private" FROM "rr_approval_executor";
REVOKE ALL ON SCHEMA "public" FROM "rr_approval_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM "rr_approval_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM "rr_approval_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM "rr_approval_executor";
REVOKE ALL ON SCHEMA "storage" FROM "rr_approval_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "storage" FROM "rr_approval_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "storage" FROM "rr_approval_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "storage" FROM "rr_approval_executor";
REVOKE ALL ON SCHEMA "vault" FROM "rr_approval_executor";
REVOKE ALL ON ALL TABLES IN SCHEMA "vault" FROM "rr_approval_executor";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "vault" FROM "rr_approval_executor";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "vault" FROM "rr_approval_executor";
-- privileges captured on the pre-step catalog
-- comments
-- role memberships added by this step
-- roles added by this step
-- DROP OWNED BY removes the remaining grants. DROP ROLE then succeeds
-- without writing pg_shdepend.
DROP OWNED BY "rr_approval_executor";
DROP ROLE IF EXISTS "rr_approval_executor";
COMMIT;
