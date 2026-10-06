CREATE TABLE public.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_refund_id text NOT NULL UNIQUE,
  stripe_charge_id text,
  stripe_payment_intent_id text,
  payment_ids uuid[] NOT NULL DEFAULT '{}',
  amount numeric NOT NULL CHECK (amount >= 0),
  status text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_refunds TO authenticated;
GRANT ALL ON public.payment_refunds TO service_role;
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read refunds" ON public.payment_refunds FOR SELECT TO authenticated USING (private.is_staff());

UPDATE public.payments SET refunded_amount = amount WHERE refunded_amount > amount;
ALTER TABLE public.payments ADD CONSTRAINT payments_refund_bounded CHECK (refunded_amount IS NULL OR (refunded_amount >= 0 AND refunded_amount <= amount));
ALTER TABLE public.payments ADD COLUMN net_collected numeric GENERATED ALWAYS AS (
  CASE WHEN status IN ('paid','refunded') THEN GREATEST(COALESCE(amount,0) - COALESCE(refunded_amount,0), 0) ELSE 0 END
) STORED;

-- Provider-truth refund application. _cumulative = Stripe's amount_refunded (dollars) for the charge.
-- Monotonic (never decreases), bounded by gross, allocated across combined-payment rows in a stable order.
CREATE OR REPLACE FUNCTION public.apply_payment_refund(_payment_ids uuid[], _cumulative numeric, _refunds jsonb, _charge_id text, _pi text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; remaining numeric; share numeric; gross numeric := 0; touched int := 0; x jsonb;
BEGIN
  FOR r IN SELECT id, amount FROM payments WHERE id = ANY(_payment_ids) AND status IN ('paid','refunded') ORDER BY id FOR UPDATE LOOP
    gross := gross + COALESCE(r.amount,0);
  END LOOP;
  remaining := LEAST(GREATEST(COALESCE(_cumulative,0),0), gross);
  FOR r IN SELECT id, amount, COALESCE(refunded_amount,0) AS ra FROM payments WHERE id = ANY(_payment_ids) AND status IN ('paid','refunded') ORDER BY id LOOP
    share := GREATEST(r.ra, LEAST(COALESCE(r.amount,0), remaining));
    remaining := GREATEST(remaining - share, 0);
    IF share <> r.ra THEN
      UPDATE payments SET refunded_amount = share, refunded_at = now(),
        status = CASE WHEN share >= amount THEN 'refunded' ELSE status END
      WHERE id = r.id;
      touched := touched + 1;
    END IF;
  END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(_refunds,'[]'::jsonb)) LOOP
    INSERT INTO payment_refunds (stripe_refund_id, stripe_charge_id, stripe_payment_intent_id, payment_ids, amount, status)
    VALUES (x->>'id', _charge_id, _pi, _payment_ids, (x->>'amount')::numeric, x->>'status')
    ON CONFLICT (stripe_refund_id) DO UPDATE SET status = EXCLUDED.status;
  END LOOP;
  RETURN jsonb_build_object('gross', gross, 'rows_changed', touched);
END $$;
REVOKE ALL ON FUNCTION public.apply_payment_refund(uuid[], numeric, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_payment_refund(uuid[], numeric, jsonb, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.vehicle_pl(_from date DEFAULT NULL::date, _to date DEFAULT NULL::date)
 RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, license_plate text, status text, revenue numeric, expenses numeric, maintenance numeric, net numeric, days_on_rent bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH bounds AS (SELECT COALESCE(_from, '1900-01-01'::date) AS lo, COALESCE(_to, '2999-12-31'::date) AS hi),
  rev AS (
    SELECT p.vehicle_id, COALESCE(sum(p.net_collected), 0) AS amt
    FROM public.payments p, bounds b
    WHERE p.vehicle_id IS NOT NULL AND p.status IN ('paid','refunded')
      AND p.type IN ('rent', 'late_fee', 'other')
      AND COALESCE(p.paid_date, p.due_date) BETWEEN b.lo AND b.hi
    GROUP BY p.vehicle_id),
  exp AS (SELECT e.vehicle_id, COALESCE(sum(e.amount), 0) AS amt FROM public.vehicle_expenses e, bounds b WHERE e.incurred_on BETWEEN b.lo AND b.hi GROUP BY e.vehicle_id),
  maint AS (SELECT m.vehicle_id, COALESCE(sum(COALESCE(m.company_share, m.total_cost, 0)), 0) AS amt FROM public.maintenance_records m, bounds b
    WHERE m.vehicle_id IS NOT NULL AND COALESCE(m.performed_on, m.completed_at::date, m.created_at::date) BETWEEN b.lo AND b.hi GROUP BY m.vehicle_id),
  onrent AS (SELECT r.vehicle_id, COALESCE(sum(GREATEST(0,(LEAST(COALESCE(r.end_date, b.hi), b.hi) - GREATEST(r.start_date, b.lo)) + 1)), 0)::bigint AS days
    FROM public.rentals r, bounds b WHERE r.vehicle_id IS NOT NULL AND r.start_date <= b.hi AND COALESCE(r.end_date, b.hi) >= b.lo GROUP BY r.vehicle_id)
  SELECT v.id, v.year, v.make, v.model, v.license_plate, v.status,
    COALESCE(rev.amt, 0), COALESCE(exp.amt, 0), COALESCE(maint.amt, 0),
    COALESCE(rev.amt, 0) - COALESCE(exp.amt, 0) - COALESCE(maint.amt, 0), COALESCE(onrent.days, 0)
  FROM public.vehicles v
  LEFT JOIN rev ON rev.vehicle_id = v.id LEFT JOIN exp ON exp.vehicle_id = v.id
  LEFT JOIN maint ON maint.vehicle_id = v.id LEFT JOIN onrent ON onrent.vehicle_id = v.id
  ORDER BY (COALESCE(rev.amt,0) - COALESCE(exp.amt,0) - COALESCE(maint.amt,0)) DESC
$function$;

DROP POLICY IF EXISTS "Public can read vehicle photo images" ON storage.objects;