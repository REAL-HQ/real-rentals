-- Rollback for M2 rehearsal step 04: 020-closeout-legacy-guard.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
-- policies removed or replaced by this step
-- triggers added by this step
DROP TRIGGER IF EXISTS "record_immutable" ON "private"."record_close_operations";
DROP TRIGGER IF EXISTS "record_close_guard_v2" ON "public"."rentals";
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
-- functions added by this step
DROP FUNCTION IF EXISTS "private"."record_close_guard_v2"();
DROP FUNCTION IF EXISTS "public"."close_recorded_rental_v2"(_operation_id uuid, _rental_id uuid, _ended_at timestamp with time zone, _vehicle_status text, _return_miles integer, _reason text);
-- functions removed by this step
-- columns added by this step
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
DROP TABLE IF EXISTS "private"."record_close_context" CASCADE;
DROP TABLE IF EXISTS "private"."record_close_operations" CASCADE;
-- row level security flags
-- owners
-- privileges captured on the pre-step catalog
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
