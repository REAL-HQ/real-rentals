-- Rollback for HOSTED-INSTALL step 13: proposed/m2-packet/10.sql
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
-- Privileges step 10 granted, removed with REVOKE. Schema private USAGE stays:
-- step 0 already granted it, and a second REVOKE would take that grant too.
-- public USAGE is step 10's. Column and function grants below are step 10's.
REVOKE USAGE ON SCHEMA public FROM rr_approval_executor;
-- license_snapshot_v1, verify_license_v1, and validate_license_v1 were granted
-- by step 6. Step 10 grants them again. Revoking them here would remove the
-- step 6 grant and the pre-step-10 privileges would not match.
REVOKE EXECUTE ON FUNCTION private.approval_actor(), private.approval_lock(), private.record_session_v1() FROM rr_approval_executor;
REVOKE SELECT (id, user_id, deleted_at, full_name, dob, license_number, license_state, license_expiration), UPDATE (id) ON public.applications FROM rr_approval_executor;
REVOKE SELECT (id, driver_id, category, is_current, superseded_by, review_status, reviewed_by, reviewed_at, content_sha256, integrity_v1), UPDATE (id) ON public.documents FROM rr_approval_executor;
REVOKE SELECT (user_id, role), UPDATE (user_id) ON public.user_roles FROM rr_approval_executor;
REVOKE SELECT (id, application_id, kind, status, resolution, positive_evidence_v1, resolved_at) ON public.application_identity_reviews FROM rr_approval_executor;
REVOKE INSERT (application_id, kind, status, resolution, resolved_by, resolved_at, positive_evidence_v1) ON public.application_identity_reviews FROM rr_approval_executor;
REVOKE INSERT (actor_user_id, action, entity_type, entity_id, summary, metadata) ON public.audit_log FROM rr_approval_executor;
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
