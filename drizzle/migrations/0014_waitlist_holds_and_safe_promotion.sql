ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS waitlist_signed_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS waitlist_source text;

CREATE TABLE public.application_waitlist_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid NOT NULL,
  removed_at timestamptz,
  removed_by uuid,
  CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);
CREATE UNIQUE INDEX application_waitlist_holds_one_active
  ON public.application_waitlist_holds (application_id) WHERE removed_at IS NULL;
CREATE INDEX application_waitlist_holds_app ON public.application_waitlist_holds (application_id, added_at DESC);

GRANT SELECT ON public.application_waitlist_holds TO authenticated;
GRANT ALL ON public.application_waitlist_holds TO service_role;
ALTER TABLE public.application_waitlist_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read waitlist holds" ON public.application_waitlist_holds
  FOR SELECT TO authenticated USING (private.is_staff());

-- History is append/close only: no deletes, and a closed hold never reopens.
CREATE OR REPLACE FUNCTION public.waitlist_holds_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Waitlist history cannot be deleted'; END IF;
  IF OLD.removed_at IS NOT NULL THEN RAISE EXCEPTION 'A closed waitlist hold is immutable'; END IF;
  IF NEW.application_id <> OLD.application_id OR NEW.added_at <> OLD.added_at OR NEW.added_by <> OLD.added_by THEN
    RAISE EXCEPTION 'Only removal may be recorded on a waitlist hold';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER waitlist_holds_guard BEFORE UPDATE OR DELETE ON public.application_waitlist_holds
  FOR EACH ROW EXECUTE FUNCTION public.waitlist_holds_guard();

-- Atomic, idempotent promotion: reuse an existing applicant, never duplicate.
CREATE OR REPLACE FUNCTION public.promote_waitlist_entry(_entry uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w public.waitlist%ROWTYPE;
  app_id uuid;
  digits text;
BEGIN
  SELECT * INTO w FROM public.waitlist WHERE id = _entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'waitlist entry not found'; END IF;
  IF w.promoted_application_id IS NOT NULL THEN
    RETURN jsonb_build_object('application_id', w.promoted_application_id, 'created', false, 'already', true);
  END IF;
  digits := right(regexp_replace(coalesce(w.phone, ''), '\D', '', 'g'), 10);
  SELECT a.id INTO app_id FROM public.applications a
   WHERE a.status <> 'duplicate'
     AND (lower(a.email) = lower(w.email)
          OR (length(digits) = 10 AND right(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), 10) = digits))
   ORDER BY (a.primary_application_id IS NULL OR a.primary_application_id = a.id) DESC, a.created_at ASC
   LIMIT 1;
  IF app_id IS NOT NULL THEN
    UPDATE public.applications
       SET waitlist_signed_up_at = coalesce(waitlist_signed_up_at, w.created_at),
           waitlist_source = coalesce(waitlist_source, w.source)
     WHERE id = app_id;
    UPDATE public.waitlist SET status = 'promoted', promoted_application_id = app_id, promoted_at = now() WHERE id = w.id;
    RETURN jsonb_build_object('application_id', app_id, 'created', false, 'already', false);
  END IF;
  INSERT INTO public.applications (full_name, email, phone, city, state, market_id, pickup_date, sms_consent,
      source, status, current_step, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid,
      waitlist_signed_up_at, waitlist_source)
  VALUES (w.full_name, w.email, w.phone, w.city, w.state, w.market_id, w.pickup_date, false,
      coalesce(w.source, 'waitlist'), 'new', 'rental', w.utm_source, w.utm_medium, w.utm_campaign, w.utm_content, w.utm_term, w.gclid,
      w.created_at, w.source)
  RETURNING id INTO app_id;
  UPDATE public.waitlist SET status = 'promoted', promoted_application_id = app_id, promoted_at = now() WHERE id = w.id;
  RETURN jsonb_build_object('application_id', app_id, 'created', true, 'already', false);
END $$;
REVOKE ALL ON FUNCTION public.promote_waitlist_entry(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_waitlist_entry(uuid) TO service_role;