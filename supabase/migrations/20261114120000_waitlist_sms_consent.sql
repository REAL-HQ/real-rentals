-- Waitlist SMS consent (Automation Blueprint, Nov 14 2026).
--
-- The waitlist form (city pages when Cars Available = 0) now shows the same
-- optional, unchecked SMS opt-in as Step 1. Its evidence is stored on the
-- waitlist row and carried onto the application when the entry is promoted,
-- so the site's follow-up texts (which only go to applications with
-- sms_consent = true and no sms_opt_out_at) reach waitlist leads who opted in.
-- Before this, promote_waitlist_entry always inserted sms_consent = false.
--
-- promote_waitlist_entry below is the live production definition (read
-- 2026-11-14) with only the consent lines added. Additive and idempotent.

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS sms_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_consent_source text,
  ADD COLUMN IF NOT EXISTS sms_consent_version text,
  ADD COLUMN IF NOT EXISTS sms_consent_text text,
  ADD COLUMN IF NOT EXISTS sms_consent_phone text,
  ADD COLUMN IF NOT EXISTS sms_consent_page text;

CREATE OR REPLACE FUNCTION public.promote_waitlist_entry(_entry uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  w public.waitlist%ROWTYPE;
  email_app uuid; phone_app uuid; app_id uuid;
  digits text; email_phone text;
BEGIN
  SELECT * INTO w FROM public.waitlist WHERE id = _entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'waitlist entry not found'; END IF;
  IF w.promoted_application_id IS NOT NULL THEN
    RETURN jsonb_build_object('application_id', w.promoted_application_id, 'created', false, 'already', true);
  END IF;
  digits := right(regexp_replace(coalesce(w.phone, ''), '\D', '', 'g'), 10);

  SELECT a.id, right(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), 10) INTO email_app, email_phone
    FROM public.applications a
   WHERE a.status <> 'duplicate' AND lower(a.email) = lower(w.email)
   ORDER BY (a.primary_application_id IS NULL OR a.primary_application_id = a.id) DESC, a.created_at ASC LIMIT 1;
  IF length(digits) = 10 THEN
    SELECT a.id INTO phone_app FROM public.applications a
     WHERE a.status <> 'duplicate' AND right(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), 10) = digits
       AND (email_app IS NULL OR a.id <> email_app)
       AND coalesce(a.primary_application_id, a.id) <> coalesce((SELECT primary_application_id FROM public.applications WHERE id = email_app), email_app, '00000000-0000-0000-0000-000000000000'::uuid)
     ORDER BY a.created_at ASC LIMIT 1;
  END IF;

  -- Ambiguous identity: never auto-merge. Flag for a human.
  IF phone_app IS NOT NULL AND email_app IS NULL THEN
    UPDATE public.waitlist SET review_reason = 'phone_only_match', review_flagged_at = now() WHERE id = w.id;
    RETURN jsonb_build_object('needs_review', true, 'reason', 'phone_only_match');
  END IF;
  IF phone_app IS NOT NULL AND email_app IS NOT NULL THEN
    UPDATE public.waitlist SET review_reason = 'email_phone_conflict', review_flagged_at = now() WHERE id = w.id;
    RETURN jsonb_build_object('needs_review', true, 'reason', 'email_phone_conflict');
  END IF;
  IF email_app IS NOT NULL AND length(digits) = 10 AND length(email_phone) = 10 AND email_phone <> digits THEN
    UPDATE public.waitlist SET review_reason = 'email_match_phone_differs', review_flagged_at = now() WHERE id = w.id;
    RETURN jsonb_build_object('needs_review', true, 'reason', 'email_match_phone_differs');
  END IF;

  IF email_app IS NOT NULL THEN
    app_id := email_app;
    UPDATE public.applications
       SET waitlist_signed_up_at = coalesce(waitlist_signed_up_at, w.created_at),
           waitlist_source = coalesce(waitlist_source, w.source)
     WHERE id = app_id;
    -- Carry the waitlist SMS opt-in onto the matched application, but only
    -- when that application has no consent, no opt-out, and the same phone.
    IF w.sms_consent IS TRUE AND length(digits) = 10 AND email_phone = digits THEN
      UPDATE public.applications
         SET sms_consent = true,
             sms_consent_at = w.sms_consent_at,
             sms_consent_source = w.sms_consent_source,
             sms_consent_version = w.sms_consent_version,
             sms_consent_text = w.sms_consent_text,
             sms_consent_phone = w.sms_consent_phone,
             sms_consent_page = w.sms_consent_page
       WHERE id = app_id
         AND coalesce(sms_consent, false) = false
         AND sms_opt_out_at IS NULL;
    END IF;
    UPDATE public.waitlist SET status = 'promoted', promoted_application_id = app_id, promoted_at = now(), review_reason = NULL, review_flagged_at = NULL WHERE id = w.id;
    RETURN jsonb_build_object('application_id', app_id, 'created', false, 'already', false);
  END IF;

  INSERT INTO public.applications (full_name, email, phone, city, state, market_id, pickup_date, sms_consent,
      sms_consent_at, sms_consent_source, sms_consent_version, sms_consent_text, sms_consent_phone, sms_consent_page,
      source, status, current_step, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid,
      waitlist_signed_up_at, waitlist_source)
  VALUES (w.full_name, w.email, w.phone, w.city, w.state, w.market_id, w.pickup_date, coalesce(w.sms_consent, false),
      CASE WHEN w.sms_consent THEN w.sms_consent_at END, CASE WHEN w.sms_consent THEN w.sms_consent_source END,
      CASE WHEN w.sms_consent THEN w.sms_consent_version END, CASE WHEN w.sms_consent THEN w.sms_consent_text END,
      CASE WHEN w.sms_consent THEN w.sms_consent_phone END, CASE WHEN w.sms_consent THEN w.sms_consent_page END,
      coalesce(w.source, 'waitlist'), 'new', 'rental', w.utm_source, w.utm_medium, w.utm_campaign, w.utm_content, w.utm_term, w.gclid,
      w.created_at, w.source)
  RETURNING id INTO app_id;
  UPDATE public.waitlist SET status = 'promoted', promoted_application_id = app_id, promoted_at = now(), review_reason = NULL, review_flagged_at = NULL WHERE id = w.id;
  RETURN jsonb_build_object('application_id', app_id, 'created', true, 'already', false);
END $function$
;

REVOKE ALL ON FUNCTION public.promote_waitlist_entry(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_waitlist_entry(uuid) TO service_role;
