-- Additive, release-only repair. Never run automatically during an app build.
-- Existing migrations remain unchanged. Requires application_identity_reviews
-- (0019/0020), resume tokens, staff helpers, and the canonical audit_log.
CREATE TABLE public.application_recovery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  token_id uuid REFERENCES public.application_resume_tokens(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'sent', 'failed', 'unknown')),
  provider_id text,
  finished_at timestamptz
);
CREATE INDEX application_recovery_attempts_quota_idx
  ON public.application_recovery_attempts(application_id, created_at DESC);
ALTER TABLE public.application_recovery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.application_recovery_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.application_recovery_attempts TO service_role;

-- Carry forward recorded successful sends so rollout does not reset an active
-- cooldown. Malformed display metadata is skipped; applicant rows are untouched.
DO $$
DECLARE historical record; entry jsonb; sent_at timestamptz;
BEGIN
  FOR historical IN SELECT id, resubmission_history FROM public.applications
    WHERE jsonb_typeof(resubmission_history) = 'array' LOOP
    FOR entry IN SELECT value FROM jsonb_array_elements(historical.resubmission_history) LOOP
      IF entry->>'link_sent' IS DISTINCT FROM 'true' THEN CONTINUE; END IF;
      BEGIN sent_at := (entry->>'at')::timestamptz;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN CONTINUE;
      END;
      IF sent_at > clock_timestamp() - interval '24 hours' AND sent_at <= clock_timestamp() THEN
        INSERT INTO public.application_recovery_attempts(application_id, created_at, status, finished_at)
          VALUES (historical.id, sent_at, 'sent', sent_at);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- This lock covers every public recovery entry point and every server instance.
-- Count reservations (including failed/unknown delivery), not just successes.
-- No email or raw credential is stored in the attempt ledger.
CREATE FUNCTION public.reserve_application_recovery(_application_id uuid, _token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.applications%ROWTYPE;
  stamp timestamptz;
  last_attempt timestamptz;
  sixth_latest timestamptz;
  wait_seconds integer;
  attempt_id uuid;
  recovery_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  IF _token_hash IS NULL OR _token_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid credential hash'; END IF;
  SELECT * INTO a FROM public.applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND OR a.deleted_at IS NOT NULL OR a.purged_at IS NOT NULL OR nullif(btrim(a.email), '') IS NULL THEN
    RETURN jsonb_build_object('reserved', false, 'retry_after_seconds', 120);
  END IF;
  -- Compute time after obtaining the lock, including when another request waited.
  stamp := clock_timestamp();
  SELECT max(created_at) INTO last_attempt FROM public.application_recovery_attempts WHERE application_id = a.id;
  SELECT created_at INTO sixth_latest FROM public.application_recovery_attempts
    WHERE application_id = a.id AND created_at > stamp - interval '24 hours'
    ORDER BY created_at DESC OFFSET 5 LIMIT 1;
  wait_seconds := greatest(0,
    coalesce(ceil(extract(epoch FROM (last_attempt + interval '120 seconds' - stamp)))::integer, 0),
    coalesce(ceil(extract(epoch FROM (sixth_latest + interval '24 hours' - stamp)))::integer, 0));
  IF wait_seconds > 0 THEN
    RETURN jsonb_build_object('reserved', false, 'retry_after_seconds', wait_seconds);
  END IF;
  -- Token and quota reservation commit together. Recovery sends never trim or
  -- revoke an applicant's existing session tokens, including on provider failure.
  INSERT INTO public.application_resume_tokens(application_id, token_hash, created_at, expires_at)
    VALUES (a.id, _token_hash, stamp, stamp + interval '30 minutes') RETURNING id INTO recovery_id;
  INSERT INTO public.application_recovery_attempts(application_id, token_id, created_at)
    VALUES (a.id, recovery_id, stamp) RETURNING id INTO attempt_id;
  RETURN jsonb_build_object('reserved', true, 'attempt_id', attempt_id,
    'email', a.email, 'full_name', a.full_name, 'retry_after_seconds', 120);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_application_recovery(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_application_recovery(uuid, text) TO service_role;

-- Finalization is idempotent; it never frees the reserved quota. An uncertain
-- network result keeps the token valid (the provider may have accepted it).
CREATE FUNCTION public.finish_application_recovery(_attempt_id uuid, _status text, _provider_id text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE attempt public.application_recovery_attempts%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  IF _status IS NULL OR _status NOT IN ('sent', 'failed', 'unknown') THEN RAISE EXCEPTION 'Invalid outcome'; END IF;
  SELECT * INTO attempt FROM public.application_recovery_attempts WHERE id = _attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recovery attempt not found'; END IF;
  IF attempt.status <> 'reserved' THEN RETURN; END IF;
  UPDATE public.application_recovery_attempts SET status = _status,
    provider_id = left(_provider_id, 200), finished_at = clock_timestamp() WHERE id = attempt.id;
  IF _status = 'failed' THEN
    UPDATE public.application_resume_tokens SET revoked_at = clock_timestamp()
      WHERE id = attempt.token_id AND revoked_at IS NULL;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_application_recovery(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_application_recovery(uuid, text, text) TO service_role;

-- Called using the authenticated caller, never an actor supplied in a payload.
-- Both writes belong to one transaction: any audit failure rolls back resolution.
CREATE FUNCTION public.resolve_application_identity_review(_review_id uuid, _resolution text, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text;
  actor_email text;
  review public.application_identity_reviews%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT private.is_manager() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  IF _resolution IS NULL OR _resolution NOT IN ('same_person', 'different_person', 'dismissed')
    OR _note IS NULL OR length(btrim(_note)) < 3 OR length(btrim(_note)) > 500 THEN
    RAISE EXCEPTION 'Invalid resolution';
  END IF;
  SELECT role::text INTO actor_role FROM public.user_roles
    WHERE user_id = actor_id AND role::text IN ('admin', 'team')
    ORDER BY CASE WHEN role::text = 'admin' THEN 0 ELSE 1 END LIMIT 1;
  IF actor_role IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  SELECT email INTO actor_email FROM auth.users WHERE id = actor_id;
  SELECT * INTO review FROM public.application_identity_reviews WHERE id = _review_id FOR UPDATE;
  IF NOT FOUND OR review.status <> 'open' THEN RETURN jsonb_build_object('ok', true, 'changed', false); END IF;
  UPDATE public.application_identity_reviews SET status = 'resolved', resolution = _resolution,
    resolution_note = btrim(_note), resolved_by = actor_id, resolved_at = clock_timestamp() WHERE id = review.id;
  INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata)
    VALUES (actor_id, actor_email, actor_role, 'identity_review.resolved', 'application', review.application_id::text,
      'Resolved identity review (' || replace(_resolution, '_', ' ') || ')',
      jsonb_build_object('review_id', review.id, 'kind', review.kind, 'resolution', _resolution, 'note', btrim(_note)));
  RETURN jsonb_build_object('ok', true, 'changed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_application_identity_review(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_application_identity_review(uuid, text, text) TO authenticated;
