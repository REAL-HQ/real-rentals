-- GENERATED verbatim from proposed/HOSTED-INSTALL.md, Step 3. Do not edit.
SELECT to_regprocedure('private.approval_validate(uuid)') IS NOT NULL AND to_regclass('private.approval_operations') IS NOT NULL
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
 AND (SELECT count(*)=24 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=public'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=public'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
