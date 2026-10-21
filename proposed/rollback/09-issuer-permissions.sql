-- Rollback for M2 rehearsal step 09: 070-issuer-permissions-v2.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
DROP POLICY IF EXISTS "issuer_scope_allow_v2" ON "public"."agreements";
DROP POLICY IF EXISTS "issuer_scope_limit_v2" ON "public"."agreements";
DROP POLICY IF EXISTS "issuer_scope_allow_v2" ON "public"."applications";
DROP POLICY IF EXISTS "issuer_scope_limit_v2" ON "public"."applications";
DROP POLICY IF EXISTS "issuer_scope_allow_v2" ON "public"."documents";
DROP POLICY IF EXISTS "issuer_scope_limit_v2" ON "public"."documents";
DROP POLICY IF EXISTS "issuer_scope_allow_v2" ON "public"."user_roles";
DROP POLICY IF EXISTS "issuer_scope_limit_v2" ON "public"."user_roles";
-- policies removed or replaced by this step
-- triggers added by this step
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
CREATE OR REPLACE FUNCTION private.bind_document_integrity_v1(d uuid, expected_document jsonb, sha text, immutable_path text, agreement uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE doc public.documents; a public.applications; ag public.agreements; binding jsonb;
BEGIN
 IF current_user<>'rr_evidence_issuer' THEN RAISE EXCEPTION 'trusted_document_issuer_required'; END IF;
 PERFORM private.approval_lock(); PERFORM private.approval_actor(); PERFORM private.record_session_v1();
 PERFORM 1 FROM public.user_roles WHERE user_id=private.approval_actor() AND role IN ('admin','team') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'manager_required'; END IF;
 SELECT * INTO doc FROM public.documents WHERE id=d FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'document_missing'; END IF;
 IF sha IS NULL OR sha !~ '^[0-9a-f]{64}$' OR immutable_path IS DISTINCT FROM ('immutable-v1/'||d::text||'/'||sha||'.pdf') THEN RAISE EXCEPTION 'invalid_content_address'; END IF;
 IF doc.integrity_v1 IS NOT NULL THEN
  IF doc.content_sha256=sha AND doc.storage_path=immutable_path AND (doc.integrity_v1->>'agreement') IS NOT DISTINCT FROM agreement::text THEN RETURN doc.integrity_v1; END IF;
  RAISE EXCEPTION 'document_already_bound';
 END IF;
 IF expected_document IS NULL OR to_jsonb(doc) IS DISTINCT FROM to_jsonb(jsonb_populate_record(NULL::public.documents,expected_document)) THEN RAISE EXCEPTION 'document_changed'; END IF;
 IF doc.content_sha256 IS NOT NULL AND doc.content_sha256 IS DISTINCT FROM sha THEN RAISE EXCEPTION 'document_hash_mismatch'; END IF;
 SELECT * INTO a FROM public.applications WHERE id=doc.driver_id FOR SHARE;
 IF NOT FOUND OR a.user_id IS NULL THEN RAISE EXCEPTION 'linked_driver_required'; END IF;
 binding:=jsonb_build_object('version',sha,'sha256',sha,'application',a.id,'driver',a.user_id,'agreement',agreement,'bucket',doc.storage_bucket,'path',immutable_path);
 IF agreement IS NOT NULL THEN
  SELECT * INTO ag FROM public.agreements WHERE id=agreement FOR SHARE;
  IF NOT FOUND OR ag.status IS DISTINCT FROM 'signed' OR ag.voided_at IS NOT NULL OR ag.signed_at IS NULL
    OR ag.document_id IS DISTINCT FROM d OR ag.completed_document_id IS DISTINCT FROM d OR ag.application_id IS DISTINCT FROM a.id
    OR ag.vehicle_id IS NULL OR ag.sha256 IS DISTINCT FROM sha OR ag.body_sha256 IS NULL
  THEN RAISE EXCEPTION 'signed_agreement_mismatch'; END IF;
  binding:=binding||jsonb_build_object('vehicle',ag.vehicle_id,'signed_at',ag.signed_at,'body_sha256',ag.body_sha256,'body',ag.body,'merge_data',ag.merge_data);
 END IF;
 UPDATE public.documents SET content_sha256=sha,storage_path=immutable_path,integrity_v1=binding WHERE id=d;
 RETURN binding;
END $function$;
-- functions added by this step
DROP FUNCTION IF EXISTS "private"."record_issuer_scope_v2"(app uuid);
-- functions removed by this step
-- columns added by this step
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
-- row level security flags
-- owners
-- privileges captured on the pre-step catalog
UPDATE pg_catalog.pg_namespace SET nspacl = $acl${pg_database_owner=UC/pg_database_owner,=U/pg_database_owner,rr_record_executor=C/pg_database_owner}$acl$::aclitem[] WHERE nspname = 'public';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'agreements' AND a.attname = 'application_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'agreements' AND a.attname = 'body';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'agreements' AND a.attname = 'body_sha256';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'agreements' AND a.attname = 'completed_document_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'agreements' AND a.attname = 'document_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'agreements' AND a.attname = 'id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'agreements' AND a.attname = 'merge_data';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'agreements' AND a.attname = 'sha256';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'agreements' AND a.attname = 'signed_at';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'agreements' AND a.attname = 'status';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'agreements' AND a.attname = 'vehicle_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'agreements' AND a.attname = 'voided_at';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'id';
UPDATE pg_catalog.pg_attribute a SET attacl = $acl${authenticated=w/postgres}$acl$::aclitem[] FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'applications' AND a.attname = 'user_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'category';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'content_sha256';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'driver_id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'id';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'integrity_v1';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'is_current';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'review_status';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'reviewed_at';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'reviewed_by';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'storage_bucket';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'storage_path';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'documents' AND a.attname = 'superseded_by';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'user_roles' AND a.attname = 'role';
UPDATE pg_catalog.pg_attribute a SET attacl = NULL FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE a.attrelid = c.oid AND n.nspname = 'public' AND c.relname = 'user_roles' AND a.attname = 'user_id';
UPDATE pg_catalog.pg_proc p SET proacl = $acl${postgres=X/postgres}$acl$::aclitem[] FROM pg_catalog.pg_namespace n WHERE n.oid = p.pronamespace AND n.nspname = 'private' AND p.proname = 'approval_actor' AND pg_get_function_identity_arguments(p.oid) = '';
UPDATE pg_catalog.pg_proc p SET proacl = $acl${postgres=X/postgres}$acl$::aclitem[] FROM pg_catalog.pg_namespace n WHERE n.oid = p.pronamespace AND n.nspname = 'private' AND p.proname = 'approval_lock' AND pg_get_function_identity_arguments(p.oid) = '';
UPDATE pg_catalog.pg_proc p SET proacl = $acl${postgres=X/postgres}$acl$::aclitem[] FROM pg_catalog.pg_namespace n WHERE n.oid = p.pronamespace AND n.nspname = 'private' AND p.proname = 'record_session_v1' AND pg_get_function_identity_arguments(p.oid) = '';
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
