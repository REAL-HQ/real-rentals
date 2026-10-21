-- Rollback for M2 rehearsal step 10: 080-approval-permissions-v3.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
DROP POLICY IF EXISTS "approval_scope_permissive_v3" ON "public"."application_identity_reviews";
DROP POLICY IF EXISTS "approval_scope_restrictive_v3" ON "public"."application_identity_reviews";
DROP POLICY IF EXISTS "approval_scope_permissive_v3" ON "public"."applications";
DROP POLICY IF EXISTS "approval_scope_restrictive_v3" ON "public"."applications";
DROP POLICY IF EXISTS "approval_scope_permissive_v3" ON "public"."audit_log";
DROP POLICY IF EXISTS "approval_scope_restrictive_v3" ON "public"."audit_log";
DROP POLICY IF EXISTS "approval_scope_permissive_v3" ON "public"."documents";
DROP POLICY IF EXISTS "approval_scope_restrictive_v3" ON "public"."documents";
DROP POLICY IF EXISTS "approval_scope_permissive_v3" ON "public"."user_roles";
DROP POLICY IF EXISTS "approval_scope_restrictive_v3" ON "public"."user_roles";
-- policies removed or replaced by this step
-- triggers added by this step
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
CREATE OR REPLACE FUNCTION private.license_snapshot_v1(app uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE a public.applications; docs jsonb; n integer;
BEGIN
 SELECT * INTO a FROM public.applications WHERE id=app FOR UPDATE;
 IF NOT FOUND OR a.user_id IS NULL OR a.deleted_at IS NOT NULL OR nullif(btrim(a.license_number),'') IS NULL OR nullif(btrim(a.license_state),'') IS NULL
 OR a.license_expiration IS NULL OR NOT isfinite(a.license_expiration) OR a.license_expiration<(clock_timestamp() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'license_invalid'; END IF;
 IF EXISTS(SELECT 1 FROM public.application_identity_reviews WHERE application_id=app AND kind<>'positive_license_v1' AND (status='open' OR resolution='different_person')) THEN RAISE EXCEPTION 'identity_conflict'; END IF;
 PERFORM 1 FROM public.documents WHERE driver_id=app AND category IN ('license_front','license_back') ORDER BY id FOR SHARE;
 SELECT count(*), jsonb_agg(jsonb_build_object('id',id,'category',category,'hash',content_sha256,'binding',integrity_v1,'reviewer',reviewed_by,'reviewed_at',reviewed_at) ORDER BY category,id) INTO n,docs
 FROM public.documents WHERE driver_id=app AND category IN ('license_front','license_back') AND is_current IS TRUE AND superseded_by IS NULL
 AND review_status='verified' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND integrity_v1 IS NOT NULL
 AND integrity_v1->>'sha256'=content_sha256 AND integrity_v1->>'application'=app::text AND integrity_v1->>'driver'=a.user_id::text;
 IF n<>2 OR (SELECT count(*) FROM public.documents WHERE driver_id=app AND category='license_front' AND is_current IS TRUE)<>1
 OR (SELECT count(*) FROM public.documents WHERE driver_id=app AND category='license_back' AND is_current IS TRUE)<>1 THEN RAISE EXCEPTION 'current_verified_documents_required'; END IF;
 RETURN jsonb_build_object('application',app,'driver',a.user_id,'name',a.full_name,'dob',a.dob,'license_number',a.license_number,'license_state',a.license_state,'license_expiration',a.license_expiration,'documents',docs);
END $function$;
-- functions added by this step
DROP FUNCTION IF EXISTS "private"."record_approval_scope_v3"(app uuid);
-- functions removed by this step
-- columns added by this step
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
-- row level security flags
-- owners
-- privileges captured on the pre-step catalog
UPDATE pg_catalog.pg_namespace SET nspacl = $acl${postgres=UC/postgres,service_role=U/postgres,rr_record_executor=C/postgres,rr_evidence_issuer=U/postgres}$acl$::aclitem[] WHERE nspname = 'private';
UPDATE pg_catalog.pg_namespace SET nspacl = $acl${pg_database_owner=UC/pg_database_owner,=U/pg_database_owner,rr_record_executor=C/pg_database_owner,rr_evidence_issuer=U/pg_database_owner}$acl$::aclitem[] WHERE nspname = 'public';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'application_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'kind';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'positive_evidence_v1';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'resolution';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'resolved_at';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'resolved_by';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND a.attname = 'status';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'deleted_at';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'dob';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${anon=a/postgres,authenticated=w/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'full_name';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres,rr_evidence_issuer=rw/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'id';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'license_expiration';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'license_number';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'license_state';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres,rr_evidence_issuer=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'user_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'audit_log' AND a.attname = 'action';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'audit_log' AND a.attname = 'actor_user_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'audit_log' AND a.attname = 'entity_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'audit_log' AND a.attname = 'entity_type';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'audit_log' AND a.attname = 'metadata';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'audit_log' AND a.attname = 'summary';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'category';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=rw/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'content_sha256';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'driver_id';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'id';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=rw/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'integrity_v1';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'is_current';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'review_status';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'reviewed_at';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'reviewed_by';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'superseded_by';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=r/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'user_roles' AND a.attname = 'role';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${rr_evidence_issuer=rw/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'user_roles' AND a.attname = 'user_id';
UPDATE pg_catalog.pg_proc p SET proacl = $acl${postgres=X/postgres,rr_evidence_issuer=X/postgres}$acl$::aclitem[] FROM pg_catalog.pg_namespace n WHERE n.oid = p.pronamespace AND n.nspname = 'private' AND p.proname = 'approval_actor' AND pg_get_function_identity_arguments(p.oid) = '';
UPDATE pg_catalog.pg_proc p SET proacl = $acl${postgres=X/postgres,rr_evidence_issuer=X/postgres}$acl$::aclitem[] FROM pg_catalog.pg_namespace n WHERE n.oid = p.pronamespace AND n.nspname = 'private' AND p.proname = 'approval_lock' AND pg_get_function_identity_arguments(p.oid) = '';
UPDATE pg_catalog.pg_proc p SET proacl = $acl${postgres=X/postgres,rr_evidence_issuer=X/postgres}$acl$::aclitem[] FROM pg_catalog.pg_namespace n WHERE n.oid = p.pronamespace AND n.nspname = 'private' AND p.proname = 'record_session_v1' AND pg_get_function_identity_arguments(p.oid) = '';
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
