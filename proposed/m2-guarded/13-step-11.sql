-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('CREATE FUNCT', 'ION private.recover_record_evidence_v1(operation uuid) RETURNS uuid');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), '42f9b35977453380956655922fea68832bc7a728477db792d0b793c14cad596a', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '42f9b35977453380956655922fea68832bc7a728477db792d0b793c14cad596a';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 1025), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '814d00b8ff505457b4d5707e95fb887944a51c15dd3faea6333952203c3ef99f';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 1025) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
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
