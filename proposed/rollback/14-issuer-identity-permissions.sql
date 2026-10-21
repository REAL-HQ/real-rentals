-- Rollback for M2 rehearsal step 14: issuer-identity-permissions-v5.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
DROP POLICY IF EXISTS "issuer_identity_allow_v5" ON "public"."application_identity_reviews";
DROP POLICY IF EXISTS "issuer_identity_limit_v5" ON "public"."application_identity_reviews";
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
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
-- row level security flags
-- owners
-- privileges captured on the pre-step catalog
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=ar/postgres,rr_record_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'application_id';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=r/postgres,rr_record_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'id';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=ar/postgres,rr_record_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'kind';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=ar/postgres,rr_record_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'positive_evidence_v1';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=ar/postgres,rr_record_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'resolution';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=ar/postgres,rr_record_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'resolved_at';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=ar/postgres,rr_record_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'status';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_approval_executor=r/postgres,rr_record_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'deleted_at';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres,rr_approval_executor=r/postgres,rr_record_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'dob';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${anon=a/postgres,authenticated=w/postgres,rr_approval_executor=r/postgres,rr_record_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'full_name';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres,rr_approval_executor=r/postgres,rr_record_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'license_expiration';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres,rr_approval_executor=r/postgres,rr_record_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'license_number';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres,rr_approval_executor=r/postgres,rr_record_executor=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'license_state';
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
