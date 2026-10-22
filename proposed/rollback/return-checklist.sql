-- Rollback for HOSTED-INSTALL step 28: proposed/m2-packet/return.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
DROP POLICY IF EXISTS "Managers insert return checklist items" ON "public"."return_checklist_items";
DROP POLICY IF EXISTS "Managers read return checklist items" ON "public"."return_checklist_items";
DROP POLICY IF EXISTS "Managers insert return checklist photos" ON "public"."return_checklist_photos";
DROP POLICY IF EXISTS "Managers read return checklist photos" ON "public"."return_checklist_photos";
DROP POLICY IF EXISTS "Managers insert return checklists" ON "public"."return_checklists";
DROP POLICY IF EXISTS "Managers read return checklists" ON "public"."return_checklists";
-- policies removed or replaced by this step
-- triggers added by this step
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
DROP INDEX IF EXISTS "public"."return_checklists_rental_idx";
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
-- functions added by this step
-- functions removed by this step
-- columns added by this step
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
DROP TABLE IF EXISTS "public"."return_checklist_items" CASCADE;
DROP TABLE IF EXISTS "public"."return_checklist_photos" CASCADE;
DROP TABLE IF EXISTS "public"."return_checklists" CASCADE;
-- row level security flags
-- owners
-- privileges captured on the pre-step catalog
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
