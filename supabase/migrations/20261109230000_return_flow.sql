-- Guided Return / End Rental closeout.
-- Adds return checklist tables, balance-due tracking, photo skip reason,
-- and stops end_rental_tx from closing the application (past renters keep portal access).
-- DO NOT apply until Dolmar approves publishing this PR.

ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS balance_due_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS return_photos_skipped_reason text,
  ADD COLUMN IF NOT EXISTS final_invoice_id text,
  ADD COLUMN IF NOT EXISTS final_invoice_url text;

COMMENT ON COLUMN public.rentals.balance_due_cents IS
  'Cents still owed after Return completes. Past tab shows Balance Due when > 0.';
COMMENT ON COLUMN public.rentals.return_photos_skipped_reason IS
  'When return photos were skipped, the staff reason. Null when photos were uploaded.';
COMMENT ON COLUMN public.rentals.final_invoice_id IS
  'Stripe invoice id for a confirmed final invoice, when created for this customer.';
COMMENT ON COLUMN public.rentals.final_invoice_url IS
  'Hosted invoice URL for the renter''s own Stripe invoice (never a generic buy link).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rentals_balance_due_cents_chk'
  ) THEN
    ALTER TABLE public.rentals
      ADD CONSTRAINT rentals_balance_due_cents_chk CHECK (balance_due_cents >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.return_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  returned_at timestamptz NOT NULL,
  odometer integer NOT NULL CHECK (odometer >= 0 AND odometer <= 2000000),
  fuel_or_charge text NOT NULL CHECK (fuel_or_charge IN ('empty', 'quarter', 'half', 'three_quarter', 'full')),
  keys_returned boolean NOT NULL,
  condition_notes text,
  tolls_tickets_note text,
  deposit_decision_needed boolean NOT NULL DEFAULT false,
  deposit_decision_note text,
  photos_skipped_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS return_checklists_rental_idx
  ON public.return_checklists (rental_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.return_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES public.return_checklists(id) ON DELETE CASCADE,
  area text NOT NULL CHECK (area IN ('exterior', 'interior')),
  item_key text NOT NULL,
  label text NOT NULL,
  result text NOT NULL CHECK (result IN ('ok', 'damage', 'na')),
  notes text,
  UNIQUE (checklist_id, item_key)
);

CREATE TABLE IF NOT EXISTS public.return_checklist_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES public.return_checklists(id) ON DELETE CASCADE,
  storage_bucket text NOT NULL DEFAULT 'condition-media' CHECK (storage_bucket = 'condition-media'),
  storage_path text NOT NULL,
  angle text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (storage_path !~* '^https?://')
);

GRANT SELECT, INSERT ON public.return_checklists TO authenticated;
GRANT SELECT, INSERT ON public.return_checklist_items TO authenticated;
GRANT SELECT, INSERT ON public.return_checklist_photos TO authenticated;
GRANT ALL ON public.return_checklists TO service_role;
GRANT ALL ON public.return_checklist_items TO service_role;
GRANT ALL ON public.return_checklist_photos TO service_role;

ALTER TABLE public.return_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_checklist_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers read return checklists" ON public.return_checklists;
CREATE POLICY "Managers read return checklists" ON public.return_checklists
  FOR SELECT TO authenticated USING (private.is_manager());
DROP POLICY IF EXISTS "Managers insert return checklists" ON public.return_checklists;
CREATE POLICY "Managers insert return checklists" ON public.return_checklists
  FOR INSERT TO authenticated WITH CHECK (private.is_manager());

DROP POLICY IF EXISTS "Managers read return checklist items" ON public.return_checklist_items;
CREATE POLICY "Managers read return checklist items" ON public.return_checklist_items
  FOR SELECT TO authenticated USING (private.is_manager());
DROP POLICY IF EXISTS "Managers insert return checklist items" ON public.return_checklist_items;
CREATE POLICY "Managers insert return checklist items" ON public.return_checklist_items
  FOR INSERT TO authenticated WITH CHECK (private.is_manager());

DROP POLICY IF EXISTS "Managers read return checklist photos" ON public.return_checklist_photos;
CREATE POLICY "Managers read return checklist photos" ON public.return_checklist_photos
  FOR SELECT TO authenticated USING (private.is_manager());
DROP POLICY IF EXISTS "Managers insert return checklist photos" ON public.return_checklist_photos;
CREATE POLICY "Managers insert return checklist photos" ON public.return_checklist_photos
  FOR INSERT TO authenticated WITH CHECK (private.is_manager());

-- Preserve application status so past renters keep portal access (read-only for balances).
CREATE OR REPLACE FUNCTION public.end_rental_tx(_rental_id uuid, _end date, _vehicle_status text, _return_miles integer DEFAULT NULL, _actor uuid DEFAULT NULL)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; v_pick integer; v_hist integer; v_read uuid;
BEGIN
  PERFORM set_config('app.rental_tx', 'on', true);
  IF _vehicle_status NOT IN ('available','maintenance') THEN RAISE EXCEPTION 'invalid_vehicle_status'; END IF;
  IF _return_miles IS NOT NULL AND (_return_miles < 0 OR _return_miles > 2000000) THEN RAISE EXCEPTION 'invalid_mileage'; END IF;
  SELECT id, vehicle_id, driver_id, application_id, status, pickup_reading_id INTO r FROM public.rentals WHERE id = _rental_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rental_not_found'; END IF;
  IF r.status <> 'active' THEN PERFORM set_config('app.rental_tx', 'off', true); RETURN 'already_closed'; END IF;
  PERFORM 1 FROM public.vehicles WHERE id = r.vehicle_id FOR UPDATE;
  IF _return_miles IS NOT NULL THEN
    SELECT mileage INTO v_pick FROM public.odometer_readings WHERE id = r.pickup_reading_id;
    IF v_pick IS NOT NULL AND _return_miles < v_pick THEN RAISE EXCEPTION 'return_below_pickup:%', v_pick; END IF;
    SELECT max(mileage) INTO v_hist FROM public.odometer_readings WHERE vehicle_id = r.vehicle_id AND status = 'valid';
    IF v_hist IS NOT NULL AND _return_miles + 500 < v_hist THEN RAISE EXCEPTION 'return_below_history:%', v_hist; END IF;
    v_read := private.rental_mileage_reading(r.vehicle_id, _rental_id, r.driver_id, _return_miles, 'rental_return', 'return', _actor);
  END IF;
  UPDATE public.rentals SET status = 'closed', end_date = _end, autopay_active = false,
    return_reading_id = COALESCE(v_read, return_reading_id) WHERE id = _rental_id;
  UPDATE public.vehicles SET status = _vehicle_status WHERE id = r.vehicle_id;
  IF r.application_id IS NOT NULL THEN
    UPDATE public.automation_enrollments SET status = 'cancelled', cancelled_reason = 'rental ended', next_run_at = NULL
      WHERE application_id = r.application_id AND status = 'active';
  END IF;
  PERFORM set_config('app.rental_tx', 'off', true);
  RETURN 'closed';
END $function$;

REVOKE ALL ON FUNCTION public.end_rental_tx(uuid, date, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_rental_tx(uuid, date, text, integer, uuid) TO service_role;

COMMENT ON TABLE public.return_checklists IS
  'Manager return closeout from the guided Return flow. Photos stay in private condition-media.';
