CREATE FUNCTION private.recover_record_evidence_v1(operation uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; session uuid; e private.record_evidence_v1;
BEGIN
 actor:=private.approval_actor(); session:=private.record_session_v1();
 PERFORM private.approval_lock();
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role IN ('admin','team') FOR SHARE NOWAIT;
 IF NOT FOUND OR private.approval_actor() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'manager_required'; END IF;
 SELECT * INTO e FROM private.record_evidence_v1 WHERE operation_id=operation FOR SHARE NOWAIT;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF e.actor_id IS DISTINCT FROM actor OR e.session_id IS DISTINCT FROM session THEN
  RAISE EXCEPTION 'evidence_binding_invalid'; END IF;
 RETURN e.id;
END $$;
REVOKE ALL ON FUNCTION private.recover_record_evidence_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.recover_record_evidence_v1(uuid) TO rr_evidence_issuer;
