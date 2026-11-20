-- E-signed vehicle swap for an ACTIVE rental.
-- DO NOT apply to production until Dolmar approves. Applying it changes no
-- rental, vehicle or setting by itself: the feature stays off until the Owner
-- also sets app_settings key 'vehicle_swap' to {"enabled": true}
-- (docs/vehicle-swap-esign.md).
--
-- Replaces the never-installed M2 packet steps 19b / 19c / 20
-- (proposed/m2-packet/19b.sql, proposed/m2-with-approval-boundary/
-- 19c-agreement-contract.sql, proposed/m2-packet/20.sql on review/m2-packet-29d47ee3).
-- Those depend on ~20 earlier packet steps that production does not have
-- (booking_vehicle_assignments, private.record_operations,
-- private.approval_lock()/approval_actor(), the rr_record_executor role).
-- Checked read-only on Nov 20 2026: none of those objects, and no swap table,
-- sequence or function, exist on production. What is kept from step 20:
--   * lock order: rental row, then both vehicle rows lower uuid first, NOWAIT,
--     a held lock fails 40001 and the whole call rolls back;
--   * the rental pointer moves first (app.rental_tx on for that write only),
--     then the replacement becomes Rented, then the outgoing car's status;
--   * odometer readings get their own swap evidence keys (rental_checkout:<rental>
--     and rental_return:<rental> stay free for activation and End Rental);
--   * one audit_log row in the same transaction; no payment, invoice, deposit,
--     weekly rate, Stripe or autopay column is read or written.
--
-- Objects (all idempotent; re-running keeps one copy):
--   public.rental_vehicle_swap_number_seq   Swap # (S-1000, S-1001, ...)
--   public.rental_vehicle_swaps             one row per swap; staff read only
--   public.complete_rental_vehicle_swap_tx  the one writer of the vehicle change
--                                           (service_role only; the server
--                                           checks Manager/Owner first)
-- Rollback at the bottom (commented).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS public.rental_vehicle_swap_number_seq START WITH 1000 MINVALUE 1000;

CREATE TABLE IF NOT EXISTS public.rental_vehicle_swaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_number integer NOT NULL UNIQUE DEFAULT nextval('public.rental_vehicle_swap_number_seq'),
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  from_vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  to_vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code IN ('upgrade','downgrade','maintenance','damage','replacement','other')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 1000),
  status text NOT NULL DEFAULT 'pending_signature' CHECK (status IN (
    'pending_signature',  -- swap agreement sent, waiting for the renter to sign
    'signed',             -- signed; staff complete the handover
    'completed',          -- the rental now names to_vehicle_id
    'voided',             -- agreement voided/expired, or staff cancelled
    'send_failed'         -- the agreement could not be sent
  )),
  -- Rent printed on the swap agreement = the rental's rate when sent. Never changed by a swap.
  weekly_rate numeric(10,2) NOT NULL CHECK (weekly_rate > 0),
  agreement_id uuid REFERENCES public.agreements(id) ON DELETE SET NULL,
  -- What the swap follows: the e-signed original (agreement + its archived PDF)
  -- or a verified paper agreement filed through Agreement Filing (document only).
  previous_agreement_id uuid REFERENCES public.agreements(id) ON DELETE SET NULL,
  previous_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  requested_by uuid,
  requested_by_label text NOT NULL,
  idempotency_key text UNIQUE CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 8 AND 120),
  signed_at timestamptz,
  -- Handover (complete_rental_vehicle_swap_tx)
  completed_at timestamptz,
  completed_by uuid,
  from_vehicle_status text CHECK (from_vehicle_status IS NULL OR from_vehicle_status IN ('maintenance','available')),
  return_mileage integer CHECK (return_mileage IS NULL OR return_mileage BETWEEN 0 AND 1999999),
  pickup_mileage integer CHECK (pickup_mileage IS NULL OR pickup_mileage BETWEEN 0 AND 1999999),
  return_fuel text CHECK (return_fuel IS NULL OR length(return_fuel) <= 20),
  pickup_fuel text CHECK (pickup_fuel IS NULL OR length(pickup_fuel) <= 20),
  return_reading_id uuid REFERENCES public.odometer_readings(id) ON DELETE SET NULL,
  pickup_reading_id uuid REFERENCES public.odometer_readings(id) ON DELETE SET NULL,
  replaced_pickup_reading_id uuid REFERENCES public.odometer_readings(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_vehicle_swaps_different_car CHECK (from_vehicle_id <> to_vehicle_id),
  CONSTRAINT rental_vehicle_swaps_follows_something CHECK (previous_agreement_id IS NOT NULL OR previous_document_id IS NOT NULL),
  CONSTRAINT rental_vehicle_swaps_completed_shape CHECK (
    status <> 'completed' OR (completed_at IS NOT NULL AND from_vehicle_status IS NOT NULL AND signed_at IS NOT NULL))
);
ALTER SEQUENCE public.rental_vehicle_swap_number_seq OWNED BY public.rental_vehicle_swaps.swap_number;

-- One open swap per rental, and a replacement car can be promised to one open swap only.
CREATE UNIQUE INDEX IF NOT EXISTS rental_vehicle_swaps_one_open_per_rental
  ON public.rental_vehicle_swaps (rental_id) WHERE status IN ('pending_signature','signed');
CREATE UNIQUE INDEX IF NOT EXISTS rental_vehicle_swaps_one_open_per_vehicle
  ON public.rental_vehicle_swaps (to_vehicle_id) WHERE status IN ('pending_signature','signed');
CREATE INDEX IF NOT EXISTS rental_vehicle_swaps_agreement_idx ON public.rental_vehicle_swaps (agreement_id);
CREATE INDEX IF NOT EXISTS rental_vehicle_swaps_rental_idx ON public.rental_vehicle_swaps (rental_id, created_at);
CREATE INDEX IF NOT EXISTS rental_vehicle_swaps_from_vehicle_idx ON public.rental_vehicle_swaps (from_vehicle_id);
CREATE INDEX IF NOT EXISTS rental_vehicle_swaps_to_vehicle_idx ON public.rental_vehicle_swaps (to_vehicle_id);

ALTER TABLE public.rental_vehicle_swaps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read rental vehicle swaps" ON public.rental_vehicle_swaps;
CREATE POLICY "Staff read rental vehicle swaps" ON public.rental_vehicle_swaps
  FOR SELECT TO authenticated USING (private.is_staff());
-- Written only by the server (service role) and the function below.
REVOKE ALL ON public.rental_vehicle_swaps FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rental_vehicle_swaps FROM authenticated;
REVOKE ALL ON SEQUENCE public.rental_vehicle_swap_number_seq FROM anon, authenticated;

-- The one writer of a rental's vehicle change. Returns jsonb
--   { result: 'completed' | 'already_completed', swap_id, swap_number, rental_id,
--     from_vehicle_id, to_vehicle_id, from_vehicle_status, return_reading_id, pickup_reading_id }
-- Raises (no partial writes):
--   swap_not_found, swap_not_signed, swap_agreement_not_signed, rental_not_active,
--   rental_vehicle_changed, replacement_unavailable, replacement_on_other_rental,
--   replacement_not_rental_ready:<fields>, invalid_vehicle_status, invalid_mileage,
--   return_below_pickup:<miles>, return_below_history:<miles>, pickup_below_history:<miles>,
--   swap_contention (40001, retry the whole call).
CREATE OR REPLACE FUNCTION public.complete_rental_vehicle_swap_tx(
  _swap_id uuid,
  _from_vehicle_status text,
  _return_miles integer,
  _pickup_miles integer,
  _return_fuel text,
  _pickup_fuel text,
  _actor uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET lock_timeout = '2s' AS $$
DECLARE
  s public.rental_vehicle_swaps%ROWTYPE;
  r record;
  ag record;
  newv record;
  missing text[];
  v_pick integer;
  v_hist integer;
  v_return uuid;
  v_pickup uuid;
  v_today date := (now() AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF _from_vehicle_status IS NULL OR _from_vehicle_status NOT IN ('available','maintenance') THEN
    RAISE EXCEPTION 'invalid_vehicle_status';
  END IF;
  IF (_return_miles IS NOT NULL AND (_return_miles < 0 OR _return_miles > 1999999))
     OR (_pickup_miles IS NOT NULL AND (_pickup_miles < 0 OR _pickup_miles > 1999999)) THEN
    RAISE EXCEPTION 'invalid_mileage';
  END IF;

  BEGIN
    SELECT * INTO s FROM public.rental_vehicle_swaps WHERE id = _swap_id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'swap_contention' USING ERRCODE = '40001';
  END;
  IF NOT FOUND THEN RAISE EXCEPTION 'swap_not_found'; END IF;
  IF s.status = 'completed' THEN
    RETURN jsonb_build_object('result','already_completed','swap_id',s.id,'swap_number',s.swap_number,
      'rental_id',s.rental_id,'from_vehicle_id',s.from_vehicle_id,'to_vehicle_id',s.to_vehicle_id,
      'from_vehicle_status',s.from_vehicle_status,'return_reading_id',s.return_reading_id,'pickup_reading_id',s.pickup_reading_id);
  END IF;
  IF s.status <> 'signed' THEN RAISE EXCEPTION 'swap_not_signed'; END IF;

  -- The renter's signature on THIS swap's agreement, naming the replacement car.
  SELECT id, status, voided_at, signed_at, rental_id, vehicle_id, application_id, metadata
    INTO ag FROM public.agreements WHERE id = s.agreement_id;
  IF NOT FOUND OR ag.status <> 'signed' OR ag.voided_at IS NOT NULL OR ag.signed_at IS NULL
     OR ag.rental_id IS DISTINCT FROM s.rental_id OR ag.vehicle_id IS DISTINCT FROM s.to_vehicle_id
     OR ag.application_id IS DISTINCT FROM s.application_id
     OR (ag.metadata -> 'amendment' ->> 'swap_id') IS DISTINCT FROM s.id::text THEN
    RAISE EXCEPTION 'swap_agreement_not_signed';
  END IF;

  BEGIN
    SELECT id, status, vehicle_id, driver_id, application_id, pickup_reading_id
      INTO r FROM public.rentals WHERE id = s.rental_id FOR UPDATE NOWAIT;
    -- Both cars, lower uuid first, so two swaps cannot deadlock each other.
    PERFORM 1 FROM public.vehicles WHERE id IN (s.from_vehicle_id, s.to_vehicle_id) ORDER BY id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'swap_contention' USING ERRCODE = '40001';
  END;
  IF r.id IS NULL OR r.status <> 'active' THEN RAISE EXCEPTION 'rental_not_active'; END IF;
  IF r.vehicle_id IS DISTINCT FROM s.from_vehicle_id OR r.application_id IS DISTINCT FROM s.application_id THEN
    RAISE EXCEPTION 'rental_vehicle_changed';
  END IF;

  SELECT id, status, archived_at INTO newv FROM public.vehicles WHERE id = s.to_vehicle_id;
  IF NOT FOUND OR newv.archived_at IS NOT NULL OR newv.status IS DISTINCT FROM 'available' THEN
    RAISE EXCEPTION 'replacement_unavailable';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rentals x WHERE x.vehicle_id = s.to_vehicle_id AND x.id <> s.rental_id
             AND x.status IN ('reserved','on_hold','active')) THEN
    RAISE EXCEPTION 'replacement_on_other_rental';
  END IF;
  missing := public.vehicle_rental_ready_missing(s.to_vehicle_id);
  IF coalesce(array_length(missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'replacement_not_rental_ready:%', array_to_string(missing, ',');
  END IF;

  -- Odometer: same checks as End Rental for the outgoing car, history check for the replacement.
  IF _return_miles IS NOT NULL THEN
    SELECT mileage INTO v_pick FROM public.odometer_readings
     WHERE id = r.pickup_reading_id AND vehicle_id = s.from_vehicle_id;
    IF v_pick IS NOT NULL AND _return_miles < v_pick THEN RAISE EXCEPTION 'return_below_pickup:%', v_pick; END IF;
    SELECT max(mileage) INTO v_hist FROM public.odometer_readings WHERE vehicle_id = s.from_vehicle_id AND status = 'valid';
    IF v_hist IS NOT NULL AND _return_miles + 500 < v_hist THEN RAISE EXCEPTION 'return_below_history:%', v_hist; END IF;
    INSERT INTO public.odometer_readings(vehicle_id, mileage, observed_on, observed_at, source_type, source_id,
                                         evidence_key, entered_by, rental_id, driver_id, note)
    VALUES (s.from_vehicle_id, _return_miles, v_today, now(), 'rental_return', s.id,
            'swap_return:' || s.id::text, _actor, s.rental_id, r.driver_id, 'Vehicle swap S-' || s.swap_number::text)
    RETURNING id INTO v_return;
  END IF;
  IF _pickup_miles IS NOT NULL THEN
    SELECT max(mileage) INTO v_hist FROM public.odometer_readings WHERE vehicle_id = s.to_vehicle_id AND status = 'valid';
    IF v_hist IS NOT NULL AND _pickup_miles + 500 < v_hist THEN RAISE EXCEPTION 'pickup_below_history:%', v_hist; END IF;
    INSERT INTO public.odometer_readings(vehicle_id, mileage, observed_on, observed_at, source_type, source_id,
                                         evidence_key, entered_by, rental_id, driver_id, note)
    VALUES (s.to_vehicle_id, _pickup_miles, v_today, now(), 'rental_checkout', s.id,
            'swap_checkout:' || s.id::text, _actor, s.rental_id, r.driver_id, 'Vehicle swap S-' || s.swap_number::text)
    RETURNING id INTO v_pickup;
  END IF;

  -- 1. Rental pointer (guard_rental_lifecycle allows it only inside app.rental_tx).
  --    The pickup reading follows the car, so End Rental compares the return
  --    against the replacement's pickup, not the old car's.
  PERFORM set_config('app.rental_tx', 'on', true);
  UPDATE public.rentals
     SET vehicle_id = s.to_vehicle_id,
         pickup_reading_id = v_pickup
   WHERE id = s.rental_id AND status = 'active' AND vehicle_id = s.from_vehicle_id;
  IF NOT FOUND THEN
    PERFORM set_config('app.rental_tx', 'off', true);
    RAISE EXCEPTION 'rental_vehicle_changed';
  END IF;
  PERFORM set_config('app.rental_tx', 'off', true);
  -- Later agreements, resends and the portal read the application's car too.
  UPDATE public.applications SET vehicle_id = s.to_vehicle_id
   WHERE id = s.application_id AND vehicle_id IS NOT DISTINCT FROM s.from_vehicle_id;

  -- 2. Replacement Rented (guard_vehicle_rented_status: allowed now that the rental names it).
  UPDATE public.vehicles SET status = 'rented' WHERE id = s.to_vehicle_id AND status = 'available';
  IF NOT FOUND THEN RAISE EXCEPTION 'replacement_unavailable'; END IF;
  -- 3. Outgoing car back to the fleet, the same choice End Rental offers.
  UPDATE public.vehicles SET status = _from_vehicle_status WHERE id = s.from_vehicle_id;

  UPDATE public.rental_vehicle_swaps
     SET status = 'completed', completed_at = now(), completed_by = _actor,
         from_vehicle_status = _from_vehicle_status,
         return_mileage = _return_miles, pickup_mileage = _pickup_miles,
         return_fuel = nullif(btrim(coalesce(_return_fuel, '')), ''),
         pickup_fuel = nullif(btrim(coalesce(_pickup_fuel, '')), ''),
         return_reading_id = v_return, pickup_reading_id = v_pickup,
         replaced_pickup_reading_id = r.pickup_reading_id,
         updated_at = now()
   WHERE id = s.id;

  INSERT INTO public.audit_log(actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata)
  VALUES (_actor,
          (SELECT string_agg(role::text, ',' ORDER BY role::text) FROM public.user_roles WHERE user_id = _actor),
          'rental.vehicle_swapped', 'rental', s.rental_id::text,
          'Vehicle swap S-' || s.swap_number::text || ' completed; billing unchanged',
          jsonb_build_object('swap_id', s.id, 'swap_number', s.swap_number, 'agreement_id', s.agreement_id,
            'from_vehicle_id', s.from_vehicle_id, 'to_vehicle_id', s.to_vehicle_id,
            'from_vehicle_status', _from_vehicle_status, 'return_miles', _return_miles, 'pickup_miles', _pickup_miles,
            'return_fuel', _return_fuel, 'pickup_fuel', _pickup_fuel, 'billing', 'unchanged'));

  RETURN jsonb_build_object('result','completed','swap_id',s.id,'swap_number',s.swap_number,
    'rental_id',s.rental_id,'from_vehicle_id',s.from_vehicle_id,'to_vehicle_id',s.to_vehicle_id,
    'from_vehicle_status',_from_vehicle_status,'return_reading_id',v_return,'pickup_reading_id',v_pickup);
END $$;

REVOKE ALL ON FUNCTION public.complete_rental_vehicle_swap_tx(uuid,text,integer,integer,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_rental_vehicle_swap_tx(uuid,text,integer,integer,text,text,uuid) TO service_role;

COMMENT ON TABLE public.rental_vehicle_swaps IS
  'E-signed vehicle swaps for active rentals (src/lib/vehicle-swap.server.ts). Off until app_settings vehicle_swap.enabled = true.';

COMMIT;

-- ROLLBACK (only objects this file created; run only if no swap was completed,
-- since completed swaps already moved rentals to their replacement car):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.complete_rental_vehicle_swap_tx(uuid,text,integer,integer,text,text,uuid);
-- DROP TABLE IF EXISTS public.rental_vehicle_swaps;
-- DROP SEQUENCE IF EXISTS public.rental_vehicle_swap_number_seq;
-- DELETE FROM public.app_settings WHERE key = 'vehicle_swap';
-- COMMIT;
