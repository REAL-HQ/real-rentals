-- Insurance verification authority v1 inner DDL. Runner owns the transaction.
-- The final insurance verification decision (driver_screenings.insurance_verified and its
-- insurance_verified_at / insurance_verified_by stamps) becomes Manager/Owner only:
-- 1. public.set_insurance_verification verifies or revokes, checks private.is_manager() for the
--    caller's own JWT, and writes the insurance.verified / insurance.verification_revoked audit
--    row in the same transaction (actor, time, insurance document id + SHA-256 + path, insurer,
--    policy number last 4 + SHA-256, policy expiry). An audit failure refuses the decision.
-- 2. A row trigger on public.driver_screenings refuses any other change to those three columns
--    from authenticated, anon or service_role (Coordinators, Managers and Owners writing the
--    table directly, and server code). Every other column, including the insurance information
--    fields (carrier, policy number, carrier phone, policy active, name match), stays writable
--    exactly as today.
-- Nothing on public.applications, no grant and no policy changes.

CREATE FUNCTION private.insurance_decision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $ivguardfn$
BEGIN
 IF current_user OPERATOR(pg_catalog.=) ANY (ARRAY['authenticated', 'anon', 'service_role']::pg_catalog.name[]) THEN
  IF TG_OP OPERATOR(pg_catalog.=) 'INSERT' THEN
   IF NEW.insurance_verified IS TRUE OR NEW.insurance_verified_at IS NOT NULL OR NEW.insurance_verified_by IS NOT NULL THEN
    RAISE EXCEPTION 'insurance_decision_manager_rpc_only' USING ERRCODE = '42501';
   END IF;
  ELSIF NEW.insurance_verified IS DISTINCT FROM OLD.insurance_verified
   OR NEW.insurance_verified_at IS DISTINCT FROM OLD.insurance_verified_at
   OR NEW.insurance_verified_by IS DISTINCT FROM OLD.insurance_verified_by THEN
   RAISE EXCEPTION 'insurance_decision_manager_rpc_only' USING ERRCODE = '42501';
  END IF;
 END IF;
 RETURN NEW;
END $ivguardfn$;
REVOKE ALL ON FUNCTION private.insurance_decision_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zz_insurance_decision_guard BEFORE INSERT OR UPDATE ON public.driver_screenings
 FOR EACH ROW EXECUTE FUNCTION private.insurance_decision_guard();

CREATE FUNCTION public.set_insurance_verification(_application_id uuid, _verified boolean, _note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $ivsetfn$
DECLARE
 actor uuid := auth.uid();
 actor_role text;
 actor_email text;
 screening uuid;
 old_verified boolean;
 old_at timestamptz;
 old_by text;
 decided_at timestamptz := pg_catalog.clock_timestamp();
 doc_id uuid;
 doc_sha text;
 doc_path text;
 doc_expires date;
 doc_review text;
 carrier text;
 policy text;
 policy_expires date;
 audit_id uuid;
BEGIN
 IF _application_id IS NULL OR _verified IS NULL THEN RAISE EXCEPTION 'decision_required' USING ERRCODE = '22004'; END IF;
 IF actor IS NULL OR private.is_manager() IS NOT TRUE THEN RAISE EXCEPTION 'manager_required' USING ERRCODE = '42501'; END IF;
 SELECT r.role::text INTO actor_role FROM public.user_roles r
  WHERE r.user_id = actor AND r.role::text = ANY (ARRAY['admin', 'team']) ORDER BY (r.role::text = 'admin') DESC LIMIT 1;
 PERFORM 1 FROM public.applications a WHERE a.id = _application_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found'; END IF;
 SELECT sc.id, sc.insurance_verified IS TRUE, sc.insurance_verified_at, sc.insurance_verified_by
  INTO screening, old_verified, old_at, old_by
  FROM public.driver_screenings sc WHERE sc.lead_id = _application_id FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO public.driver_screenings (lead_id) VALUES (_application_id) RETURNING id INTO screening;
  old_verified := false;
 END IF;
 SELECT u.email INTO actor_email FROM auth.users u WHERE u.id = actor;
 UPDATE public.driver_screenings SET insurance_verified = _verified,
  insurance_verified_at = CASE WHEN _verified THEN decided_at END,
  insurance_verified_by = CASE WHEN _verified THEN COALESCE(actor_email, actor::text) END
  WHERE id = screening;
 SELECT d.id, d.content_sha256, d.storage_path, d.expires_at, d.review_status INTO doc_id, doc_sha, doc_path, doc_expires, doc_review
  FROM public.documents d WHERE d.driver_id = _application_id AND d.is_current IS TRUE AND d.category = 'insurance'
  ORDER BY d.created_at DESC LIMIT 1;
 SELECT COALESCE(NULLIF(sc.insurance_carrier, ''), a.insurance_carrier), COALESCE(NULLIF(sc.insurance_policy_number, ''), a.insurance_policy_number), a.insurance_expires_on
  INTO carrier, policy, policy_expires
  FROM public.applications a LEFT JOIN public.driver_screenings sc ON sc.lead_id = a.id WHERE a.id = _application_id;
 policy := pg_catalog.upper(pg_catalog.regexp_replace(policy, '\s', '', 'g'));
 INSERT INTO public.audit_log (actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (actor, actor_email, actor_role,
  CASE WHEN _verified THEN 'insurance.verified' ELSE 'insurance.verification_revoked' END, 'application', _application_id::text,
  CASE WHEN _verified THEN 'Insurance verified' ELSE 'Insurance verification revoked' END,
  pg_catalog.jsonb_build_object('decision', CASE WHEN _verified THEN 'verified' ELSE 'revoked' END,
   'from', old_verified, 'to', _verified, 'decided_at', decided_at, 'decided_by', actor, 'note', pg_catalog.left(_note, 500),
   'screening_id', screening, 'previous_verified_at', old_at, 'previous_verified_by', old_by,
   'document', CASE WHEN doc_id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object('id', doc_id, 'content_sha256', doc_sha,
     'storage_path', doc_path, 'expires_at', doc_expires, 'review_status', doc_review) END,
   'insurer', carrier,
   'policy_number_last4', CASE WHEN policy IS NULL OR policy = '' THEN NULL ELSE pg_catalog.right(policy, 4) END,
   'policy_number_sha256', CASE WHEN policy IS NULL OR policy = '' THEN NULL ELSE pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(policy, 'UTF8')), 'hex') END,
   'policy_expires_on', policy_expires, 'source', 'set_insurance_verification'),
  decided_at)
 RETURNING id INTO audit_id;
 RETURN pg_catalog.jsonb_build_object('verified', _verified, 'previous', old_verified, 'decided_at', decided_at, 'audit_id', audit_id,
  'document_id', doc_id);
END $ivsetfn$;
REVOKE ALL ON FUNCTION public.set_insurance_verification(uuid, boolean, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_insurance_verification(uuid, boolean, text) TO authenticated;
