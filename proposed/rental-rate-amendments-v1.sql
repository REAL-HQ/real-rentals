-- PROPOSED, NOT APPLIED. Needs Dolmar's approval before it runs on production.
--
-- Updated / amended rental agreements for an ACTIVE rental, including a weekly
-- rate change (src/lib/rental-amendment.server.ts, docs/fleet-amend-agreement.md).
--
--   * public.rental_rate_amendments: one row per proposed change. The new rate
--     is only PENDING here until the renter signs the amended agreement; the
--     rental keeps its current rate and billing until then.
--   * public.apply_rental_rate_amendment(id, today): the only writer of the
--     new rate. Runs after signing (and from the 5-minute automations cron for
--     a future effective date). Refuses unless the amendment is signed, the
--     apply date has arrived, the rental is still active and still at the old
--     rate. Never back-dates: the apply date is fixed at signing and is never
--     before the signing day.
--   * fleet_webhook_deliveries: allows the new event agreement_amendment_signed
--     (keeps every event allowed today).
--
-- Written only by the server (service role). Staff can read. Additive; sends
-- nothing and changes no rental by itself. Rollback at the bottom.
BEGIN;

CREATE TABLE IF NOT EXISTS public.rental_rate_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  old_weekly_rate numeric(10,2) NOT NULL CHECK (old_weekly_rate > 0),
  new_weekly_rate numeric(10,2) NOT NULL CHECK (new_weekly_rate > 0),
  effective_date date NOT NULL,
  -- Set at signing: max(effective_date, signing day), or the next rent due
  -- date when the effective date had already passed. Never before signing.
  apply_on date,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 1000),
  -- { channel, received_at, quote, message_id?, call_id?, quo_event_id?, verified, recorded_by }
  renter_consent jsonb,
  status text NOT NULL DEFAULT 'pending_signature' CHECK (status IN (
    'pending_signature',  -- agreement sent, waiting for the renter to sign
    'signed',             -- signed; rate applies on apply_on
    'applied',            -- rentals.weekly_rate changed
    'conflict',           -- rental changed (ended / rate edited) before it applied: staff
    'voided',             -- the amended agreement was voided or expired unsigned
    'send_failed'         -- the agreement could not be sent
  )),
  source text NOT NULL CHECK (source IN ('fleet', 'staff')),
  requested_by text NOT NULL,
  requested_by_user uuid,
  out_of_bounds_ack boolean NOT NULL DEFAULT false,
  agreement_id uuid REFERENCES public.agreements(id) ON DELETE SET NULL,
  previous_agreement_id uuid REFERENCES public.agreements(id) ON DELETE SET NULL,
  idempotency_key text UNIQUE CHECK (idempotency_key IS NULL OR length(idempotency_key) <= 120),
  stripe_update_required boolean NOT NULL DEFAULT false,
  signed_at timestamptz,
  applied_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_rate_amendments_rate_changes CHECK (new_weekly_rate <> old_weekly_rate),
  -- A rate increase needs logged renter consent (plus the signature).
  CONSTRAINT rental_rate_amendments_increase_consent CHECK (
    new_weekly_rate < old_weekly_rate OR renter_consent IS NOT NULL)
);
-- At most one open (unsigned) amendment per rental.
CREATE UNIQUE INDEX IF NOT EXISTS rental_rate_amendments_one_open_idx
  ON public.rental_rate_amendments (rental_id) WHERE status = 'pending_signature';
CREATE INDEX IF NOT EXISTS rental_rate_amendments_agreement_idx
  ON public.rental_rate_amendments (agreement_id);
CREATE INDEX IF NOT EXISTS rental_rate_amendments_due_idx
  ON public.rental_rate_amendments (apply_on) WHERE status = 'signed';

ALTER TABLE public.rental_rate_amendments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read rental rate amendments" ON public.rental_rate_amendments;
CREATE POLICY "Staff read rental rate amendments" ON public.rental_rate_amendments
  FOR SELECT TO authenticated USING (private.is_staff());
REVOKE ALL ON public.rental_rate_amendments FROM anon;

-- The one place the new rate is written. Returns 'applied' | 'already_applied'
-- | 'not_due' | 'not_signed' | 'waiting_prior_weeks' | 'week_in_progress'
-- | 'conflict' | 'not_found'. Never touches payments, Stripe, deposits or fees.
CREATE OR REPLACE FUNCTION public.apply_rental_rate_amendment(_id uuid, _today date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; r record; found_rental boolean;
BEGIN
  SELECT * INTO a FROM public.rental_rate_amendments WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF a.status = 'applied' THEN RETURN 'already_applied'; END IF;
  IF a.status <> 'signed' OR a.signed_at IS NULL OR a.apply_on IS NULL THEN RETURN 'not_signed'; END IF;
  IF a.apply_on > _today THEN RETURN 'not_due'; END IF;
  SELECT id, status, weekly_rate, next_payment_due INTO r FROM public.rentals WHERE id = a.rental_id FOR UPDATE;
  found_rental := FOUND;
  IF NOT found_rental OR r.status <> 'active' THEN
    UPDATE public.rental_rate_amendments SET status = 'conflict', updated_at = now(), note = 'Rental is no longer active.' WHERE id = _id;
    RETURN 'conflict';
  END IF;
  IF r.weekly_rate IS DISTINCT FROM a.old_weekly_rate THEN
    UPDATE public.rental_rate_amendments SET status = 'conflict', updated_at = now(), note = 'Rental weekly rate changed since the amendment was sent.' WHERE id = _id;
    RETURN 'conflict';
  END IF;
  -- Only future, unbilled rent weeks get the new rate. A week due before the
  -- apply date that is still open (renter behind), or the current week that
  -- already has a rent payment against it (part-paid), keeps the old rate:
  -- wait (the cron retries) until those weeks are settled. Paid weeks,
  -- week 1 included, are never re-priced or re-billed.
  IF r.next_payment_due IS NOT NULL AND r.next_payment_due < a.apply_on THEN RETURN 'waiting_prior_weeks'; END IF;
  IF r.next_payment_due IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.payments p
     WHERE p.rental_id = r.id AND p.due_date = r.next_payment_due
       AND p.status = 'paid' AND COALESCE(p.type, 'rent') = 'rent') THEN
    RETURN 'week_in_progress';
  END IF;
  UPDATE public.rentals SET weekly_rate = a.new_weekly_rate, updated_at = now() WHERE id = a.rental_id;
  UPDATE public.applications SET weekly_rent = a.new_weekly_rate WHERE id = a.application_id;
  UPDATE public.rental_rate_amendments SET status = 'applied', applied_at = now(), updated_at = now() WHERE id = _id;
  RETURN 'applied';
END $$;
REVOKE ALL ON FUNCTION public.apply_rental_rate_amendment(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_rental_rate_amendment(uuid, date) TO service_role;

ALTER TABLE public.fleet_webhook_deliveries
  DROP CONSTRAINT IF EXISTS fleet_webhook_deliveries_event_type_check;
ALTER TABLE public.fleet_webhook_deliveries
  ADD CONSTRAINT fleet_webhook_deliveries_event_type_check CHECK (event_type IN (
    'lead_created','stage_changed',
    'quo_message_received','quo_call','quo_voicemail','quo_transcript',
    'agreement_signed_by_renter','application_ready_for_review','reservation_confirmed',
    'documents_uploaded','payment_succeeded','payment_failed','agreement_delivery_failed',
    'pickup_checklist_completed','rental_activated','rental_returned','rental_ended',
    'agreement_amendment_signed'
  ));

COMMIT;

-- The Automations switch "Updated Agreements (FLEET)" (rental_agreement_amendments)
-- stays OFF until an Owner turns it on in Back Office -> Automations. This file
-- does not turn it on.

-- Rollback (after reverting the code; until then the endpoint answers 503 and sends nothing):
-- BEGIN;
-- DELETE FROM public.fleet_webhook_deliveries WHERE event_type = 'agreement_amendment_signed';
-- ALTER TABLE public.fleet_webhook_deliveries DROP CONSTRAINT fleet_webhook_deliveries_event_type_check;
-- ALTER TABLE public.fleet_webhook_deliveries ADD CONSTRAINT fleet_webhook_deliveries_event_type_check CHECK (event_type IN (
--   'lead_created','stage_changed','quo_message_received','quo_call','quo_voicemail','quo_transcript',
--   'agreement_signed_by_renter','application_ready_for_review','reservation_confirmed',
--   'documents_uploaded','payment_succeeded','payment_failed','agreement_delivery_failed',
--   'pickup_checklist_completed','rental_activated','rental_returned','rental_ended'));
-- DROP FUNCTION IF EXISTS public.apply_rental_rate_amendment(uuid, date);
-- DROP TABLE IF EXISTS public.rental_rate_amendments;
-- COMMIT;
