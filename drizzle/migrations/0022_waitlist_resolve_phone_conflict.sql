CREATE OR REPLACE FUNCTION public.resolve_waitlist_phone_conflict(
  _entry uuid, _application uuid, _use_waitlist_phone boolean, _reason text,
  _expected_waitlist_phone text, _expected_application_phone text,
  _actor uuid, _actor_email text, _actor_role text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  w public.waitlist%ROWTYPE;
  a public.applications%ROWTYPE;
  w_digits text; a_digits text; old_phone text;
BEGIN
  IF _actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role IN ('admin','team')
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Fixed lock order (waitlist, then application) so concurrent attempts serialize.
  SELECT * INTO w FROM public.waitlist WHERE id = _entry FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  -- Retry of an already-applied link: idempotent success, no second write or audit row.
  IF w.promoted_application_id IS NOT NULL THEN
    IF w.promoted_application_id = _application THEN
      RETURN jsonb_build_object('ok', true, 'already', true, 'application_id', _application);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'already_linked_elsewhere');
  END IF;

  SELECT * INTO a FROM public.applications WHERE id = _application FOR UPDATE;
  IF NOT FOUND OR a.deleted_at IS NOT NULL OR a.status = 'duplicate' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'application_unavailable');
  END IF;
  IF lower(trim(coalesce(a.email,''))) <> lower(trim(coalesce(w.email,''))) OR coalesce(w.email,'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_mismatch');
  END IF;

  w_digits := right(regexp_replace(coalesce(w.phone,''), '\D', '', 'g'), 10);
  a_digits := right(regexp_replace(coalesce(a.phone,''), '\D', '', 'g'), 10);
  IF w_digits <> right(regexp_replace(coalesce(_expected_waitlist_phone,''), '\D', '', 'g'), 10)
     OR a_digits <> right(regexp_replace(coalesce(_expected_application_phone,''), '\D', '', 'g'), 10) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale');
  END IF;

  -- The chosen application must be the one promotion itself would pick for this email.
  IF EXISTS (
    SELECT 1 FROM public.applications o
     WHERE o.id <> a.id AND o.status <> 'duplicate' AND o.deleted_at IS NULL
       AND lower(trim(o.email)) = lower(trim(w.email))
  ) THEN RETURN jsonb_build_object('ok', false, 'error', 'multiple_email_matches'); END IF;

  -- The waitlist phone must not belong to a different driver.
  IF length(w_digits) = 10 AND EXISTS (
    SELECT 1 FROM public.applications o
     WHERE o.id <> a.id AND o.status <> 'duplicate' AND o.deleted_at IS NULL
       AND coalesce(o.primary_application_id, o.id) <> coalesce(a.primary_application_id, a.id)
       AND right(regexp_replace(coalesce(o.phone,''), '\D', '', 'g'), 10) = w_digits
  ) THEN RETURN jsonb_build_object('ok', false, 'error', 'phone_belongs_to_other'); END IF;

  IF _use_waitlist_phone THEN
    IF length(trim(coalesce(_reason,''))) < 5 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'reason_required');
    END IF;
    IF coalesce(w.phone,'') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'no_waitlist_phone'); END IF;
  END IF;

  old_phone := a.phone;
  UPDATE public.applications
     SET waitlist_signed_up_at = coalesce(waitlist_signed_up_at, w.created_at),
         waitlist_source = coalesce(waitlist_source, w.source),
         phone = CASE WHEN _use_waitlist_phone THEN w.phone ELSE phone END
   WHERE id = a.id;
  UPDATE public.waitlist
     SET status = 'promoted', promoted_application_id = a.id, promoted_at = now(),
         review_reason = NULL, review_flagged_at = NULL
   WHERE id = w.id;

  INSERT INTO public.audit_log (actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata)
  VALUES (_actor, _actor_email, _actor_role, 'waitlist.conflict_resolved', 'waitlist', w.id::text,
    CASE WHEN _use_waitlist_phone THEN 'Linked waitlist entry to existing application and updated its phone'
         ELSE 'Linked waitlist entry to existing application, kept existing phone' END,
    jsonb_build_object('application_id', a.id, 'phone_choice', CASE WHEN _use_waitlist_phone THEN 'waitlist' ELSE 'existing' END,
      'reason', nullif(trim(coalesce(_reason,'')), ''), 'previous_phone_last4', right(regexp_replace(coalesce(old_phone,''), '\D', '', 'g'), 4),
      'new_phone_last4', CASE WHEN _use_waitlist_phone THEN right(w_digits, 4) END, 'identity_affirmed', true));

  RETURN jsonb_build_object('ok', true, 'already', false, 'application_id', a.id);
END $fn$;

REVOKE ALL ON FUNCTION public.resolve_waitlist_phone_conflict(uuid, uuid, boolean, text, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_waitlist_phone_conflict(uuid, uuid, boolean, text, text, text, uuid, text, text) TO service_role;