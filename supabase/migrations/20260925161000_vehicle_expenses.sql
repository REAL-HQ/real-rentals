-- =============================================================================
-- Vehicle expenses, receipts, and per-vehicle P&L
--
-- Maintenance records already carry a cost and an invoice number, but that is
-- the only money that ever gets attached to a car. Registration fees,
-- insurance premiums, detailing, towing, parking, finance payments — none of
-- it has anywhere to live, and no receipt image can be attached anywhere in
-- the application. So "what did this car actually cost me?" has never been
-- answerable, and neither has "which of the six makes money?".
--
-- This adds a proper expense ledger with receipt capture, and one function
-- that puts revenue and cost side by side per vehicle.
--
-- Expenses are money, so everything here is gated by is_manager() — a
-- Coordinator cannot see or touch any of it.
-- =============================================================================

-- ------------------------------------------------------------- 1. the ledger

CREATE TABLE IF NOT EXISTS public.vehicle_expenses (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  -- Set when the cost is attributable to whoever had the car: a tow caused by
  -- the renter, a cleaning fee after return. Left null for costs of ownership.
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,

  category text NOT NULL CHECK (category IN (
    'registration',   -- tag, title, county fees
    'insurance',      -- premium instalments
    'maintenance',    -- routine servicing
    'repair',         -- something broke
    'tires',
    'fuel',
    'cleaning',       -- detailing, post-return valet
    'towing',
    'parking',        -- storage, impound
    'tolls',          -- paid by the company, not rebilled
    'finance',        -- note or lease payment
    'purchase',       -- acquisition cost
    'gps',            -- tracker hardware and subscription
    'other'
  )),
  description text NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  incurred_on date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text,
  reference text,               -- invoice or receipt number

  -- The receipt image or PDF, in the `receipts` bucket created below.
  receipt_path text,
  receipt_name text,
  receipt_mime text,

  -- Recurring costs (insurance, finance) are easier to reason about when the
  -- ledger knows they repeat, without building a scheduler for it.
  is_recurring boolean NOT NULL DEFAULT false,
  notes text,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_expenses_vehicle_idx  ON public.vehicle_expenses (vehicle_id, incurred_on DESC);
CREATE INDEX IF NOT EXISTS vehicle_expenses_category_idx ON public.vehicle_expenses (category, incurred_on DESC);
CREATE INDEX IF NOT EXISTS vehicle_expenses_rental_idx   ON public.vehicle_expenses (rental_id) WHERE rental_id IS NOT NULL;

COMMENT ON TABLE public.vehicle_expenses IS
  'Every cost attributable to a vehicle, with an optional receipt. Maintenance
   costs continue to live on maintenance_records; the P&L function below reads
   both so nothing is double counted.';

ALTER TABLE public.vehicle_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers manage vehicle expenses" ON public.vehicle_expenses;
CREATE POLICY "Managers manage vehicle expenses" ON public.vehicle_expenses
  FOR ALL TO authenticated USING (private.is_manager()) WITH CHECK (private.is_manager());

-- Partners see the costs on cars they own — they are already shown maintenance
-- and payments on the same basis.
DROP POLICY IF EXISTS "Partners read expenses on their vehicles" ON public.vehicle_expenses;
CREATE POLICY "Partners read expenses on their vehicles" ON public.vehicle_expenses
  FOR SELECT TO authenticated USING (private.partner_owns_vehicle(vehicle_id));

-- Spelled out rather than inherited from default privileges; see the note in
-- the staff-tiers migration. RLS above is what actually restricts this to
-- managers and partners.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_expenses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_expenses TO service_role;

CREATE OR REPLACE FUNCTION public.touch_vehicle_expense()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS vehicle_expenses_touch ON public.vehicle_expenses;
CREATE TRIGGER vehicle_expenses_touch
  BEFORE UPDATE ON public.vehicle_expenses
  FOR EACH ROW EXECUTE FUNCTION public.touch_vehicle_expense();

-- ---------------------------------------------------------- 2. receipt files

INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Receipts are money records: managers only, and never public. Files are read
-- back through signed URLs minted server-side.
DROP POLICY IF EXISTS "Managers manage receipt objects" ON storage.objects;
CREATE POLICY "Managers manage receipt objects" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'receipts' AND private.is_manager())
  WITH CHECK (bucket_id = 'receipts' AND private.is_manager());

-- --------------------------------------------------------------- 3. the P&L
--
-- Revenue is rent actually collected; deposits are excluded because they are a
-- liability we are holding, not income. Cost is the expense ledger plus the
-- company's share of maintenance — partner-funded maintenance is not our cost.
CREATE OR REPLACE FUNCTION public.vehicle_pl(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS TABLE (
  vehicle_id uuid,
  year int,
  make text,
  model text,
  license_plate text,
  status text,
  revenue numeric,
  expenses numeric,
  maintenance numeric,
  net numeric,
  days_on_rent bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH bounds AS (
    SELECT COALESCE(_from, '1900-01-01'::date) AS lo,
           COALESCE(_to,   '2999-12-31'::date) AS hi
  ),
  rev AS (
    SELECT p.vehicle_id, COALESCE(sum(p.amount), 0) AS amt
    FROM public.payments p, bounds b
    WHERE p.vehicle_id IS NOT NULL
      AND p.status = 'paid'
      AND p.type IN ('rent', 'late_fee', 'other')
      AND COALESCE(p.paid_date, p.due_date) BETWEEN b.lo AND b.hi
    GROUP BY p.vehicle_id
  ),
  exp AS (
    SELECT e.vehicle_id, COALESCE(sum(e.amount), 0) AS amt
    FROM public.vehicle_expenses e, bounds b
    WHERE e.incurred_on BETWEEN b.lo AND b.hi
    GROUP BY e.vehicle_id
  ),
  maint AS (
    SELECT m.vehicle_id,
           COALESCE(sum(COALESCE(m.company_share, m.total_cost, 0)), 0) AS amt
    FROM public.maintenance_records m, bounds b
    WHERE m.vehicle_id IS NOT NULL
      AND COALESCE(m.performed_on, m.completed_at::date, m.created_at::date) BETWEEN b.lo AND b.hi
    GROUP BY m.vehicle_id
  ),
  onrent AS (
    SELECT r.vehicle_id,
           COALESCE(sum(
             GREATEST(0,
               (LEAST(COALESCE(r.end_date, b.hi), b.hi)
                - GREATEST(r.start_date, b.lo)) + 1)
           ), 0)::bigint AS days
    FROM public.rentals r, bounds b
    WHERE r.vehicle_id IS NOT NULL
      AND r.start_date <= b.hi
      AND COALESCE(r.end_date, b.hi) >= b.lo
    GROUP BY r.vehicle_id
  )
  SELECT v.id,
         v.year, v.make, v.model, v.license_plate, v.status,
         COALESCE(rev.amt, 0),
         COALESCE(exp.amt, 0),
         COALESCE(maint.amt, 0),
         COALESCE(rev.amt, 0) - COALESCE(exp.amt, 0) - COALESCE(maint.amt, 0),
         COALESCE(onrent.days, 0)
  FROM public.vehicles v
  LEFT JOIN rev    ON rev.vehicle_id    = v.id
  LEFT JOIN exp    ON exp.vehicle_id    = v.id
  LEFT JOIN maint  ON maint.vehicle_id  = v.id
  LEFT JOIN onrent ON onrent.vehicle_id = v.id
  ORDER BY (COALESCE(rev.amt,0) - COALESCE(exp.amt,0) - COALESCE(maint.amt,0)) DESC
$$;

-- SECURITY DEFINER, so it is locked to managers explicitly. Without this a
-- coordinator could call the RPC and read exactly the revenue figures the
-- policies above are keeping from them.
REVOKE ALL ON FUNCTION public.vehicle_pl(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_pl(date, date) TO service_role;

COMMENT ON FUNCTION public.vehicle_pl(date, date) IS
  'Per-vehicle revenue, cost and net for a date window. Deposits are excluded
   from revenue (they are held, not earned) and partner-funded maintenance is
   excluded from cost. Execute is granted to service_role only — it is reached
   through a server function that checks the caller is a manager.';
