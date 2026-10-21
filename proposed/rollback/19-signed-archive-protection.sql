-- Rollback for HOSTED-INSTALL step 23: proposed/m2-packet/19.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
-- policies removed or replaced by this step
-- triggers added by this step
DROP TRIGGER IF EXISTS "finalized_archive_pointer_v1" ON "public"."agreements";
DROP TRIGGER IF EXISTS "finalized_archive_document_v1" ON "public"."documents";
DROP TRIGGER IF EXISTS "completed_archive_storage_truncate_v1" ON "storage"."objects";
DROP TRIGGER IF EXISTS "completed_archive_storage_v1" ON "storage"."objects";
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
-- functions added by this step
DROP FUNCTION IF EXISTS "private"."completed_archive_storage_v1"();
DROP FUNCTION IF EXISTS "private"."finalized_archive_document_v1"();
DROP FUNCTION IF EXISTS "private"."finalized_archive_pointer_v1"();
-- functions removed by this step
-- columns added by this step
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
