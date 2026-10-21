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
-- privileges captured on the pre-step catalog
UPDATE pg_catalog.pg_namespace SET nspacl = $acl${postgres=UC/postgres,service_role=U/postgres,rr_record_executor=C/postgres,rr_evidence_issuer=U/postgres,rr_approval_executor=U/postgres}$acl$::aclitem[] WHERE nspname = 'private';
UPDATE pg_catalog.pg_namespace SET nspacl = $acl${pg_database_owner=UC/pg_database_owner,=U/pg_database_owner,rr_record_executor=C/pg_database_owner,rr_evidence_issuer=U/pg_database_owner,rr_approval_executor=U/pg_database_owner}$acl$::aclitem[] WHERE nspname = 'public';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=ar/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'application_id';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'id';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=ar/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'kind';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=ar/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'positive_evidence_v1';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=ar/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'resolution';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=ar/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'resolved_at';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=ar/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'status';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'deleted_at';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'dob';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${anon=a/postgres,authenticated=w/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'full_name';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres,rr_evidence_issuer=rw/postgres,rr_approval_executor=rw/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'id';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'license_expiration';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'license_number';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'license_state';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'status';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres,rr_evidence_issuer=r/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'user_id';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=a/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'audit_log' AND a.attname = 'action';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'audit_log' AND a.attname = 'actor_role';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=a/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'audit_log' AND a.attname = 'actor_user_id';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=a/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'audit_log' AND a.attname = 'entity_id';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=a/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'audit_log' AND a.attname = 'entity_type';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=a/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'audit_log' AND a.attname = 'metadata';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=a/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'audit_log' AND a.attname = 'summary';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'category';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=rw/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'content_sha256';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'driver_id';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres,rr_approval_executor=rw/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'id';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=rw/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'integrity_v1';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'is_current';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'review_status';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'reviewed_at';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'reviewed_by';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'superseded_by';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'odometer_readings' AND a.attname = 'driver_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'odometer_readings' AND a.attname = 'entered_by';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'odometer_readings' AND a.attname = 'evidence_key';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'odometer_readings' AND a.attname = 'id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'odometer_readings' AND a.attname = 'mileage';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'odometer_readings' AND a.attname = 'observed_at';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'odometer_readings' AND a.attname = 'observed_on';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'odometer_readings' AND a.attname = 'rental_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'odometer_readings' AND a.attname = 'source_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'odometer_readings' AND a.attname = 'source_type';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'odometer_readings' AND a.attname = 'status';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'odometer_readings' AND a.attname = 'vehicle_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'rentals' AND a.attname = 'application_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'rentals' AND a.attname = 'deposit_amount';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'rentals' AND a.attname = 'deposit_held';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'rentals' AND a.attname = 'driver_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'rentals' AND a.attname = 'end_date';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'rentals' AND a.attname = 'id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'rentals' AND a.attname = 'next_payment_due';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'rentals' AND a.attname = 'pickup_reading_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'rentals' AND a.attname = 'return_reading_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'rentals' AND a.attname = 'start_date';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'rentals' AND a.attname = 'status';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'rentals' AND a.attname = 'stripe_customer_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'rentals' AND a.attname = 'stripe_subscription_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'rentals' AND a.attname = 'vehicle_id';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres,rr_approval_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'user_roles' AND a.attname = 'role';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=rw/postgres,rr_approval_executor=rw/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'user_roles' AND a.attname = 'user_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'vehicles' AND a.attname = 'archived_at';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'vehicles' AND a.attname = 'id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'vehicles' AND a.attname = 'status';
UPDATE pg_catalog.pg_proc p SET proacl = $acl${postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres}$acl$::aclitem[] FROM pg_catalog.pg_namespace n WHERE n.oid = p.pronamespace AND n.nspname = 'private' AND p.proname = 'approval_actor' AND pg_get_function_identity_arguments(p.oid) = '';
UPDATE pg_catalog.pg_proc p SET proacl = $acl${postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres}$acl$::aclitem[] FROM pg_catalog.pg_namespace n WHERE n.oid = p.pronamespace AND n.nspname = 'private' AND p.proname = 'approval_lock' AND pg_get_function_identity_arguments(p.oid) = '';
UPDATE pg_catalog.pg_proc p SET proacl = $acl${postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres}$acl$::aclitem[] FROM pg_catalog.pg_namespace n WHERE n.oid = p.pronamespace AND n.nspname = 'private' AND p.proname = 'record_session_v1' AND pg_get_function_identity_arguments(p.oid) = '';
UPDATE pg_catalog.pg_proc p SET proacl = $acl${postgres=X/postgres,service_role=X/postgres}$acl$::aclitem[] FROM pg_catalog.pg_namespace n WHERE n.oid = p.pronamespace AND n.nspname = 'public' AND p.proname = 'activate_rental_tx' AND pg_get_function_identity_arguments(p.oid) = '_application_id uuid, _vehicle_id uuid, _driver_id uuid, _weekly_rate numeric, _deposit numeric, _deposit_held boolean, _start date, _end date, _pickup_miles integer, _actor uuid';
UPDATE pg_catalog.pg_proc p SET proacl = $acl${postgres=X/postgres,service_role=X/postgres}$acl$::aclitem[] FROM pg_catalog.pg_namespace n WHERE n.oid = p.pronamespace AND n.nspname = 'public' AND p.proname = 'end_rental_safe_v1' AND pg_get_function_identity_arguments(p.oid) = '_rental_id uuid, _end date, _vehicle_status text, _return_miles integer, _actor uuid, _release_contract text';
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
