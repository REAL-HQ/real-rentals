-- Rollback for HOSTED-INSTALL step 27: proposed/m2-packet/extend.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
--
-- Dropping public.extend_rental_tx removes the service_role EXECUTE grant.
-- authenticated, anon, and PUBLIC are not granted. The signature includes
-- the actor id argument from proposed/extend-rental-v1.sql.
BEGIN;
-- policies added by this step
-- policies removed or replaced by this step
-- triggers added by this step
DROP TRIGGER IF EXISTS "extend_operations_immutable" ON "private"."extend_operations";
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
-- functions added by this step
DROP FUNCTION IF EXISTS "public"."extend_rental_tx"(_operation_id uuid, _rental_id uuid, _expected_end date, _new_end date, _reason text, _actor_id uuid);
-- functions removed by this step
-- columns added by this step
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
DROP TABLE IF EXISTS "private"."extend_operations" CASCADE;
-- row level security flags
-- owners
-- privileges captured on the pre-step catalog
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
