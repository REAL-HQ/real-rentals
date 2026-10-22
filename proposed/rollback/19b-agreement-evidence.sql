-- Rollback for HOSTED-INSTALL step 24: proposed/m2-packet/19b.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
--
-- Dropping public.link_replacement_agreement_v1 removes its
-- rr_record_executor EXECUTE grant. Dropping
-- public.link_replacement_agreement_checked removes its authenticated
-- EXECUTE grant. This rollback does not grant either function.
BEGIN;
-- policies added by this step
-- policies removed or replaced by this step
-- triggers added by this step
DROP TRIGGER IF EXISTS "agreement_evidence_immutable" ON "private"."agreement_evidence";
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
CREATE OR REPLACE FUNCTION private.record_agreement_evidence(uuid, uuid, timestamp with time zone, numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ BEGIN RAISE EXCEPTION 'agreement_contract_unverified' USING ERRCODE='42501'; END $function$;
-- functions added by this step
DROP FUNCTION IF EXISTS "private"."record_agreement_evidence"(_rental_id uuid, _agreement_id uuid);
DROP FUNCTION IF EXISTS "public"."link_replacement_agreement_checked"(_rental_id uuid, _agreement_id uuid);
DROP FUNCTION IF EXISTS "public"."link_replacement_agreement_v1"(_rental_id uuid, _agreement_id uuid);
-- functions removed by this step
-- columns added by this step
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
DROP TABLE IF EXISTS "private"."agreement_evidence" CASCADE;
-- row level security flags
-- owners
-- privileges captured on the pre-step catalog
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
