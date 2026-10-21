-- Rollback for M2 rehearsal step 18: subscription-coordination-v1.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
-- policies removed or replaced by this step
-- triggers added by this step
DROP TRIGGER IF EXISTS "subscription_guard_v1" ON "public"."rentals";
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
DROP INDEX IF EXISTS "private"."rental_subscription_pending_v1";
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
-- functions added by this step
DROP FUNCTION IF EXISTS "private"."subscription_actor_v1"(actor uuid, sess uuid);
DROP FUNCTION IF EXISTS "private"."subscription_guard_v1"();
DROP FUNCTION IF EXISTS "public"."rental_subscription_begin_v1"(rental uuid, actor uuid, sess uuid, action text, account text, environment text);
DROP FUNCTION IF EXISTS "public"."rental_subscription_finish_v1"(operation uuid, actor uuid, sess uuid, account text, environment text, subscription text);
-- functions removed by this step
-- columns added by this step
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
DROP TABLE IF EXISTS "private"."rental_subscription_operations_v1" CASCADE;
-- row level security flags
-- owners
-- privileges captured on the pre-step catalog
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
