-- Collections: money still owed after a rental ends (repossessed, or returned with a balance).
-- DO NOT apply to production until Dolmar approves publishing this PR (approved design: Nov 22 2026).
--
-- What this adds
--   1. rentals.close_reason / repossessed_on / days_late_at_repo: how a closed rental ended and,
--      for a repo, the day the car was secured and how many days late the oldest unpaid week was
--      on that day.
--   2. collection_items: one line per debt (Unpaid Rent, Late Fees, Key Replacement, Damage,
--      Tolls & Tickets, Towing/Repo, Cleaning, Other) with amount, amount paid, status
--      (Open, Payment Plan, Sent To Collections, Paid, Settled, Written Off), notes, and, for a
--      prorated repo week, the proration math (rate, days, prorated amount, original amount).
--   3. collection_item_events: append-only history. Every status change, amount change,
--      proration, payment applied and attachment is logged with the date and the user.
--   4. collection_item_attachments: receipts, photos, invoices (files live in the private
--      'receipts' bucket under collections/, Managers only, same as expense receipts).
--   5. collection_payment_allocations: which payment paid which item, once per pair, so a
--      payment can never be applied twice whatever route it arrives by.
--
-- How payments rows move
--   An open payments row that moves to Collections gets status 'collections' and one or two items
--   (its rent/fee principal, and its accrued late fees as a separate Late Fees line). Status
--   'collections' is excluded from the Overdue filter, the Outstanding total, the late fee sweep
--   (late-fees.server.ts never selected it) and every past-due/reminder text and email. The row is
--   still collectable: the portal balance, a card charge or a Stripe invoice retry can still pay it.
--   When it is paid, its items are paid automatically (trigger below).
--
-- Automatic moves
--   * When a rental goes active -> closed (end_rental_tx is the only path), its open, due,
--     uncovered rows move to Collections (trigger rentals_move_to_collections).
--   * Staff record a repo with record_rental_repossession(): sets the repo date, days late, moves
--     anything still open and prorates the missed week: weekly rate / 7 x days the renter still had
--     the car, counted from the start of the missed week through the repo date (inclusive).
--     Late fees, keys, damage and other charges stay in full. Editing the repo date recalculates.
--
-- Payments that come in later
--   Trigger payments_apply_to_collections: when any payments row becomes paid (insert or update,
--   any route: Stripe invoice, card charge, Payment Link webhook, staff Mark Paid),
--     a) if the row itself is in Collections, its own lines are paid (principal, then its late fees);
--     b) otherwise, if it belongs to a closed rental (or to no rental, for a renter with no active
--        rental, or carries reason 'collections') with open items, its amount is applied to the
--        oldest open items. Allocations are unique per (payment, item) and capped at each item's
--        balance, so no payment is ever counted twice.
--
-- Writes go through the SECURITY DEFINER functions below (service role only); the app's server
-- functions check Manager/Owner first. Staff read the tables directly (Managers only, RLS).

-- ------------------------------------------------------------------ 1. rentals
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS close_reason text,
  ADD COLUMN IF NOT EXISTS repossessed_on date,
  ADD COLUMN IF NOT EXISTS days_late_at_repo integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rentals_close_reason_chk') THEN
    ALTER TABLE public.rentals ADD CONSTRAINT rentals_close_reason_chk
      CHECK (close_reason IS NULL OR close_reason IN ('returned', 'repossessed', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rentals_days_late_at_repo_chk') THEN
    ALTER TABLE public.rentals ADD CONSTRAINT rentals_days_late_at_repo_chk
      CHECK (days_late_at_repo IS NULL OR days_late_at_repo >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rentals_repo_needs_date_chk') THEN
    ALTER TABLE public.rentals ADD CONSTRAINT rentals_repo_needs_date_chk
      CHECK (close_reason IS DISTINCT FROM 'repossessed' OR repossessed_on IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN public.rentals.close_reason IS 'How a closed rental ended: returned, repossessed or other. Null for rentals closed before Collections.';
COMMENT ON COLUMN public.rentals.repossessed_on IS 'Repo only: the ET day the car was secured. Drives the missed-week proration in Collections.';
COMMENT ON COLUMN public.rentals.days_late_at_repo IS 'Repo only: days the oldest unpaid rent week was late on repossessed_on.';

-- ------------------------------------------------------------------ 2. items
CREATE TABLE IF NOT EXISTS public.collection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  source_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  -- payment: the row's principal; payment_late_fees: that row's accrued late fees; manual: staff-added.
  source_kind text NOT NULL DEFAULT 'manual' CHECK (source_kind IN ('payment', 'payment_late_fees', 'manual')),
  reason text NOT NULL CHECK (reason IN ('unpaid_rent', 'late_fees', 'key_replacement', 'damage', 'tolls_tickets', 'towing_repo', 'cleaning', 'other')),
  description text,
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  amount_paid numeric(10,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  -- Unpaid Rent from a weekly row: the week it bills, and its amount before any proration.
  week_start date,
  original_amount numeric(10,2) CHECK (original_amount IS NULL OR original_amount >= 0),
  proration jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'payment_plan', 'sent_to_collections', 'paid', 'settled', 'written_off')),
  incurred_on date,
  notes text,
  stripe_invoice_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

-- A payments row moves once: one principal item and at most one late-fee item per row.
CREATE UNIQUE INDEX IF NOT EXISTS collection_items_one_per_source_idx
  ON public.collection_items (source_payment_id, source_kind) WHERE source_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS collection_items_application_idx ON public.collection_items (application_id, status);
CREATE INDEX IF NOT EXISTS collection_items_rental_idx ON public.collection_items (rental_id, status);

CREATE TABLE IF NOT EXISTS public.collection_item_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.collection_items(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('created', 'status_changed', 'amount_changed', 'prorated', 'payment_applied', 'attachment_added', 'note')),
  from_status text,
  to_status text,
  amount numeric(10,2),
  payment_id uuid,
  actor_user_id uuid,
  actor_label text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collection_item_events_item_idx ON public.collection_item_events (item_id, created_at);

CREATE TABLE IF NOT EXISTS public.collection_item_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.collection_items(id) ON DELETE CASCADE,
  storage_bucket text NOT NULL DEFAULT 'receipts' CHECK (storage_bucket = 'receipts'),
  storage_path text NOT NULL CHECK (storage_path LIKE 'collections/%' AND storage_path !~* '^https?://'),
  file_name text,
  mime_type text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collection_item_attachments_item_idx ON public.collection_item_attachments (item_id);

CREATE TABLE IF NOT EXISTS public.collection_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.collection_items(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, item_id)
);
CREATE INDEX IF NOT EXISTS collection_payment_allocations_item_idx ON public.collection_payment_allocations (item_id);

GRANT SELECT ON public.collection_items, public.collection_item_events, public.collection_item_attachments, public.collection_payment_allocations TO authenticated;
GRANT ALL ON public.collection_items, public.collection_item_events, public.collection_item_attachments, public.collection_payment_allocations TO service_role;
ALTER TABLE public.collection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_item_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_payment_allocations ENABLE ROW LEVEL SECURITY;

-- Money owed and its history: Managers and Owners read; nobody writes from the browser.
DROP POLICY IF EXISTS "Managers read collection items" ON public.collection_items;
CREATE POLICY "Managers read collection items" ON public.collection_items FOR SELECT TO authenticated USING (private.is_manager());
DROP POLICY IF EXISTS "Managers read collection events" ON public.collection_item_events;
CREATE POLICY "Managers read collection events" ON public.collection_item_events FOR SELECT TO authenticated USING (private.is_manager());
DROP POLICY IF EXISTS "Managers read collection attachments" ON public.collection_item_attachments;
CREATE POLICY "Managers read collection attachments" ON public.collection_item_attachments FOR SELECT TO authenticated USING (private.is_manager());
DROP POLICY IF EXISTS "Managers read collection allocations" ON public.collection_payment_allocations;
CREATE POLICY "Managers read collection allocations" ON public.collection_payment_allocations FOR SELECT TO authenticated USING (private.is_manager());

DROP TRIGGER IF EXISTS collection_items_set_updated_at ON public.collection_items;
CREATE TRIGGER collection_items_set_updated_at BEFORE UPDATE ON public.collection_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------ 3. helpers
CREATE OR REPLACE FUNCTION public.collection_actor_label(_actor uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _actor IS NULL THEN 'System' ELSE coalesce((SELECT u.email::text FROM auth.users u WHERE u.id = _actor), _actor::text) END
$$;

CREATE OR REPLACE FUNCTION public.collection_log(_item uuid, _kind text, _from text, _to text, _amount numeric, _payment uuid, _actor uuid, _note text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.collection_item_events (item_id, kind, from_status, to_status, amount, payment_id, actor_user_id, actor_label, note)
  VALUES (_item, _kind, _from, _to, _amount, _payment, _actor, public.collection_actor_label(_actor), left(_note, 1000))
$$;

-- Item statuses that still owe money and accept payments.
CREATE OR REPLACE FUNCTION public.collection_status_is_open(_s text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT _s IN ('open', 'payment_plan', 'sent_to_collections') $$;

-- Re-derive amount_paid from allocations; an open item whose balance reaches zero becomes Paid.
CREATE OR REPLACE FUNCTION public.collection_recalc_item(_item uuid, _actor uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it record; paid numeric;
BEGIN
  SELECT * INTO it FROM public.collection_items WHERE id = _item FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT coalesce(sum(amount), 0) INTO paid FROM public.collection_payment_allocations WHERE item_id = _item;
  UPDATE public.collection_items SET amount_paid = paid WHERE id = _item AND amount_paid IS DISTINCT FROM paid;
  IF public.collection_status_is_open(it.status) AND it.amount > 0 AND paid + 0.005 >= it.amount THEN
    UPDATE public.collection_items SET status = 'paid', closed_at = now() WHERE id = _item;
    PERFORM public.collection_log(_item, 'status_changed', it.status, 'paid', paid, NULL, _actor, 'Paid in full by payments received');
  END IF;
END $$;

-- What a payments row category means as a Collections reason.
CREATE OR REPLACE FUNCTION public.collection_reason_for_payment(_type text, _reason text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _type = 'rent' THEN 'unpaid_rent'
    WHEN _type = 'late_fee' THEN 'late_fees'
    WHEN _type = 'toll' THEN 'tolls_tickets'
    WHEN _type = 'damage' THEN 'damage'
    WHEN lower(coalesce(_reason, '')) ~ '(key)' THEN 'key_replacement'
    WHEN lower(coalesce(_reason, '')) ~ '(tow|repo)' THEN 'towing_repo'
    WHEN lower(coalesce(_reason, '')) ~ '(clean|detail)' THEN 'cleaning'
    WHEN lower(coalesce(_reason, '')) ~ '(toll|ticket|citation)' THEN 'tolls_tickets'
    WHEN lower(coalesce(_reason, '')) ~ '(damage)' THEN 'damage'
    ELSE 'other'
  END
$$;

-- An open rent row is covered when paid rent billed for its week (due-2 .. due+6) adds up to its
-- amount: the same rule as src/lib/rent-standing.ts isRentRowCovered, so a week paid on another row
-- never becomes a phantom debt.
CREATE OR REPLACE FUNCTION public.collection_rent_row_covered(_payment uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.type = 'rent' AND p.due_date IS NOT NULL AND p.amount > 0 AND coalesce((
    SELECT sum(q.amount) FROM public.payments q
    WHERE q.rental_id = p.rental_id AND q.id <> p.id AND q.type = 'rent' AND q.status = 'paid'
      AND coalesce(q.due_date, q.paid_date) BETWEEN p.due_date - 2 AND p.due_date + 6
  ), 0) + 0.005 >= p.amount
  FROM public.payments p WHERE p.id = _payment
$$;

-- ------------------------------------------------------------------ 4. moving rows
CREATE OR REPLACE FUNCTION public.move_payment_to_collections(_payment_id uuid, _actor uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; r record; app uuid; owed numeric; late numeric; principal numeric; rsn text; made integer := 0; new_id uuid;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found'; END IF;
  IF p.status NOT IN ('current', 'late', 'overdue', 'past_due', 'failed', 'unpaid', 'collections') THEN RETURN 0; END IF;
  -- A Reservation Fee is never a debt to collect.
  IF p.type = 'deposit' OR p.reason = 'reservation_fee' OR coalesce(p.notes, '') ~ 'reservation_fee:' THEN RETURN 0; END IF;
  IF p.rental_id IS NOT NULL THEN SELECT id, application_id, vehicle_id INTO r FROM public.rentals WHERE id = p.rental_id; END IF;
  app := coalesce(p.driver_id, r.application_id);
  IF app IS NULL THEN RAISE EXCEPTION 'payment_has_no_renter'; END IF;

  owed := CASE WHEN coalesce(p.balance_due, 0) > 0 THEN p.balance_due ELSE coalesce(p.amount, 0) END;
  late := CASE WHEN p.type = 'late_fee' THEN 0 ELSE least(greatest(coalesce(p.late_fees, 0), 0), owed) END;
  principal := owed - late;
  rsn := public.collection_reason_for_payment(p.type, p.reason);

  IF principal > 0 THEN
    INSERT INTO public.collection_items (application_id, rental_id, vehicle_id, source_payment_id, source_kind, reason, description,
      amount, week_start, original_amount, incurred_on, stripe_invoice_id, created_by)
    VALUES (app, p.rental_id, coalesce(p.vehicle_id, r.vehicle_id), p.id, 'payment', rsn, nullif(p.reason, ''),
      principal, CASE WHEN p.type = 'rent' THEN p.due_date END, CASE WHEN p.type = 'rent' THEN principal END,
      p.due_date, p.stripe_invoice_id, _actor)
    ON CONFLICT (source_payment_id, source_kind) WHERE source_payment_id IS NOT NULL DO NOTHING
    RETURNING id INTO new_id;
    IF new_id IS NOT NULL THEN
      made := made + 1;
      PERFORM public.collection_log(new_id, 'created', NULL, 'open', principal, p.id, _actor, coalesce(_note, 'Moved from Payments'));
    END IF;
  END IF;
  new_id := NULL;
  IF late > 0 THEN
    INSERT INTO public.collection_items (application_id, rental_id, vehicle_id, source_payment_id, source_kind, reason, description,
      amount, incurred_on, stripe_invoice_id, created_by)
    VALUES (app, p.rental_id, coalesce(p.vehicle_id, r.vehicle_id), p.id, 'payment_late_fees', 'late_fees',
      'Late fees on ' || coalesce(to_char(p.due_date, 'Mon FMDD'), 'charge'), late, p.late_fee_applied_through, p.stripe_invoice_id, _actor)
    ON CONFLICT (source_payment_id, source_kind) WHERE source_payment_id IS NOT NULL DO NOTHING
    RETURNING id INTO new_id;
    IF new_id IS NOT NULL THEN
      made := made + 1;
      PERFORM public.collection_log(new_id, 'created', NULL, 'open', late, p.id, _actor, coalesce(_note, 'Moved from Payments'));
    END IF;
  END IF;

  IF p.status <> 'collections' THEN
    UPDATE public.payments SET status = 'collections' WHERE id = p.id;
    INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id, summary, metadata)
    VALUES (_actor, 'payment.moved_to_collections', 'payment', p.id::text,
      'Moved $' || to_char(owed, 'FM999999990.00') || ' to Collections',
      jsonb_build_object('from_status', p.status, 'rental_id', p.rental_id, 'note', _note));
  END IF;
  RETURN made;
END $$;

CREATE OR REPLACE FUNCTION public.move_rental_to_collections(_rental_id uuid, _actor uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; p record; made integer := 0; cutoff date;
BEGIN
  SELECT * INTO r FROM public.rentals WHERE id = _rental_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'rental_not_found'; END IF;
  IF r.status = 'active' THEN RAISE EXCEPTION 'rental_still_active'; END IF;
  cutoff := coalesce(r.repossessed_on, r.end_date, current_date);
  FOR p IN
    SELECT id FROM public.payments
    WHERE rental_id = _rental_id
      AND status IN ('current', 'late', 'overdue', 'past_due', 'failed', 'unpaid')
      AND (due_date IS NULL OR due_date <= cutoff)
    ORDER BY due_date NULLS LAST, created_at
  LOOP
    IF public.collection_rent_row_covered(p.id) THEN CONTINUE; END IF;
    made := made + public.move_payment_to_collections(p.id, _actor, _note);
  END LOOP;
  IF r.repossessed_on IS NOT NULL THEN PERFORM public.collections_apply_proration(_rental_id, _actor); END IF;
  RETURN made;
END $$;

-- ------------------------------------------------------------------ 5. repo + proration
-- Unpaid Rent for the week the car was secured owes weekly rate / 7 x days the renter still had
-- it (week start through repo date, inclusive). A week fully before the repo stays whole; a week
-- starting after it owes nothing (auto-Settled, reversible by editing the date).
CREATE OR REPLACE FUNCTION public.collections_apply_proration(_rental_id uuid, _actor uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; it record; orig numeric; rate numeric; days integer; new_amt numeric; pr jsonb; new_status text; changed integer := 0; auto boolean;
BEGIN
  SELECT * INTO r FROM public.rentals WHERE id = _rental_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'rental_not_found'; END IF;
  FOR it IN
    SELECT * FROM public.collection_items
    WHERE rental_id = _rental_id AND reason = 'unpaid_rent' AND week_start IS NOT NULL
      AND (public.collection_status_is_open(status) OR (status = 'settled' AND coalesce((proration->>'auto_settled')::boolean, false)))
    FOR UPDATE
  LOOP
    orig := coalesce(it.original_amount, it.amount);
    auto := coalesce((it.proration->>'auto_settled')::boolean, false);
    IF r.repossessed_on IS NULL THEN
      days := 7;
    ELSE
      days := least(7, greatest(0, (r.repossessed_on - it.week_start) + 1));
    END IF;
    IF days >= 7 THEN
      new_amt := orig; pr := NULL;
    ELSE
      rate := coalesce(nullif(r.weekly_rate, 0), orig);
      new_amt := least(orig, round(rate / 7.0 * days, 2));
      pr := jsonb_build_object('weekly_rate', rate, 'daily_rate', round(rate / 7.0, 2), 'days', days,
        'prorated_amount', new_amt, 'original_amount', orig, 'week_start', it.week_start, 'repo_date', r.repossessed_on,
        'auto_settled', false);
    END IF;
    new_amt := greatest(new_amt, 0);
    new_status := it.status;
    IF new_amt = 0 AND it.amount_paid = 0 AND public.collection_status_is_open(it.status) THEN
      new_status := 'settled';
      pr := pr || jsonb_build_object('auto_settled', true);
    ELSIF it.status = 'settled' AND auto AND new_amt > 0 THEN
      new_status := 'open';
    ELSIF it.status = 'settled' AND auto THEN
      pr := pr || jsonb_build_object('auto_settled', true);  -- still owes nothing: stays an automatic settlement
    END IF;
    IF it.amount IS DISTINCT FROM new_amt OR it.proration IS DISTINCT FROM pr OR it.status IS DISTINCT FROM new_status OR it.original_amount IS DISTINCT FROM orig THEN
      UPDATE public.collection_items
        SET amount = new_amt, original_amount = orig, proration = pr, status = new_status,
            closed_at = CASE WHEN public.collection_status_is_open(new_status) THEN NULL ELSE coalesce(closed_at, now()) END
        WHERE id = it.id;
      PERFORM public.collection_log(it.id, 'prorated', NULL, NULL, new_amt, NULL, _actor,
        CASE WHEN pr IS NULL THEN 'Full week owed: $' || to_char(orig, 'FM999999990.00')
             ELSE '$' || to_char(rate, 'FM999999990.00') || '/week / 7 x ' || days || ' day' || CASE WHEN days = 1 THEN '' ELSE 's' END
                  || ' = $' || to_char(new_amt, 'FM999999990.00') || ' (was $' || to_char(orig, 'FM999999990.00') || ')' END);
      IF new_status IS DISTINCT FROM it.status THEN
        PERFORM public.collection_log(it.id, 'status_changed', it.status, new_status, new_amt, NULL, _actor,
          CASE WHEN new_status = 'settled' THEN 'No rent owed: week starts after the repo date' ELSE 'Reopened: repo date changed' END);
      END IF;
      changed := changed + 1;
    END IF;
    PERFORM public.collection_recalc_item(it.id, _actor);
  END LOOP;
  RETURN changed;
END $$;

CREATE OR REPLACE FUNCTION public.record_rental_repossession(_rental_id uuid, _repo_date date, _actor uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; oldest date; late_days integer; moved integer; prorated integer; prev date;
BEGIN
  SELECT * INTO r FROM public.rentals WHERE id = _rental_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rental_not_found'; END IF;
  IF r.status = 'active' THEN RAISE EXCEPTION 'rental_still_active'; END IF;
  IF _repo_date IS NULL THEN RAISE EXCEPTION 'repo_date_required'; END IF;
  IF _repo_date < r.start_date THEN RAISE EXCEPTION 'repo_date_before_start'; END IF;
  IF _repo_date > (now() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'repo_date_in_future'; END IF;
  prev := r.repossessed_on;

  UPDATE public.rentals SET close_reason = 'repossessed', repossessed_on = _repo_date WHERE id = _rental_id;
  moved := public.move_rental_to_collections(_rental_id, _actor, coalesce(_note, 'Repossessed'));
  prorated := public.collections_apply_proration(_rental_id, _actor);

  -- Days late on the repo date: from the oldest rent week still unpaid when the car was secured.
  SELECT min(week_start) INTO oldest FROM public.collection_items
  WHERE rental_id = _rental_id AND reason = 'unpaid_rent' AND week_start IS NOT NULL AND week_start <= _repo_date
    AND status NOT IN ('written_off');
  late_days := CASE WHEN oldest IS NULL THEN 0 ELSE greatest(0, _repo_date - oldest) END;
  UPDATE public.rentals SET days_late_at_repo = late_days WHERE id = _rental_id;

  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id, summary, metadata)
  VALUES (_actor, CASE WHEN prev IS NULL THEN 'rental.repossession_recorded' ELSE 'rental.repossession_date_changed' END,
    'rental', _rental_id::text,
    'Repo date ' || to_char(_repo_date, 'Mon FMDD, YYYY') || coalesce(' (was ' || to_char(prev, 'Mon FMDD, YYYY') || ')', '') || ', ' || late_days || ' days late',
    jsonb_build_object('repossessed_on', _repo_date, 'previous', prev, 'days_late', late_days, 'items_moved', moved, 'items_prorated', prorated, 'note', _note));
  RETURN jsonb_build_object('repossessed_on', _repo_date, 'days_late', late_days, 'moved', moved, 'prorated', prorated);
END $$;

-- ------------------------------------------------------------------ 6. staff edits
CREATE OR REPLACE FUNCTION public.set_collection_item_status(_item_id uuid, _to text, _actor uuid, _note text DEFAULT NULL, _expected text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it record;
BEGIN
  IF _to NOT IN ('open', 'payment_plan', 'sent_to_collections', 'paid', 'settled', 'written_off') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  SELECT * INTO it FROM public.collection_items WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found'; END IF;
  IF _expected IS NOT NULL AND it.status <> _expected THEN RAISE EXCEPTION 'status_changed_elsewhere'; END IF;
  IF it.status = _to THEN RETURN _to; END IF;
  UPDATE public.collection_items
    SET status = _to,
        closed_at = CASE WHEN public.collection_status_is_open(_to) THEN NULL ELSE now() END,
        -- A staff decision replaces an automatic proration settlement.
        proration = CASE WHEN proration IS NULL THEN NULL ELSE proration || jsonb_build_object('auto_settled', false) END
    WHERE id = _item_id;
  PERFORM public.collection_log(_item_id, 'status_changed', it.status, _to, it.amount - it.amount_paid, NULL, _actor, _note);
  RETURN _to;
END $$;

CREATE OR REPLACE FUNCTION public.add_collection_item(_application_id uuid, _rental_id uuid, _reason text, _amount numeric,
  _description text, _incurred_on date, _notes text, _actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; new_id uuid;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'amount_must_be_positive'; END IF;
  IF _rental_id IS NOT NULL THEN
    SELECT id, application_id, vehicle_id INTO r FROM public.rentals WHERE id = _rental_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'rental_not_found'; END IF;
    IF r.application_id IS NOT NULL AND r.application_id <> _application_id THEN RAISE EXCEPTION 'rental_belongs_to_another_renter'; END IF;
  END IF;
  INSERT INTO public.collection_items (application_id, rental_id, vehicle_id, source_kind, reason, description, amount, incurred_on, notes, created_by)
  VALUES (_application_id, _rental_id, r.vehicle_id, 'manual', _reason, left(_description, 300), round(_amount, 2), _incurred_on, left(_notes, 4000), _actor)
  RETURNING id INTO new_id;
  PERFORM public.collection_log(new_id, 'created', NULL, 'open', round(_amount, 2), NULL, _actor, coalesce(_description, 'Charge added by staff'));
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.update_collection_item(_item_id uuid, _amount numeric, _reason text, _description text, _notes text, _actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it record;
BEGIN
  SELECT * INTO it FROM public.collection_items WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found'; END IF;
  IF _amount IS NOT NULL AND _amount < 0 THEN RAISE EXCEPTION 'amount_must_not_be_negative'; END IF;
  UPDATE public.collection_items SET
    amount = coalesce(round(_amount, 2), amount),
    -- A hand-set amount replaces the proration; the original stays for the record.
    proration = CASE WHEN _amount IS NOT NULL AND round(_amount, 2) <> amount THEN NULL ELSE proration END,
    reason = coalesce(_reason, reason),
    description = CASE WHEN _description IS NULL THEN description ELSE left(_description, 300) END,
    notes = CASE WHEN _notes IS NULL THEN notes ELSE left(_notes, 4000) END
  WHERE id = _item_id;
  IF _amount IS NOT NULL AND round(_amount, 2) <> it.amount THEN
    PERFORM public.collection_log(_item_id, 'amount_changed', NULL, NULL, round(_amount, 2), NULL, _actor,
      'Amount $' || to_char(it.amount, 'FM999999990.00') || ' -> $' || to_char(round(_amount, 2), 'FM999999990.00'));
  END IF;
  IF _notes IS NOT NULL AND _notes IS DISTINCT FROM it.notes THEN
    PERFORM public.collection_log(_item_id, 'note', NULL, NULL, NULL, NULL, _actor, _notes);
  END IF;
  PERFORM public.collection_recalc_item(_item_id, _actor);
END $$;

CREATE OR REPLACE FUNCTION public.add_collection_attachment(_item_id uuid, _path text, _file_name text, _mime text, _actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.collection_items WHERE id = _item_id) THEN RAISE EXCEPTION 'item_not_found'; END IF;
  IF _path NOT LIKE 'collections/' || _item_id::text || '/%' THEN RAISE EXCEPTION 'attachment_path_mismatch'; END IF;
  INSERT INTO public.collection_item_attachments (item_id, storage_path, file_name, mime_type, uploaded_by)
  VALUES (_item_id, _path, left(_file_name, 200), left(_mime, 100), _actor) RETURNING id INTO new_id;
  PERFORM public.collection_log(_item_id, 'attachment_added', NULL, NULL, NULL, NULL, _actor, coalesce(_file_name, 'Attachment'));
  RETURN new_id;
END $$;

-- ------------------------------------------------------------------ 7. payments received
CREATE OR REPLACE FUNCTION public.apply_payment_to_collections(_payment_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; r record; app uuid; pool numeric; take numeric; applied numeric := 0; it record; eligible boolean := false;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR p.status <> 'paid' THEN RETURN 0; END IF;

  -- a) The row is itself in Collections: its own lines are paid, principal first, then the late
  --    fees that accrued on it, up to what the charge collected. It never spills onto OTHER rows'
  --    lines: another path (e.g. a Payment Link allocator marking old rows paid) may mark this row
  --    paid with money that was already applied in (b), and spilling would count it twice. Anything
  --    left over shows as unapplied for staff to review.
  IF EXISTS (SELECT 1 FROM public.collection_items WHERE source_payment_id = p.id) THEN
    pool := coalesce(p.amount, 0) - coalesce(p.refunded_amount, 0)
          - coalesce((SELECT sum(amount) FROM public.collection_payment_allocations WHERE payment_id = p.id), 0);
    FOR it IN SELECT * FROM public.collection_items WHERE source_payment_id = p.id AND public.collection_status_is_open(status)
              ORDER BY CASE source_kind WHEN 'payment' THEN 0 ELSE 1 END FOR UPDATE LOOP
      take := least(pool, it.amount - it.amount_paid);
      IF take > 0 THEN
        INSERT INTO public.collection_payment_allocations (payment_id, item_id, amount) VALUES (p.id, it.id, take)
        ON CONFLICT (payment_id, item_id) DO NOTHING;
        IF FOUND THEN
          pool := pool - take; applied := applied + take;
          PERFORM public.collection_log(it.id, 'payment_applied', NULL, NULL, take, p.id, NULL, 'Charge paid' || coalesce(' (' || p.payment_method || ')', ''));
        END IF;
      END IF;
      PERFORM public.collection_recalc_item(it.id, NULL);
    END LOOP;
    RETURN applied;
  END IF;

  -- b) Any other payment for a renter who owes Collections.
  IF p.type = 'deposit' OR p.reason = 'reservation_fee' OR coalesce(p.notes, '') ~ 'reservation_fee:' THEN RETURN 0; END IF;
  IF p.rental_id IS NOT NULL THEN SELECT id, status, application_id INTO r FROM public.rentals WHERE id = p.rental_id; END IF;
  app := coalesce(p.driver_id, r.application_id);
  IF app IS NULL THEN RETURN 0; END IF;
  IF p.reason = 'collections' THEN
    eligible := true;
  ELSIF p.rental_id IS NOT NULL THEN
    eligible := r.status IS DISTINCT FROM 'active'
      AND EXISTS (SELECT 1 FROM public.collection_items WHERE rental_id = p.rental_id AND public.collection_status_is_open(status));
  ELSE
    eligible := NOT EXISTS (SELECT 1 FROM public.rentals WHERE application_id = app AND status = 'active');
  END IF;
  IF NOT eligible THEN RETURN 0; END IF;

  pool := coalesce(p.amount, 0) - coalesce(p.refunded_amount, 0)
        - coalesce((SELECT sum(amount) FROM public.collection_payment_allocations WHERE payment_id = p.id), 0);
  FOR it IN
    SELECT * FROM public.collection_items
    WHERE application_id = app AND public.collection_status_is_open(status) AND amount > amount_paid
      AND (p.reason = 'collections' OR p.rental_id IS NULL OR rental_id = p.rental_id)
    ORDER BY (rental_id IS NOT DISTINCT FROM p.rental_id) DESC, coalesce(week_start, incurred_on, created_at::date),
      CASE reason WHEN 'unpaid_rent' THEN 0 WHEN 'late_fees' THEN 1 ELSE 2 END, created_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN pool <= 0;
    take := least(pool, it.amount - it.amount_paid);
    INSERT INTO public.collection_payment_allocations (payment_id, item_id, amount) VALUES (p.id, it.id, take)
    ON CONFLICT (payment_id, item_id) DO NOTHING;
    IF FOUND THEN
      pool := pool - take; applied := applied + take;
      PERFORM public.collection_log(it.id, 'payment_applied', NULL, NULL, take, p.id, NULL,
        'Payment received' || coalesce(' (' || p.payment_method || ')', '') || ' applied');
    END IF;
    PERFORM public.collection_recalc_item(it.id, NULL);
  END LOOP;
  RETURN applied;
END $$;

CREATE OR REPLACE FUNCTION public.payments_apply_to_collections_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    PERFORM public.apply_payment_to_collections(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payments_apply_to_collections ON public.payments;
CREATE TRIGGER payments_apply_to_collections AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_apply_to_collections_trg();

-- A row with open Collections lines stays in Collections whatever route touches it: a failed card
-- retry, a staff charge that declines or a sweep can't put it back on Overdue (and so can't trigger a
-- past-due notice). Paid, pending (a charge in flight), refunded, waived and void still apply.
CREATE OR REPLACE FUNCTION public.payments_keep_in_collections_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('current', 'late', 'overdue', 'past_due', 'failed', 'unpaid', 'upcoming')
     AND EXISTS (SELECT 1 FROM public.collection_items WHERE source_payment_id = NEW.id AND public.collection_status_is_open(status)) THEN
    NEW.status := 'collections';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payments_keep_in_collections ON public.payments;
CREATE TRIGGER payments_keep_in_collections BEFORE UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_keep_in_collections_trg();

CREATE OR REPLACE FUNCTION public.rentals_move_to_collections_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status = 'closed' THEN
    PERFORM public.move_rental_to_collections(NEW.id, NULL, 'Rental ended with a balance');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rentals_move_to_collections ON public.rentals;
CREATE TRIGGER rentals_move_to_collections AFTER UPDATE OF status ON public.rentals
  FOR EACH ROW EXECUTE FUNCTION public.rentals_move_to_collections_trg();

REVOKE ALL ON FUNCTION public.move_payment_to_collections(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.move_rental_to_collections(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collections_apply_proration(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_rental_repossession(uuid, date, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_collection_item_status(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_collection_item(uuid, uuid, text, numeric, text, date, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_collection_item(uuid, numeric, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_collection_attachment(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_payment_to_collections(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collection_recalc_item(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collection_log(uuid, text, text, text, numeric, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collection_actor_label(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collection_rent_row_covered(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_payment_to_collections(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_rental_to_collections(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.collections_apply_proration(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_rental_repossession(uuid, date, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_collection_item_status(uuid, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_collection_item(uuid, uuid, text, numeric, text, date, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_collection_item(uuid, numeric, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_collection_attachment(uuid, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_payment_to_collections(uuid) TO service_role;
