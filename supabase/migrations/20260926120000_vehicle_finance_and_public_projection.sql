-- =============================================================================
-- Vehicle access control: financing leaves the vehicles table, and the public
-- site stops reading the vehicles table at all.
--
-- Two separate holes are closed here.
--
-- 1. Coordinators could read acquisition and financing data. Column-level
--    GRANT cannot fix that: every signed-in user — Owner, Manager,
--    Coordinator, renter, partner — authenticates as the single `authenticated`
--    Postgres role, and RLS gates rows, not columns. The only database-level
--    separation available is a separate table with its own policy, so the ten
--    financing columns move to public.vehicle_finance.
--
-- 2. The SELECT policy on vehicles was TO PUBLIC USING (true) and anon held
--    SELECT on every column. VIN, plate, title number, insurance policy
--    number, GPS IMEI, key location and internal notes were readable by anyone
--    holding the publishable key — which ships inside the browser bundle.
--    anon loses the table outright and reads a fixed projection instead.
--
-- Copy, verify, then drop. A financing value that cannot be reconciled aborts
-- the migration with the source columns still in place. Safe to replay.
-- =============================================================================

-- ------------------------------------------------------- 1. vehicle_finance
--
-- One row per vehicle, created only when there is something to record. The
-- same tier boundary as vehicle_expenses and vehicle_pl(), so this is the
-- existing money rule applied to one more kind of money, not a new concept.

CREATE TABLE IF NOT EXISTS public.vehicle_finance (
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id) ON DELETE CASCADE,

  -- How the vehicle is held, and from whom.
  ownership_type text
    CHECK (ownership_type IS NULL OR ownership_type IN ('owned','financed','leased','partner')),
  legal_owner text,
  seller_dealer text,
  lienholder text,

  -- What it cost.
  purchase_date date,
  purchase_price numeric(10,2),

  -- What is still owed on it.
  loan_reference text,
  payoff_amount numeric(10,2),
  monthly_payment numeric(10,2),
  loan_maturity_date date,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.vehicle_finance IS
  'Acquisition and financing for a vehicle. Manager and Owner only. These
   columns deliberately do NOT live on public.vehicles: vehicles is readable by
   every staff tier, and RLS cannot withhold a column from one tier when all
   tiers share the `authenticated` database role.';

DROP TRIGGER IF EXISTS vehicle_finance_set_updated_at ON public.vehicle_finance;
CREATE TRIGGER vehicle_finance_set_updated_at
  BEFORE UPDATE ON public.vehicle_finance
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.vehicle_finance ENABLE ROW LEVEL SECURITY;

-- No anon policy exists, deliberately. A Coordinator matches nothing and gets
-- zero rows: a real row-level denial, not a projection the server applies.
DROP POLICY IF EXISTS "Managers manage vehicle finance" ON public.vehicle_finance;
CREATE POLICY "Managers manage vehicle finance" ON public.vehicle_finance
  FOR ALL TO authenticated
  USING (private.is_manager())
  WITH CHECK (private.is_manager());

-- Spelled out rather than inherited. A missing grant under a correct policy is
-- how applicant uploads broke for two months.
REVOKE ALL ON public.vehicle_finance FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_finance TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_finance TO service_role;

-- --------------------------------------------- 2. copy, reconcile, then drop
--
-- Production has no vehicles today, but this is written for a populated fleet:
-- rows may appear between writing this and running it, and it must be correct
-- if they do. Nothing is dropped until every source value has been proven to
-- exist in vehicle_finance.

DO $mig$
DECLARE
  has_src boolean;
  copied  bigint;
  bad     text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'vehicles'
      AND column_name  = 'purchase_price'
  ) INTO has_src;

  IF NOT has_src THEN
    RAISE NOTICE 'vehicle_finance: source columns already removed — nothing to migrate.';
    RETURN;
  END IF;

  -- 2a. Copy every vehicle that has anything at all to record. A row already
  -- present in vehicle_finance is left alone: if an earlier run got this far,
  -- that row is the canonical one and must not be overwritten. Divergence is
  -- caught below rather than resolved silently here.
  EXECUTE $q$
    INSERT INTO public.vehicle_finance
      (vehicle_id, ownership_type, legal_owner, seller_dealer, lienholder,
       purchase_date, purchase_price, loan_reference, payoff_amount,
       monthly_payment, loan_maturity_date)
    SELECT v.id, v.ownership_type, v.legal_owner, v.seller_dealer, v.lienholder,
           v.purchase_date, v.purchase_price, v.loan_reference, v.payoff_amount,
           v.monthly_payment, v.loan_maturity_date
    FROM public.vehicles v
    WHERE v.ownership_type     IS NOT NULL
       OR v.legal_owner        IS NOT NULL
       OR v.seller_dealer      IS NOT NULL
       OR v.lienholder         IS NOT NULL
       OR v.purchase_date      IS NOT NULL
       OR v.purchase_price     IS NOT NULL
       OR v.loan_reference     IS NOT NULL
       OR v.payoff_amount      IS NOT NULL
       OR v.monthly_payment    IS NOT NULL
       OR v.loan_maturity_date IS NOT NULL
    ON CONFLICT (vehicle_id) DO NOTHING
  $q$;
  GET DIAGNOSTICS copied = ROW_COUNT;
  RAISE NOTICE 'vehicle_finance: copied % vehicle(s).', copied;

  -- 2b. Reconcile value by value. Any vehicle carrying financing data whose
  -- vehicle_finance row is missing or does not match exactly is named, and the
  -- migration stops with the columns — and the data — still there.
  EXECUTE $q$
    SELECT string_agg(v.id::text, ', ')
    FROM public.vehicles v
    LEFT JOIN public.vehicle_finance f ON f.vehicle_id = v.id
    WHERE (v.ownership_type     IS NOT NULL
        OR v.legal_owner        IS NOT NULL
        OR v.seller_dealer      IS NOT NULL
        OR v.lienholder         IS NOT NULL
        OR v.purchase_date      IS NOT NULL
        OR v.purchase_price     IS NOT NULL
        OR v.loan_reference     IS NOT NULL
        OR v.payoff_amount      IS NOT NULL
        OR v.monthly_payment    IS NOT NULL
        OR v.loan_maturity_date IS NOT NULL)
      AND (f.vehicle_id IS NULL
        OR f.ownership_type     IS DISTINCT FROM v.ownership_type
        OR f.legal_owner        IS DISTINCT FROM v.legal_owner
        OR f.seller_dealer      IS DISTINCT FROM v.seller_dealer
        OR f.lienholder         IS DISTINCT FROM v.lienholder
        OR f.purchase_date      IS DISTINCT FROM v.purchase_date
        OR f.purchase_price     IS DISTINCT FROM v.purchase_price
        OR f.loan_reference     IS DISTINCT FROM v.loan_reference
        OR f.payoff_amount      IS DISTINCT FROM v.payoff_amount
        OR f.monthly_payment    IS DISTINCT FROM v.monthly_payment
        OR f.loan_maturity_date IS DISTINCT FROM v.loan_maturity_date)
  $q$ INTO bad;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'vehicle_finance reconciliation failed for vehicle(s): %. No columns were dropped and no financing data was lost.',
      bad;
  END IF;

  -- 2c. Only now.
  ALTER TABLE public.vehicles
    DROP COLUMN IF EXISTS ownership_type,
    DROP COLUMN IF EXISTS legal_owner,
    DROP COLUMN IF EXISTS seller_dealer,
    DROP COLUMN IF EXISTS lienholder,
    DROP COLUMN IF EXISTS purchase_date,
    DROP COLUMN IF EXISTS purchase_price,
    DROP COLUMN IF EXISTS loan_reference,
    DROP COLUMN IF EXISTS payoff_amount,
    DROP COLUMN IF EXISTS monthly_payment,
    DROP COLUMN IF EXISTS loan_maturity_date;

  RAISE NOTICE 'vehicle_finance: ten financing columns dropped from public.vehicles.';
END $mig$;

-- ------------------------------------------------ 3. vehicles loses the public
--
-- The old policy was FOR SELECT TO PUBLIC USING (true) — polroles null, so it
-- covered anon. Staff read the table; partners and renters no longer touch it
-- directly and are served explicit projections by trusted server code.

DROP POLICY IF EXISTS "Vehicles are publicly readable" ON public.vehicles;
DROP POLICY IF EXISTS "Partners can view their vehicles" ON public.vehicles;

DROP POLICY IF EXISTS "Staff read vehicles" ON public.vehicles;
CREATE POLICY "Staff read vehicles" ON public.vehicles
  FOR SELECT TO authenticated USING (private.is_staff());

-- "Managers manage vehicles" (FOR ALL, private.is_manager()) is unchanged and
-- still the only write path.

-- Supabase's ALTER DEFAULT PRIVILEGES had handed anon SELECT/INSERT/UPDATE on
-- every column. Revoked outright: anon has no business naming this table.
REVOKE ALL ON public.vehicles FROM anon;

-- ------------------------------------------------ 4. the public projection
--
-- A fixed whitelist. The architectural property that matters is what happens
-- to the NEXT column somebody adds to vehicles: it does not appear here, so it
-- is private by default and has to be listed deliberately to become public.
-- The failure mode is a missing field on the marketing site, not a silent leak.
--
-- security_invoker is off — stated rather than left to the default — because
-- `authenticated` is one database role shared by staff and renters alike, so an
-- invoker view could not show a renter the catalogue without also showing them
-- whatever a staff member sees. The view owner supplies the read instead.
--
-- That makes the REVOKE below load-bearing rather than tidy. This is a simple
-- single-table view, so PostgreSQL makes it auto-updatable, and Supabase's
-- default privileges would grant anon INSERT/UPDATE/DELETE on it. Those writes
-- would execute as the view owner and bypass RLS on vehicles entirely. Read is
-- the only privilege anyone gets here.

DROP VIEW IF EXISTS public.vehicles_public;
CREATE VIEW public.vehicles_public
  WITH (security_invoker = false, security_barrier = true) AS
  SELECT
    v.id,
    v.year,
    v.make,
    v.model,
    v.trim,
    v.color,
    v.body_type,
    v.status,
    v.weekly_rate,
    v.monthly_rate,
    v.mpg,
    v.miles_per_tank,
    v.doors,
    v.seats,
    v.fuel_type,
    v.uber_eligibility,
    v.badges,
    v.photos,
    v.description
  FROM public.vehicles v
  WHERE v.archived_at IS NULL
    AND v.status NOT IN ('retired', 'archived', 'sold');

COMMENT ON VIEW public.vehicles_public IS
  'The only vehicle data anon may read. Fixed whitelist: a column added to
   public.vehicles does not appear here until someone adds it on purpose.
   Runs as owner because staff and renters share the `authenticated` role, so
   SELECT is granted and every write privilege is revoked — an auto-updatable
   definer view with a write grant would be an RLS bypass.';

REVOKE ALL ON public.vehicles_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vehicles_public TO anon, authenticated, service_role;

-- PostgREST caches the schema; without this the new view 404s until it reloads.
NOTIFY pgrst, 'reload schema';
