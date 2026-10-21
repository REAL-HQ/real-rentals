-- Read-only M2 install preflight. SELECT against pg_catalog, information_schema,
-- and storage.buckets. No writes. One row per prerequisite and per object the
-- install creates.
--
-- expected/actual are present or absent. ok is true when they match.
-- Prerequisites already on a migrations baseline are expected present:
-- the identity-review table, applications.deleted_at, waitlist holds,
-- who holds CREATE on schema public (HOSTED-INSTALL step 5,
-- proposed/m2-packet/03.sql, grants it to rr_record_executor
-- because ownership of public.booking_vehicle_assignments and
-- public.record_existing_rental_tx requires it),
-- storage.objects, storage.objects.name, storage.objects.user_metadata jsonb,
-- storage.objects.version text, the condition-media bucket, one storage.objects
-- row per bucket and path, and a postgres role that is superuser or BYPASSRLS.
-- The definer reads storage.objects. Object versioning must be off. A second
-- row for the same path means versioning is on, or a duplicate was left behind.
-- private.approval_validate(uuid) and private.approval_snapshot(uuid) are
-- created by HOSTED-INSTALL step 3
-- (proposed/m2-with-approval-boundary/00-approval-boundary.sql). They are
-- expected absent, with every object the packet creates. HOSTED-INSTALL step 21
-- (proposed/m2-packet/17.sql) does not create a bucket.

SELECT 'public.application_identity_reviews' AS check_name, 'present' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('present' = 'present')) AS ok
UNION ALL
SELECT 'public.applications.deleted_at' AS check_name, 'present' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'applications' AND column_name = 'deleted_at'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'applications' AND column_name = 'deleted_at'
    )) = ('present' = 'present')) AS ok
UNION ALL
SELECT 'public.application_waitlist_holds' AS check_name, 'present' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_waitlist_holds' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_waitlist_holds' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('present' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_validate(uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.approval_validate(uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.approval_validate(uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_snapshot(uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.approval_snapshot(uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.approval_snapshot(uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'storage.objects' AS check_name, 'present' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'storage' AND c.relname = 'objects' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'storage' AND c.relname = 'objects' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('present' = 'present')) AS ok
UNION ALL
SELECT 'storage.objects.name' AS check_name, 'present' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'name'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'name'
    )) = ('present' = 'present')) AS ok
UNION ALL
SELECT 'storage.objects.user_metadata jsonb' AS check_name, 'present' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'user_metadata' AND udt_name = 'jsonb'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'user_metadata' AND udt_name = 'jsonb'
    )) = ('present' = 'present')) AS ok
UNION ALL
SELECT 'storage.objects.version text' AS check_name, 'present' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'version' AND udt_name = 'text'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'version' AND udt_name = 'text'
    )) = ('present' = 'present')) AS ok
UNION ALL
SELECT 'postgres bypassrls or superuser' AS check_name, 'present' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'postgres' AND (rolsuper OR rolbypassrls)
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'postgres' AND (rolsuper OR rolbypassrls)
    )) = ('present' = 'present')) AS ok
UNION ALL
SELECT 'public CREATE holders' AS check_name, 'anon and authenticated absent' AS expected, (
      SELECT coalesce(string_agg(r.rolname, ',' ORDER BY r.rolname), '')
      FROM pg_catalog.pg_namespace n
      JOIN LATERAL pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n'::"char", n.nspowner))) a ON true
      JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
      WHERE n.nspname = 'public' AND a.privilege_type = 'CREATE'
    ) AS actual, NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_namespace n
      JOIN LATERAL pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n'::"char", n.nspowner))) a ON true
      JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
      WHERE n.nspname = 'public' AND a.privilege_type = 'CREATE' AND r.rolname IN ('anon','authenticated')
    ) AS ok
UNION ALL
SELECT 'storage.buckets condition-media' AS check_name, 'present' AS expected, CASE WHEN (EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'condition-media')) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'condition-media')) = ('present' = 'present')) AS ok
UNION ALL
SELECT 'role rr_approval_executor' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'rr_approval_executor')) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'rr_approval_executor')) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'role rr_record_executor' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'rr_record_executor')) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'rr_record_executor')) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'role rr_evidence_issuer' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'rr_evidence_issuer')) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'rr_evidence_issuer')) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'storage.objects one row per path' AS check_name, 'holds' AS expected, CASE WHEN (EXISTS (SELECT 1 FROM storage.objects GROUP BY bucket_id, name HAVING count(*) > 1)) THEN 'duplicated' ELSE 'holds' END AS actual, (NOT EXISTS (SELECT 1 FROM storage.objects GROUP BY bucket_id, name HAVING count(*) > 1)) AS ok
UNION ALL
SELECT 'public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.uploaded_content_sha' AS check_name, 'absent' AS expected, CASE WHEN (to_regclass('private.uploaded_content_sha') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regclass('private.uploaded_content_sha') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_object_version(uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.approval_object_version(uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.approval_object_version(uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_operation_immutable()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.approval_operation_immutable()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.approval_operation_immutable()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_serialize()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.approval_serialize()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.approval_serialize()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.preview_approval_identity(uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.preview_approval_identity(uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.preview_approval_identity(uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.verify_approval_identity(uuid, jsonb, text)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.verify_approval_identity(uuid, jsonb, text)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.verify_approval_identity(uuid, jsonb, text)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_write_audit(uuid, text)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.approval_write_audit(uuid, text)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.approval_write_audit(uuid, text)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_application_guard()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.approval_application_guard()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.approval_application_guard()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_after()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.approval_after()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.approval_after()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_evidence_changed()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.approval_evidence_changed()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.approval_evidence_changed()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_review_guard()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.approval_review_guard()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.approval_review_guard()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_audit_guard()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.approval_audit_guard()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.approval_audit_guard()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_result(private.approval_operations, boolean)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.approval_result(private.approval_operations, boolean)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.approval_result(private.approval_operations, boolean)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.recover_application_approval(uuid, uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.recover_application_approval(uuid, uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.recover_application_approval(uuid, uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.approve_application_checked(uuid, bigint, uuid, text)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.approve_application_checked(uuid, bigint, uuid, text)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.approve_application_checked(uuid, bigint, uuid, text)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.approval_readiness(uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.approval_readiness(uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.approval_readiness(uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_provider_actor()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.approval_provider_actor()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.approval_provider_actor()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_actor()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.approval_actor()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.approval_actor()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_lock()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.approval_lock()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.approval_lock()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.approval_operations' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'approval_operations' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'approval_operations' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.applications.approval_evidence_version' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'applications' AND column_name = 'approval_evidence_version'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'applications' AND column_name = 'approval_evidence_version'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.application_identity_reviews.approval_evidence' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'application_identity_reviews' AND column_name = 'approval_evidence'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'application_identity_reviews' AND column_name = 'approval_evidence'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger private.approval_operations.immutable_operation' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'approval_operations' AND t.tgname = 'immutable_operation'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'approval_operations' AND t.tgname = 'immutable_operation'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.applications.approval_serialize' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'applications' AND t.tgname = 'approval_serialize'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'applications' AND t.tgname = 'approval_serialize'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.documents.approval_serialize' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'documents' AND t.tgname = 'approval_serialize'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'documents' AND t.tgname = 'approval_serialize'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.application_identity_reviews.approval_serialize' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND t.tgname = 'approval_serialize'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND t.tgname = 'approval_serialize'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.user_roles.approval_serialize' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'user_roles' AND t.tgname = 'approval_serialize'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'user_roles' AND t.tgname = 'approval_serialize'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.applications.approval_boundary' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'applications' AND t.tgname = 'approval_boundary'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'applications' AND t.tgname = 'approval_boundary'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.applications.approval_audit' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'applications' AND t.tgname = 'approval_audit'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'applications' AND t.tgname = 'approval_audit'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.documents.approval_evidence_changed' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'documents' AND t.tgname = 'approval_evidence_changed'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'documents' AND t.tgname = 'approval_evidence_changed'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.application_identity_reviews.approval_evidence_changed' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND t.tgname = 'approval_evidence_changed'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND t.tgname = 'approval_evidence_changed'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.application_identity_reviews.approval_review_guard' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND t.tgname = 'approval_review_guard'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND t.tgname = 'approval_review_guard'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.audit_log.approval_audit_guard' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'audit_log' AND t.tgname = 'approval_audit_guard'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'audit_log' AND t.tgname = 'approval_audit_guard'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.audit_log.approval_audit_truncate' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'audit_log' AND t.tgname = 'approval_audit_truncate'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'audit_log' AND t.tgname = 'approval_audit_truncate'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.application_identity_reviews.approval_reviews_truncate' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND t.tgname = 'approval_reviews_truncate'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND t.tgname = 'approval_reviews_truncate'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.lock_vehicle_release()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.lock_vehicle_release()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.lock_vehicle_release()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.vehicle_release_reasons(uuid, uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.vehicle_release_reasons(uuid, uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.vehicle_release_reasons(uuid, uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.guard_safe_vehicle_release()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.guard_safe_vehicle_release()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.guard_safe_vehicle_release()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.preserve_inspection_safety()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.preserve_inspection_safety()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.preserve_inspection_safety()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.end_rental_safe_v1(uuid, date, text, integer, uuid, text)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.end_rental_safe_v1(uuid, date, text, integer, uuid, text)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.end_rental_safe_v1(uuid, date, text, integer, uuid, text)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.hold_vehicle_on_evidence()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.hold_vehicle_on_evidence()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.hold_vehicle_on_evidence()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_immutable()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_immutable()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_immutable()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_agreement_evidence(uuid, uuid, timestamp with time zone, numeric)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_agreement_evidence(uuid, uuid, timestamp with time zone, numeric)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_agreement_evidence(uuid, uuid, timestamp with time zone, numeric)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_agreement_evidence(uuid, uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_agreement_evidence(uuid, uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_agreement_evidence(uuid, uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_subscription_evidence(uuid, uuid, numeric)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_subscription_evidence(uuid, uuid, numeric)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_subscription_evidence(uuid, uuid, numeric)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.record_existing_rental_tx(uuid, uuid, uuid, timestamp with time zone, numeric, numeric, integer, uuid, text)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.record_existing_rental_tx(uuid, uuid, uuid, timestamp with time zone, numeric, numeric, integer, uuid, text)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.record_existing_rental_tx(uuid, uuid, uuid, timestamp with time zone, numeric, numeric, integer, uuid, text)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_assignment_interval_guard()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_assignment_interval_guard()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_assignment_interval_guard()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_audit_guard()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_audit_guard()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_audit_guard()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_close_guard_v2()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_close_guard_v2()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_close_guard_v2()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.close_recorded_rental_v2(uuid, uuid, timestamp with time zone, text, integer, text)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.close_recorded_rental_v2(uuid, uuid, timestamp with time zone, text, integer, text)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.close_recorded_rental_v2(uuid, uuid, timestamp with time zone, text, integer, text)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_session_v1()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_session_v1()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_session_v1()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_snapshot_v1(uuid, uuid, uuid, uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_snapshot_v1(uuid, uuid, uuid, uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_snapshot_v1(uuid, uuid, uuid, uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.issue_record_evidence_v1(jsonb, jsonb, jsonb)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.issue_record_evidence_v1(jsonb, jsonb, jsonb)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.issue_record_evidence_v1(jsonb, jsonb, jsonb)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_agreement_evidence_v1(uuid, uuid, timestamp with time zone, numeric)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_agreement_evidence_v1(uuid, uuid, timestamp with time zone, numeric)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_agreement_evidence_v1(uuid, uuid, timestamp with time zone, numeric)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_subscription_evidence_v1(uuid, uuid, numeric)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_subscription_evidence_v1(uuid, uuid, numeric)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_subscription_evidence_v1(uuid, uuid, numeric)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_existing_rental_evidence_core_v1(uuid, uuid, uuid, timestamp with time zone, numeric, numeric, integer, uuid, text)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_existing_rental_evidence_core_v1(uuid, uuid, uuid, timestamp with time zone, numeric, numeric, integer, uuid, text)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_existing_rental_evidence_core_v1(uuid, uuid, uuid, timestamp with time zone, numeric, numeric, integer, uuid, text)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.record_existing_rental_evidence_v1(uuid, jsonb)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.record_existing_rental_evidence_v1(uuid, jsonb)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.record_existing_rental_evidence_v1(uuid, jsonb)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.document_integrity_guard_v1()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.document_integrity_guard_v1()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.document_integrity_guard_v1()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.bind_document_integrity_v1(uuid, jsonb, text, text, uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.bind_document_integrity_v1(uuid, jsonb, text, text, uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.bind_document_integrity_v1(uuid, jsonb, text, text, uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.license_snapshot_v1(uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.license_snapshot_v1(uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.license_snapshot_v1(uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.positive_review_guard_v1()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.positive_review_guard_v1()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.positive_review_guard_v1()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.verify_license_v1(uuid, jsonb)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.verify_license_v1(uuid, jsonb)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.verify_license_v1(uuid, jsonb)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.validate_license_v1(uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.validate_license_v1(uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.validate_license_v1(uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.integrity_serialize_v1()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.integrity_serialize_v1()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.integrity_serialize_v1()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.positive_audit_guard_v1()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.positive_audit_guard_v1()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.positive_audit_guard_v1()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.signed_binding_guard_v1()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.signed_binding_guard_v1()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.signed_binding_guard_v1()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_identity_reader_v2(uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_identity_reader_v2(uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_identity_reader_v2(uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.recover_record_evidence_v1(uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.recover_record_evidence_v1(uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.recover_record_evidence_v1(uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_issuer_scope_v2(uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_issuer_scope_v2(uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_issuer_scope_v2(uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_approval_scope_v3(uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_approval_scope_v3(uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_approval_scope_v3(uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_executor_scope_v3(uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_executor_scope_v3(uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_executor_scope_v3(uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_close_scope_v5(uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.record_close_scope_v5(uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.record_close_scope_v5(uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.storage_integrity_v1()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.storage_integrity_v1()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.storage_integrity_v1()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.subscription_actor_v1(uuid, uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.subscription_actor_v1(uuid, uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.subscription_actor_v1(uuid, uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.subscription_guard_v1()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.subscription_guard_v1()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.subscription_guard_v1()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.rental_subscription_begin_v1(uuid, uuid, uuid, text, text, text)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.rental_subscription_begin_v1(uuid, uuid, uuid, text, text, text)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.rental_subscription_begin_v1(uuid, uuid, uuid, text, text, text)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.rental_subscription_finish_v1(uuid, uuid, uuid, text, text, text)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.rental_subscription_finish_v1(uuid, uuid, uuid, text, text, text)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.rental_subscription_finish_v1(uuid, uuid, uuid, text, text, text)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.finalized_archive_pointer_v1()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.finalized_archive_pointer_v1()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.finalized_archive_pointer_v1()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.finalized_archive_document_v1()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.finalized_archive_document_v1()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.finalized_archive_document_v1()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.completed_archive_storage_v1()' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.completed_archive_storage_v1()') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.completed_archive_storage_v1()') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.link_replacement_agreement_v1(uuid, uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.link_replacement_agreement_v1(uuid, uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.link_replacement_agreement_v1(uuid, uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.link_replacement_agreement_checked(uuid, uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.link_replacement_agreement_checked(uuid, uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.link_replacement_agreement_checked(uuid, uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.swap_agreement_evidence(uuid, uuid, uuid, timestamp with time zone)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.swap_agreement_evidence(uuid, uuid, uuid, timestamp with time zone)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.swap_agreement_evidence(uuid, uuid, uuid, timestamp with time zone)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.swap_project_vehicle_v1(uuid, uuid, uuid, uuid, timestamp with time zone, integer, integer, uuid, uuid, bigint, text)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('private.swap_project_vehicle_v1(uuid, uuid, uuid, uuid, timestamp with time zone, integer, integer, uuid, uuid, bigint, text)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('private.swap_project_vehicle_v1(uuid, uuid, uuid, uuid, timestamp with time zone, integer, integer, uuid, uuid, bigint, text)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.swap_rental_vehicle_tx(uuid, uuid, uuid, uuid, timestamp with time zone, integer, integer, text, uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.swap_rental_vehicle_tx(uuid, uuid, uuid, uuid, timestamp with time zone, integer, integer, text, uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.swap_rental_vehicle_tx(uuid, uuid, uuid, uuid, timestamp with time zone, integer, integer, text, uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.list_assignment_history_v1(uuid, uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.list_assignment_history_v1(uuid, uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.list_assignment_history_v1(uuid, uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.extend_rental_tx(uuid, uuid, date, date, text, uuid)' AS check_name, 'absent' AS expected, CASE WHEN (to_regprocedure('public.extend_rental_tx(uuid, uuid, date, date, text, uuid)') IS NOT NULL) THEN 'present' ELSE 'absent' END AS actual, ((to_regprocedure('public.extend_rental_tx(uuid, uuid, date, date, text, uuid)') IS NOT NULL) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_customer_number_seq' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_customer_number_seq' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_customer_number_seq' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_booking_number_seq' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_booking_number_seq' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_booking_number_seq' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_customers' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_customers' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_customers' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_operations' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_operations' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_operations' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.booking_vehicle_assignments' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'booking_vehicle_assignments' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'booking_vehicle_assignments' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.assignment_closures' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'assignment_closures' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'assignment_closures' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_subscription_links' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_subscription_links' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_subscription_links' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_assignment_history' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_assignment_history' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_assignment_history' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_close_operations' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_close_operations' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_close_operations' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_close_context' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_close_context' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_close_context' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_evidence_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_evidence_v1' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_evidence_v1' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_evidence_consumed_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_evidence_consumed_v1' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_evidence_consumed_v1' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.record_evidence_context_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_evidence_context_v1' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'record_evidence_context_v1' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.rental_subscription_operations_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'rental_subscription_operations_v1' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'rental_subscription_operations_v1' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.agreement_evidence' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'agreement_evidence' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'agreement_evidence' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.swap_number_seq' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'swap_number_seq' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'swap_number_seq' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.swap_operations' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'swap_operations' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'swap_operations' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'private.extend_operations' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'extend_operations' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'extend_operations' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.return_checklists' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklists' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklists' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.return_checklist_items' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklist_items' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklist_items' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.return_checklist_photos' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklist_photos' AND c.relkind IN ('r','p','v','m','S','f')
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklist_photos' AND c.relkind IN ('r','p','v','m','S','f')
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'index public.record_one_original' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'record_one_original' AND c.relkind = 'i'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'record_one_original' AND c.relkind = 'i'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'index private.rental_subscription_pending_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'rental_subscription_pending_v1' AND c.relkind = 'i'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname = 'rental_subscription_pending_v1' AND c.relkind = 'i'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'index public.return_checklists_rental_idx' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklists_rental_idx' AND c.relkind = 'i'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklists_rental_idx' AND c.relkind = 'i'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.documents.integrity_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'integrity_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'integrity_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.application_identity_reviews.positive_evidence_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'application_identity_reviews' AND column_name = 'positive_evidence_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'application_identity_reviews' AND column_name = 'positive_evidence_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'public.booking_vehicle_assignments.swap_operation_id' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'booking_vehicle_assignments' AND column_name = 'swap_operation_id'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'booking_vehicle_assignments' AND column_name = 'swap_operation_id'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.vehicles.safe_release_lock' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'vehicles' AND t.tgname = 'safe_release_lock'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'vehicles' AND t.tgname = 'safe_release_lock'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.rentals.safe_release_lock' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'rentals' AND t.tgname = 'safe_release_lock'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'rentals' AND t.tgname = 'safe_release_lock'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.inspections.safe_release_lock' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'inspections' AND t.tgname = 'safe_release_lock'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'inspections' AND t.tgname = 'safe_release_lock'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.inspection_items.safe_release_lock' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'inspection_items' AND t.tgname = 'safe_release_lock'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'inspection_items' AND t.tgname = 'safe_release_lock'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.incidents.safe_release_lock' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'incidents' AND t.tgname = 'safe_release_lock'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'incidents' AND t.tgname = 'safe_release_lock'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.maintenance_records.safe_release_lock' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'maintenance_records' AND t.tgname = 'safe_release_lock'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'maintenance_records' AND t.tgname = 'safe_release_lock'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.rentals.safe_release_guard' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'rentals' AND t.tgname = 'safe_release_guard'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'rentals' AND t.tgname = 'safe_release_guard'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.vehicles.safe_release_guard' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'vehicles' AND t.tgname = 'safe_release_guard'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'vehicles' AND t.tgname = 'safe_release_guard'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.inspections.safe_release_history' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'inspections' AND t.tgname = 'safe_release_history'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'inspections' AND t.tgname = 'safe_release_history'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.inspection_items.safe_release_history' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'inspection_items' AND t.tgname = 'safe_release_history'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'inspection_items' AND t.tgname = 'safe_release_history'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.inspections.safe_release_evidence' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'inspections' AND t.tgname = 'safe_release_evidence'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'inspections' AND t.tgname = 'safe_release_evidence'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.inspection_items.safe_release_evidence' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'inspection_items' AND t.tgname = 'safe_release_evidence'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'inspection_items' AND t.tgname = 'safe_release_evidence'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.incidents.safe_release_evidence' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'incidents' AND t.tgname = 'safe_release_evidence'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'incidents' AND t.tgname = 'safe_release_evidence'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.maintenance_records.safe_release_evidence' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'maintenance_records' AND t.tgname = 'safe_release_evidence'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'maintenance_records' AND t.tgname = 'safe_release_evidence'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger private.record_customers.record_immutable' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'record_customers' AND t.tgname = 'record_immutable'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'record_customers' AND t.tgname = 'record_immutable'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger private.record_operations.record_immutable' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'record_operations' AND t.tgname = 'record_immutable'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'record_operations' AND t.tgname = 'record_immutable'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.booking_vehicle_assignments.record_immutable' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'booking_vehicle_assignments' AND t.tgname = 'record_immutable'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'booking_vehicle_assignments' AND t.tgname = 'record_immutable'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger private.assignment_closures.record_immutable' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'assignment_closures' AND t.tgname = 'record_immutable'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'assignment_closures' AND t.tgname = 'record_immutable'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger private.record_subscription_links.record_immutable' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'record_subscription_links' AND t.tgname = 'record_immutable'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'record_subscription_links' AND t.tgname = 'record_immutable'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.booking_vehicle_assignments.assignment_interval' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'booking_vehicle_assignments' AND t.tgname = 'assignment_interval'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'booking_vehicle_assignments' AND t.tgname = 'assignment_interval'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger private.assignment_closures.assignment_close_interval' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'assignment_closures' AND t.tgname = 'assignment_close_interval'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'assignment_closures' AND t.tgname = 'assignment_close_interval'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.audit_log.record_audit_immutable' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'audit_log' AND t.tgname = 'record_audit_immutable'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'audit_log' AND t.tgname = 'record_audit_immutable'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.audit_log.record_audit_no_truncate' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'audit_log' AND t.tgname = 'record_audit_no_truncate'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'audit_log' AND t.tgname = 'record_audit_no_truncate'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger private.record_close_operations.record_immutable' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'record_close_operations' AND t.tgname = 'record_immutable'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'record_close_operations' AND t.tgname = 'record_immutable'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.rentals.record_close_guard_v2' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'rentals' AND t.tgname = 'record_close_guard_v2'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'rentals' AND t.tgname = 'record_close_guard_v2'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger private.record_evidence_v1.evidence_immutable' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'record_evidence_v1' AND t.tgname = 'evidence_immutable'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'record_evidence_v1' AND t.tgname = 'evidence_immutable'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger private.record_evidence_consumed_v1.consumption_immutable' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'record_evidence_consumed_v1' AND t.tgname = 'consumption_immutable'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'record_evidence_consumed_v1' AND t.tgname = 'consumption_immutable'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.documents.document_integrity_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'documents' AND t.tgname = 'document_integrity_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'documents' AND t.tgname = 'document_integrity_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.documents.document_integrity_truncate_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'documents' AND t.tgname = 'document_integrity_truncate_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'documents' AND t.tgname = 'document_integrity_truncate_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.application_identity_reviews.positive_review_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND t.tgname = 'positive_review_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND t.tgname = 'positive_review_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.application_identity_reviews.positive_review_truncate_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND t.tgname = 'positive_review_truncate_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND t.tgname = 'positive_review_truncate_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.applications.integrity_serialize_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'applications' AND t.tgname = 'integrity_serialize_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'applications' AND t.tgname = 'integrity_serialize_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.documents.integrity_serialize_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'documents' AND t.tgname = 'integrity_serialize_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'documents' AND t.tgname = 'integrity_serialize_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.application_identity_reviews.integrity_serialize_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND t.tgname = 'integrity_serialize_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND t.tgname = 'integrity_serialize_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.user_roles.integrity_serialize_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'user_roles' AND t.tgname = 'integrity_serialize_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'user_roles' AND t.tgname = 'integrity_serialize_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.agreements.integrity_serialize_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'agreements' AND t.tgname = 'integrity_serialize_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'agreements' AND t.tgname = 'integrity_serialize_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.audit_log.positive_audit_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'audit_log' AND t.tgname = 'positive_audit_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'audit_log' AND t.tgname = 'positive_audit_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.audit_log.positive_audit_truncate_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'audit_log' AND t.tgname = 'positive_audit_truncate_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'audit_log' AND t.tgname = 'positive_audit_truncate_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.agreements.signed_binding_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'agreements' AND t.tgname = 'signed_binding_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'agreements' AND t.tgname = 'signed_binding_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.agreements.signed_binding_truncate_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'agreements' AND t.tgname = 'signed_binding_truncate_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'agreements' AND t.tgname = 'signed_binding_truncate_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger storage.objects.storage_integrity_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'storage' AND c.relname = 'objects' AND t.tgname = 'storage_integrity_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'storage' AND c.relname = 'objects' AND t.tgname = 'storage_integrity_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger storage.objects.storage_integrity_truncate_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'storage' AND c.relname = 'objects' AND t.tgname = 'storage_integrity_truncate_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'storage' AND c.relname = 'objects' AND t.tgname = 'storage_integrity_truncate_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.rentals.subscription_guard_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'rentals' AND t.tgname = 'subscription_guard_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'rentals' AND t.tgname = 'subscription_guard_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.agreements.finalized_archive_pointer_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'agreements' AND t.tgname = 'finalized_archive_pointer_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'agreements' AND t.tgname = 'finalized_archive_pointer_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger public.documents.finalized_archive_document_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'documents' AND t.tgname = 'finalized_archive_document_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = 'documents' AND t.tgname = 'finalized_archive_document_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger storage.objects.completed_archive_storage_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'storage' AND c.relname = 'objects' AND t.tgname = 'completed_archive_storage_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'storage' AND c.relname = 'objects' AND t.tgname = 'completed_archive_storage_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger storage.objects.completed_archive_storage_truncate_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'storage' AND c.relname = 'objects' AND t.tgname = 'completed_archive_storage_truncate_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'storage' AND c.relname = 'objects' AND t.tgname = 'completed_archive_storage_truncate_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger private.agreement_evidence.agreement_evidence_immutable' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'agreement_evidence' AND t.tgname = 'agreement_evidence_immutable'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'agreement_evidence' AND t.tgname = 'agreement_evidence_immutable'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger private.swap_operations.swap_operations_immutable' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'swap_operations' AND t.tgname = 'swap_operations_immutable'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'swap_operations' AND t.tgname = 'swap_operations_immutable'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'trigger private.extend_operations.extend_operations_immutable' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'extend_operations' AND t.tgname = 'extend_operations_immutable'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'private' AND c.relname = 'extend_operations' AND t.tgname = 'extend_operations_immutable'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.application_identity_reviews.positive_review_privacy_v1' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND pol.polname = 'positive_review_privacy_v1'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND pol.polname = 'positive_review_privacy_v1'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.applications.issuer_scope_allow_v2' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'applications' AND pol.polname = 'issuer_scope_allow_v2'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'applications' AND pol.polname = 'issuer_scope_allow_v2'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.applications.issuer_scope_limit_v2' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'applications' AND pol.polname = 'issuer_scope_limit_v2'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'applications' AND pol.polname = 'issuer_scope_limit_v2'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.documents.issuer_scope_allow_v2' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'issuer_scope_allow_v2'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'issuer_scope_allow_v2'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.documents.issuer_scope_limit_v2' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'issuer_scope_limit_v2'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'issuer_scope_limit_v2'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.user_roles.issuer_scope_allow_v2' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'user_roles' AND pol.polname = 'issuer_scope_allow_v2'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'user_roles' AND pol.polname = 'issuer_scope_allow_v2'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.user_roles.issuer_scope_limit_v2' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'user_roles' AND pol.polname = 'issuer_scope_limit_v2'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'user_roles' AND pol.polname = 'issuer_scope_limit_v2'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.agreements.issuer_scope_allow_v2' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'agreements' AND pol.polname = 'issuer_scope_allow_v2'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'agreements' AND pol.polname = 'issuer_scope_allow_v2'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.agreements.issuer_scope_limit_v2' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'agreements' AND pol.polname = 'issuer_scope_limit_v2'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'agreements' AND pol.polname = 'issuer_scope_limit_v2'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.applications.approval_scope_permissive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'applications' AND pol.polname = 'approval_scope_permissive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'applications' AND pol.polname = 'approval_scope_permissive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.applications.approval_scope_restrictive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'applications' AND pol.polname = 'approval_scope_restrictive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'applications' AND pol.polname = 'approval_scope_restrictive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.documents.approval_scope_permissive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'approval_scope_permissive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'approval_scope_permissive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.documents.approval_scope_restrictive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'approval_scope_restrictive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'approval_scope_restrictive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.user_roles.approval_scope_permissive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'user_roles' AND pol.polname = 'approval_scope_permissive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'user_roles' AND pol.polname = 'approval_scope_permissive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.user_roles.approval_scope_restrictive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'user_roles' AND pol.polname = 'approval_scope_restrictive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'user_roles' AND pol.polname = 'approval_scope_restrictive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.application_identity_reviews.approval_scope_permissive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND pol.polname = 'approval_scope_permissive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND pol.polname = 'approval_scope_permissive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.application_identity_reviews.approval_scope_restrictive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND pol.polname = 'approval_scope_restrictive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND pol.polname = 'approval_scope_restrictive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.audit_log.approval_scope_permissive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'audit_log' AND pol.polname = 'approval_scope_permissive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'audit_log' AND pol.polname = 'approval_scope_permissive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.audit_log.approval_scope_restrictive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'audit_log' AND pol.polname = 'approval_scope_restrictive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'audit_log' AND pol.polname = 'approval_scope_restrictive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.applications.record_scope_permissive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'applications' AND pol.polname = 'record_scope_permissive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'applications' AND pol.polname = 'record_scope_permissive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.applications.record_scope_restrictive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'applications' AND pol.polname = 'record_scope_restrictive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'applications' AND pol.polname = 'record_scope_restrictive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.documents.record_scope_permissive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'record_scope_permissive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'record_scope_permissive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.documents.record_scope_restrictive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'record_scope_restrictive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'record_scope_restrictive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.application_identity_reviews.record_scope_permissive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND pol.polname = 'record_scope_permissive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND pol.polname = 'record_scope_permissive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.application_identity_reviews.record_scope_restrictive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND pol.polname = 'record_scope_restrictive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND pol.polname = 'record_scope_restrictive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.user_roles.record_scope_permissive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'user_roles' AND pol.polname = 'record_scope_permissive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'user_roles' AND pol.polname = 'record_scope_permissive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.user_roles.record_scope_restrictive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'user_roles' AND pol.polname = 'record_scope_restrictive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'user_roles' AND pol.polname = 'record_scope_restrictive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.vehicles.record_scope_permissive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'vehicles' AND pol.polname = 'record_scope_permissive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'vehicles' AND pol.polname = 'record_scope_permissive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.vehicles.record_scope_restrictive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'vehicles' AND pol.polname = 'record_scope_restrictive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'vehicles' AND pol.polname = 'record_scope_restrictive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.odometer_readings.record_scope_permissive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'odometer_readings' AND pol.polname = 'record_scope_permissive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'odometer_readings' AND pol.polname = 'record_scope_permissive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.odometer_readings.record_scope_restrictive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'odometer_readings' AND pol.polname = 'record_scope_restrictive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'odometer_readings' AND pol.polname = 'record_scope_restrictive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.audit_log.record_scope_permissive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'audit_log' AND pol.polname = 'record_scope_permissive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'audit_log' AND pol.polname = 'record_scope_permissive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.audit_log.record_scope_restrictive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'audit_log' AND pol.polname = 'record_scope_restrictive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'audit_log' AND pol.polname = 'record_scope_restrictive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.rentals.record_read_permissive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'rentals' AND pol.polname = 'record_read_permissive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'rentals' AND pol.polname = 'record_read_permissive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.rentals.record_read_restrictive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'rentals' AND pol.polname = 'record_read_restrictive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'rentals' AND pol.polname = 'record_read_restrictive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.rentals.record_write_permissive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'rentals' AND pol.polname = 'record_write_permissive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'rentals' AND pol.polname = 'record_write_permissive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.rentals.record_write_restrictive_v3' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'rentals' AND pol.polname = 'record_write_restrictive_v3'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'rentals' AND pol.polname = 'record_write_restrictive_v3'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.application_identity_reviews.issuer_identity_allow_v5' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND pol.polname = 'issuer_identity_allow_v5'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND pol.polname = 'issuer_identity_allow_v5'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.application_identity_reviews.issuer_identity_limit_v5' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND pol.polname = 'issuer_identity_limit_v5'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'application_identity_reviews' AND pol.polname = 'issuer_identity_limit_v5'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.return_checklists.Managers read return checklists' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklists' AND pol.polname = 'Managers read return checklists'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklists' AND pol.polname = 'Managers read return checklists'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.return_checklists.Managers insert return checklists' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklists' AND pol.polname = 'Managers insert return checklists'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklists' AND pol.polname = 'Managers insert return checklists'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.return_checklist_items.Managers read return checklist items' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklist_items' AND pol.polname = 'Managers read return checklist items'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklist_items' AND pol.polname = 'Managers read return checklist items'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.return_checklist_items.Managers insert return checklist items' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklist_items' AND pol.polname = 'Managers insert return checklist items'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklist_items' AND pol.polname = 'Managers insert return checklist items'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.return_checklist_photos.Managers read return checklist photos' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklist_photos' AND pol.polname = 'Managers read return checklist photos'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklist_photos' AND pol.polname = 'Managers read return checklist photos'
    )) = ('absent' = 'present')) AS ok
UNION ALL
SELECT 'policy public.return_checklist_photos.Managers insert return checklist photos' AS check_name, 'absent' AS expected, CASE WHEN (EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklist_photos' AND pol.polname = 'Managers insert return checklist photos'
    )) THEN 'present' ELSE 'absent' END AS actual, ((EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'return_checklist_photos' AND pol.polname = 'Managers insert return checklist photos'
    )) = ('absent' = 'present')) AS ok
ORDER BY check_name;
