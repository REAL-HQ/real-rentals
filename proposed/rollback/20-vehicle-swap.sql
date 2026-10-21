-- Rollback for M2 rehearsal step 20: proposed/m2-packet/20.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
-- policies removed or replaced by this step
-- triggers added by this step
DROP TRIGGER IF EXISTS "swap_operations_immutable" ON "private"."swap_operations";
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
-- constraints added by this step, skipping tables this step created
ALTER TABLE "public"."booking_vehicle_assignments" DROP CONSTRAINT IF EXISTS "booking_vehicle_assignments_swap_operation_id_fkey";
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
-- functions added by this step
DROP FUNCTION IF EXISTS "private"."swap_agreement_evidence"(_agreement uuid, _application uuid, _vehicle uuid, _effective timestamp with time zone);
DROP FUNCTION IF EXISTS "private"."swap_project_vehicle_v1"(_operation uuid, _rental uuid, _old_vehicle uuid, _new_vehicle uuid, _effective timestamp with time zone, _return_miles integer, _pickup_miles integer, _actor uuid, _driver uuid, _swap_number bigint, _reason text);
DROP FUNCTION IF EXISTS "public"."list_assignment_history_v1"(_rental uuid, _vehicle uuid);
DROP FUNCTION IF EXISTS "public"."swap_rental_vehicle_tx"(_operation_id uuid, _rental_id uuid, _expected_assignment_id uuid, _replacement_vehicle_id uuid, _effective_at timestamp with time zone, _return_mileage integer, _pickup_mileage integer, _reason text, _agreement_evidence_id uuid);
-- functions removed by this step
-- columns added by this step
ALTER TABLE "public"."booking_vehicle_assignments" DROP COLUMN IF EXISTS "swap_operation_id";
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
DROP TABLE IF EXISTS "private"."swap_operations" CASCADE;
DROP SEQUENCE IF EXISTS "private"."swap_number_seq" CASCADE;
-- row level security flags
-- owners
-- privileges captured on the pre-step catalog
REVOKE UPDATE (id) ON TABLE public.application_identity_reviews FROM rr_record_executor;
REVOKE EXECUTE ON FUNCTION public.vehicle_rental_ready_missing(uuid) FROM rr_record_executor;
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
