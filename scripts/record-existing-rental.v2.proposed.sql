-- PROPOSED v2 — NOT APPLIED, NOT A MIGRATION. Supersedes record-existing-rental.proposed.sql (Part B).
-- Packaging: after 0031 and Paper Agreements; folded into the Numbering/History migration.
-- Changes from v1:
--   * Authorization: caller identity is auth.uid() (the signed-in staff JWT), checked with the
--     existing private.is_manager(). No _actor parameter. EXECUTE granted to authenticated so the
--     server function calls it with the user's own client; Drivers/Coordinators/anon are refused
--     inside the function, so direct RPC cannot bypass. service_role has NO execute.
--   * Eligibility: approved application, no open identity review, license number + unexpired
--     license, license front+back documents on file, application not deleted.
--   * Payments: idempotent per provider id; exact retry = no-op, conflicting duplicate = error.
--   * driver_id may be NULL only when application_id is set (CHECK), and only via this function.

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS stripe_charge_id text;
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_charge_uidx
  ON public.payments (stripe_charge_id) WHERE stripe_charge_id IS NOT NULL;
-- Existing (verified read-only Oct 16, 2026): unique partial indexes on payments.stripe_invoice_id,
-- payments.stripe_payment_intent_id (each duplicated once — cleanup later, harmless) and
-- rentals.stripe_subscription_id. Not recreated here.

ALTER TABLE public.rentals ALTER COLUMN driver_id DROP NOT NULL;   -- approval prompt required
ALTER TABLE public.rentals ADD CONSTRAINT rentals_person_required
  CHECK (driver_id IS NOT NULL OR application_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS rentals_one_active_per_application_idx
  ON public.rentals(application_id) WHERE status = 'active' AND application_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_existing_rental_tx(
  _application_id uuid, _vehicle_id uuid, _start date, _weekly_rate numeric, _deposit numeric,
  _pickup_miles integer, _stripe_customer_id text, _stripe_subscription_id text,
  _next_payment_due date, _payments jsonb, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_app record; v_veh record; v_rental uuid; v_missing text[]; v_hist integer; v_read uuid;
  p jsonb; v_existing record; v_today date := (now() AT TIME ZONE 'America/New_York')::date;
BEGIN
  -- 1. Authorization (fail closed)
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF private.is_manager() IS NOT TRUE THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- 2. Input
  IF _weekly_rate IS NULL OR _weekly_rate <= 0 THEN RAISE EXCEPTION 'no_weekly_rate'; END IF;
  IF _start > v_today THEN RAISE EXCEPTION 'future_pickup'; END IF;
  IF length(coalesce(trim(_reason),'')) < 5 THEN RAISE EXCEPTION 'reason_required'; END IF;

  -- 3. Driver eligibility (identity is never relaxed; only the portal login is optional)
  SELECT id, status, user_id, deleted_at, license_number, license_expiration
    INTO v_app FROM applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND OR v_app.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'application_not_found'; END IF;
  IF v_app.status <> 'approved' THEN RAISE EXCEPTION 'application_not_approved'; END IF;
  IF EXISTS (SELECT 1 FROM application_identity_reviews
             WHERE application_id = _application_id AND status = 'open')
    THEN RAISE EXCEPTION 'identity_review_open'; END IF;
  IF EXISTS (SELECT 1 FROM application_identity_reviews
             WHERE application_id = _application_id AND resolution = 'different_person')
    THEN RAISE EXCEPTION 'identity_conflict'; END IF;
  IF v_app.license_number IS NULL OR v_app.license_expiration IS NULL OR v_app.license_expiration < v_today
    THEN RAISE EXCEPTION 'license_missing_or_expired'; END IF;
  IF (SELECT count(DISTINCT category) FROM documents
      WHERE driver_id = _application_id AND category IN ('license_front','license_back')) < 2
    THEN RAISE EXCEPTION 'license_documents_missing'; END IF;
  -- documents has no soft-delete column (verified Oct 16, 2026).

  -- 4. Vehicle readiness and conflicts
  SELECT id, status, archived_at INTO v_veh FROM vehicles WHERE id = _vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found'; END IF;
  IF v_veh.archived_at IS NOT NULL OR v_veh.status IN ('archived','sold','retired') THEN RAISE EXCEPTION 'vehicle_unavailable'; END IF;
  v_missing := vehicle_rental_ready_missing(_vehicle_id);
  IF coalesce(array_length(v_missing,1),0) > 0 THEN RAISE EXCEPTION 'vehicle_not_rental_ready:%', array_to_string(v_missing, ','); END IF;
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

  -- 5. Writes (lifecycle triggers accept only this flag)
  PERFORM set_config('app.rental_tx', 'on', true);
  INSERT INTO rentals (driver_id, vehicle_id, application_id, start_date, end_date, status, weekly_rate,
    deposit_amount, deposit_held, next_payment_due, stripe_customer_id, stripe_subscription_id, autopay_active)
  VALUES (v_app.user_id, _vehicle_id, _application_id, _start, NULL, 'active', _weekly_rate,
    COALESCE(_deposit, 0), COALESCE(_deposit, 0) > 0, _next_payment_due, _stripe_customer_id,
    _stripe_subscription_id, _stripe_subscription_id IS NOT NULL)
  RETURNING id INTO v_rental;
  -- Numbering + booking_vehicle_assignments insert go here in the combined migration.

  IF _pickup_miles IS NOT NULL THEN
    -- Verified deployed signature (Oct 16, 2026):
    -- private.rental_mileage_reading(uuid,uuid,uuid,integer,text,text,uuid), SECURITY DEFINER.
    -- _driver may be NULL: odometer_readings.driver_id is nullable (verified).
    v_read := private.rental_mileage_reading(_vehicle_id, v_rental, v_app.user_id, _pickup_miles,
                                             'rental_checkout', 'pre_delivery', v_actor);
    UPDATE rentals SET pickup_reading_id = v_read WHERE id = v_rental;
  END IF;
  UPDATE vehicles SET status = 'rented' WHERE id = _vehicle_id;
  UPDATE applications SET status = 'active', vehicle_id = _vehicle_id WHERE id = _application_id;

  -- 6. Historical payments: exact retry = no-op; any difference = hard failure (whole tx rolls back)
  FOR p IN SELECT * FROM jsonb_array_elements(COALESCE(_payments, '[]'::jsonb)) LOOP
    IF coalesce(p->>'stripe_invoice_id', p->>'stripe_payment_intent_id', p->>'stripe_charge_id') IS NULL
      THEN RAISE EXCEPTION 'payment_without_provider_id'; END IF;
    IF p->>'status' NOT IN ('paid','failed','refunded','partially_refunded')
      THEN RAISE EXCEPTION 'payment_status_invalid'; END IF;
    SELECT id, rental_id, amount, status, refunded_amount INTO v_existing FROM payments
     WHERE stripe_invoice_id = p->>'stripe_invoice_id'
        OR stripe_payment_intent_id = p->>'stripe_payment_intent_id'
        OR stripe_charge_id = p->>'stripe_charge_id'
     LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      IF v_existing.rental_id IS DISTINCT FROM v_rental
         OR v_existing.amount <> (p->>'amount')::numeric
         OR v_existing.status <> p->>'status'
         OR coalesce(v_existing.refunded_amount,0) <> coalesce((p->>'refunded_amount')::numeric,0)
      THEN RAISE EXCEPTION 'payment_conflict:%', v_existing.id; END IF;
      CONTINUE;  -- identical: never counted twice
    END IF;
    INSERT INTO payments (rental_id, driver_id, vehicle_id, amount, balance_due, type, reason, status,
      due_date, paid_date, failure_reason, refunded_amount, stripe_invoice_id, stripe_payment_intent_id,
      stripe_charge_id, stripe_subscription_id, notes)
    VALUES (v_rental, _application_id, _vehicle_id, (p->>'amount')::numeric,
      CASE WHEN p->>'status' = 'failed' THEN (p->>'amount')::numeric ELSE 0 END, 'rent', 'rent',
      p->>'status', (p->>'due_date')::date, (p->>'paid_date')::date, p->>'failure_reason',
      NULLIF((p->>'refunded_amount')::numeric, 0), p->>'stripe_invoice_id', p->>'stripe_payment_intent_id',
      p->>'stripe_charge_id', _stripe_subscription_id, 'Imported at Record Rental');
  END LOOP;

  INSERT INTO audit_log (actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata)
  VALUES (v_actor, (SELECT string_agg(role::text, ',') FROM user_roles WHERE user_id = v_actor),
    'rental.recorded_existing', 'rental', v_rental, 'Recorded existing rental', jsonb_build_object(
    'application_id', _application_id, 'vehicle_id', _vehicle_id, 'start', _start, 'weekly_rate', _weekly_rate,
    'deposit', _deposit, 'stripe_customer_id', _stripe_customer_id, 'stripe_subscription_id', _stripe_subscription_id,
    'payments_submitted', jsonb_array_length(COALESCE(_payments,'[]'::jsonb)), 'reason', _reason));
  PERFORM set_config('app.rental_tx', 'off', true);
  RETURN v_rental;
END $$;
REVOKE ALL ON FUNCTION public.record_existing_rental_tx(uuid,uuid,date,numeric,numeric,integer,text,text,date,jsonb,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_existing_rental_tx(uuid,uuid,date,numeric,numeric,integer,text,text,date,jsonb,text)
  TO authenticated;
