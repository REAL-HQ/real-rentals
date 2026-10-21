-- Rollback for HOSTED-INSTALL step 16: proposed/m2-packet/12.sql
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
-- functions removed by this step
-- columns added by this step
-- columns removed or altered by this step
ALTER TABLE "public"."rentals" ALTER COLUMN "deposit_amount" SET NOT NULL;
ALTER TABLE "public"."rentals" ALTER COLUMN "deposit_held" SET NOT NULL;
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
-- row level security flags
-- owners
-- privileges captured on the pre-step catalog
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
