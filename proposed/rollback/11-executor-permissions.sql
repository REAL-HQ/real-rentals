-- Rollback for M2 rehearsal step 11: 090-executor-permissions-v3.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
DROP POLICY IF EXISTS "record_scope_permissive_v3" ON "public"."application_identity_reviews";
DROP POLICY IF EXISTS "record_scope_restrictive_v3" ON "public"."application_identity_reviews";
DROP POLICY IF EXISTS "record_scope_permissive_v3" ON "public"."applications";
DROP POLICY IF EXISTS "record_scope_restrictive_v3" ON "public"."applications";
DROP POLICY IF EXISTS "record_scope_permissive_v3" ON "public"."audit_log";
DROP POLICY IF EXISTS "record_scope_restrictive_v3" ON "public"."audit_log";
DROP POLICY IF EXISTS "record_scope_permissive_v3" ON "public"."documents";
DROP POLICY IF EXISTS "record_scope_restrictive_v3" ON "public"."documents";
DROP POLICY IF EXISTS "record_scope_permissive_v3" ON "public"."odometer_readings";
DROP POLICY IF EXISTS "record_scope_restrictive_v3" ON "public"."odometer_readings";
DROP POLICY IF EXISTS "record_read_permissive_v3" ON "public"."rentals";
DROP POLICY IF EXISTS "record_read_restrictive_v3" ON "public"."rentals";
DROP POLICY IF EXISTS "record_write_permissive_v3" ON "public"."rentals";
DROP POLICY IF EXISTS "record_write_restrictive_v3" ON "public"."rentals";
DROP POLICY IF EXISTS "record_scope_permissive_v3" ON "public"."user_roles";
DROP POLICY IF EXISTS "record_scope_restrictive_v3" ON "public"."user_roles";
DROP POLICY IF EXISTS "record_scope_permissive_v3" ON "public"."vehicles";
DROP POLICY IF EXISTS "record_scope_restrictive_v3" ON "public"."vehicles";
-- policies removed or replaced by this step
-- triggers added by this step
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
-- functions added by this step
DROP FUNCTION IF EXISTS "private"."record_executor_scope_v3"(app uuid);
-- functions removed by this step
-- columns added by this step
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
-- row level security flags
-- owners
-- Privileges step 11 granted to rr_record_executor, removed with REVOKE.
-- USAGE only: step 3 already granted CREATE on private and public, and a
-- REVOKE ALL would take that grant. Other roles' column and function grants
-- (steps 0, 6, 9, 10, and 10b, including rr_approval_executor UPDATE on
-- applications.status) stay because these revokes name rr_record_executor.
REVOKE USAGE ON SCHEMA private, public FROM rr_record_executor;
-- Step 7 already granted license_snapshot_v1 and validate_license_v1 to
-- rr_record_executor. Step 11 grants them again. Revoking them would remove
-- the step 7 grant.
REVOKE EXECUTE ON FUNCTION private.approval_actor(), private.approval_lock(), private.record_session_v1() FROM rr_record_executor;
REVOKE EXECUTE ON FUNCTION public.end_rental_safe_v1(uuid, date, text, integer, uuid, text) FROM rr_record_executor;
REVOKE EXECUTE ON FUNCTION public.activate_rental_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid) FROM rr_record_executor;
REVOKE SELECT (id, user_id, status, deleted_at, full_name, dob, license_number, license_state, license_expiration), UPDATE (id) ON TABLE public.applications FROM rr_record_executor;
REVOKE SELECT (id, status, archived_at), UPDATE (id) ON TABLE public.vehicles FROM rr_record_executor;
REVOKE SELECT (user_id, role), UPDATE (user_id) ON TABLE public.user_roles FROM rr_record_executor;
REVOKE SELECT (id, application_id, driver_id, vehicle_id, status, start_date, end_date, pickup_reading_id), UPDATE (id, deposit_amount, deposit_held, next_payment_due, stripe_customer_id, stripe_subscription_id, pickup_reading_id, return_reading_id) ON TABLE public.rentals FROM rr_record_executor;
REVOKE SELECT (id, vehicle_id, status, observed_on, mileage), INSERT (vehicle_id, mileage, observed_on, observed_at, source_type, source_id, evidence_key, entered_by, rental_id, driver_id) ON TABLE public.odometer_readings FROM rr_record_executor;
REVOKE INSERT (actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata) ON TABLE public.audit_log FROM rr_record_executor;
REVOKE SELECT (id, driver_id, category, is_current, superseded_by, review_status, reviewed_by, reviewed_at, content_sha256, integrity_v1), UPDATE (id) ON TABLE public.documents FROM rr_record_executor;
REVOKE SELECT (id, application_id, kind, status, resolution, positive_evidence_v1, resolved_at) ON TABLE public.application_identity_reviews FROM rr_record_executor;
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
