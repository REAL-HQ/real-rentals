-- GENERATED verbatim from proposed/HOSTED-INSTALL.md, Step 27. Do not edit.
SELECT to_regprocedure('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)') IS NOT NULL AND to_regclass('private.extend_operations') IS NOT NULL AND coalesce(pg_get_functiondef(to_regprocedure('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)')),'') LIKE '%manager_required%' AND position('manager_required' in coalesce(pg_get_functiondef(to_regprocedure('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)')),'')) < position('private.approval_lock' in coalesce(pg_get_functiondef(to_regprocedure('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)')),'private.approval_lock')) AND position('approval_actor' in coalesce(pg_get_functiondef(to_regprocedure('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)')),'')) = 0 AND position('FOR SHARE NOWAIT' in coalesce(pg_get_functiondef(to_regprocedure('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)')),'')) > position('private.approval_lock' in coalesce(pg_get_functiondef(to_regprocedure('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)')),'private.approval_lock'))
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=76 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.link_replacement_agreement_checked(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.link_replacement_agreement_v1(uuid,uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.list_assignment_history_v1(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.completed_archive_storage_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.finalized_archive_document_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.finalized_archive_pointer_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_close_scope_v5(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.storage_integrity_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.subscription_actor_v1(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.subscription_guard_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.swap_agreement_evidence(uuid,uuid,uuid,timestamp with time zone)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.swap_project_vehicle_v1(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,uuid,uuid,bigint,text)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.swap_rental_vehicle_tx(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,text,uuid)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
