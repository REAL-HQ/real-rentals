-- PROPOSED — NOT APPLIED. Record Rental (existing-rental intake) + paper agreements.
-- Apply only after security 0031 is applied and no other unreviewed migration is pending.
-- Additive except one DROP NOT NULL (needs approval prompt): rentals.driver_id.

-- ── Part A: paper agreements on public.documents ─────────────────────────
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS rental_id uuid NULL REFERENCES public.rentals(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS signed_on date NULL,
  ADD COLUMN IF NOT EXISTS signature_type text NULL
    CHECK (signature_type IS NULL OR signature_type IN ('paper','esign'));
CREATE INDEX IF NOT EXISTS documents_rental_id_idx ON public.documents(rental_id) WHERE rental_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.documents_agreement_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.rental_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM rentals r WHERE r.id = NEW.rental_id AND r.application_id = NEW.driver_id)
  THEN RAISE EXCEPTION 'agreement_rental_wrong_driver'; END IF;
  IF NEW.signature_type = 'esign' AND COALESCE(NEW.source,'') <> 'esign'
  THEN RAISE EXCEPTION 'manual_upload_cannot_be_esign'; END IF;
  IF NEW.signed_on IS NOT NULL AND NEW.signed_on > (now() AT TIME ZONE 'America/New_York')::date
  THEN RAISE EXCEPTION 'signed_date_in_future'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.signature_type IS NOT NULL THEN
    IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN RAISE EXCEPTION 'agreement_driver_locked'; END IF;
    IF NEW.storage_path IS DISTINCT FROM OLD.storage_path OR NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket
    THEN RAISE EXCEPTION 'agreement_file_immutable'; END IF;
    IF OLD.rental_id IS NOT NULL AND NEW.rental_id IS DISTINCT FROM OLD.rental_id
    THEN RAISE EXCEPTION 'agreement_already_linked'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER documents_agreement_guard BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_agreement_guard();

CREATE OR REPLACE FUNCTION public.documents_agreement_no_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.signature_type IS NOT NULL THEN RAISE EXCEPTION 'signed_agreements_are_never_deleted'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER documents_agreement_no_delete BEFORE DELETE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_agreement_no_delete();

-- ── Part B: existing-rental intake ───────────────────────────────────────
-- Drivers recorded without a portal login have no auth user.
ALTER TABLE public.rentals ALTER COLUMN driver_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rentals_one_active_per_application_idx
  ON public.rentals(application_id) WHERE status = 'active' AND application_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rentals_stripe_subscription_uidx
  ON public.rentals(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_existing_rental_tx(
  _application_id uuid, _vehicle_id uuid, _start date, _weekly_rate numeric, _deposit numeric,
  _pickup_miles integer, _stripe_customer_id text, _stripe_subscription_id text,
  _next_payment_due date, _payments jsonb, _reason text, _actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_app record; v_veh record; v_rental uuid; v_missing text[]; v_hist integer; v_read uuid; p jsonb;
BEGIN
  IF NOT private.is_manager_user(_actor) THEN RAISE EXCEPTION 'forbidden'; END IF; -- helper to confirm name at build
  PERFORM set_config('app.rental_tx', 'on', true);
  IF _weekly_rate IS NULL OR _weekly_rate <= 0 THEN RAISE EXCEPTION 'no_weekly_rate'; END IF;
  IF _start > (now() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'future_pickup'; END IF;
  IF length(coalesce(_reason,'')) < 5 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT id, status, user_id INTO v_app FROM applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found'; END IF;
  IF v_app.status IN ('rejected','disqualified','closed') THEN RAISE EXCEPTION 'application_closed'; END IF;
  SELECT id, status, archived_at INTO v_veh FROM vehicles WHERE id = _vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found'; END IF;
  IF v_veh.archived_at IS NOT NULL OR v_veh.status IN ('archived','sold','retired') THEN RAISE EXCEPTION 'vehicle_unavailable'; END IF;
  v_missing := vehicle_rental_ready_missing(_vehicle_id);
  IF array_length(v_missing,1) > 0 THEN RAISE EXCEPTION 'vehicle_not_rental_ready:%', array_to_string(v_missing, ','); END IF;
  IF EXISTS (SELECT 1 FROM rentals WHERE vehicle_id = _vehicle_id AND status = 'active') THEN RAISE EXCEPTION 'vehicle_busy'; END IF;
  IF EXISTS (SELECT 1 FROM rentals WHERE status = 'active' AND (application_id = _application_id
             OR (v_app.user_id IS NOT NULL AND driver_id = v_app.user_id))) THEN RAISE EXCEPTION 'already_active'; END IF;
  IF EXISTS (SELECT 1 FROM rentals WHERE application_id = _application_id AND vehicle_id = _vehicle_id AND start_date = _start)
  THEN RAISE EXCEPTION 'duplicate_rental'; END IF;
  IF _stripe_subscription_id IS NOT NULL AND EXISTS (SELECT 1 FROM rentals WHERE stripe_subscription_id = _stripe_subscription_id)
  THEN RAISE EXCEPTION 'subscription_already_linked'; END IF;
  IF _pickup_miles IS NOT NULL THEN
    SELECT max(mileage) INTO v_hist FROM odometer_readings WHERE vehicle_id = _vehicle_id AND status = 'valid';
    IF v_hist IS NOT NULL AND _pickup_miles + 500 < v_hist THEN RAISE EXCEPTION 'pickup_below_history:%', v_hist; END IF;
  END IF;

  INSERT INTO rentals (driver_id, vehicle_id, application_id, start_date, end_date, status, weekly_rate,
    deposit_amount, deposit_held, next_payment_due, stripe_customer_id, stripe_subscription_id, autopay_active)
  VALUES (v_app.user_id, _vehicle_id, _application_id, _start, NULL, 'active', _weekly_rate,
    COALESCE(_deposit, 0), COALESCE(_deposit, 0) > 0, _next_payment_due, _stripe_customer_id,
    _stripe_subscription_id, _stripe_subscription_id IS NOT NULL)
  RETURNING id INTO v_rental;
  IF _pickup_miles IS NOT NULL THEN
    v_read := private.rental_mileage_reading(_vehicle_id, v_rental, v_app.user_id, _pickup_miles, 'rental_checkout', 'pre_delivery', _actor);
    UPDATE rentals SET pickup_reading_id = v_read WHERE id = v_rental;
  END IF;
  UPDATE vehicles SET status = 'rented' WHERE id = _vehicle_id;
  UPDATE applications SET status = 'active', vehicle_id = _vehicle_id WHERE id = _application_id;

  FOR p IN SELECT * FROM jsonb_array_elements(COALESCE(_payments, '[]'::jsonb)) LOOP
    INSERT INTO payments (rental_id, driver_id, vehicle_id, amount, balance_due, type, reason, status,
      due_date, paid_date, failure_reason, refunded_amount, stripe_invoice_id, stripe_payment_intent_id,
      stripe_subscription_id, notes)
    VALUES (v_rental, _application_id, _vehicle_id, (p->>'amount')::numeric,
      CASE WHEN p->>'status' = 'failed' THEN (p->>'amount')::numeric ELSE 0 END, 'rent', 'rent',
      p->>'status', (p->>'due_date')::date, (p->>'paid_date')::date, p->>'failure_reason',
      NULLIF((p->>'refunded_amount')::numeric, 0), p->>'stripe_invoice_id', p->>'stripe_payment_intent_id',
      _stripe_subscription_id, 'Imported at Record Rental' || COALESCE(' · charge ' || (p->>'stripe_charge_id'), ''))
    ON CONFLICT DO NOTHING;
  END LOOP;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details)
  VALUES (_actor, 'rental.recorded_existing', 'rental', v_rental, jsonb_build_object(
    'application_id', _application_id, 'vehicle_id', _vehicle_id, 'start', _start, 'weekly_rate', _weekly_rate,
    'deposit', _deposit, 'stripe_customer_id', _stripe_customer_id, 'stripe_subscription_id', _stripe_subscription_id,
    'payments_imported', jsonb_array_length(COALESCE(_payments,'[]'::jsonb)), 'reason', _reason));
  PERFORM set_config('app.rental_tx', 'off', true);
  RETURN v_rental;
END $$;
REVOKE ALL ON FUNCTION public.record_existing_rental_tx FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_existing_rental_tx TO service_role;
-- NOTE at build: confirm audit_log column names, the manager-check helper, and
-- that the Phase B Active trigger and payments status check accept these values.
