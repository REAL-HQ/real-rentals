-- =============================================================================
-- Fixed Costs: monthly insurance and GPS tracker costs
--
-- Dolmar (Nov 28): "I need to see a total itemized tally that's updated
-- automatically as soon as new vehicles and renters are added, that shows me
-- total cost for all insurance policies and GPS trackers."
--
-- Nothing in the schema stores what a policy or a tracker costs today (the
-- vehicles table only has policy numbers, dates and tracker hardware ids), so
-- this adds one small table of cost lines. The Fixed Costs screen is computed
-- live from vehicles and active rentals and only READS these lines, so a new
-- car or renter appears at once, as a Missing Cost row until a cost is entered.
--
-- Scopes:
--   vehicle  one car (GPS tracker, or a policy on that car)
--   rental   one renter's rental (their insurance policy); vehicle_id optional
--   fleet    a lump-sum line not tied to one car (a fleet policy)
--   default  per-car amount used for every car with no line of its own
--            (for example the GPS monthly fee); one active default per kind
--
-- Money: Owner only (Accounting section). RLS is owner-only; the screen reaches
-- the table through owner-checked server functions. No renter ever sees it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.fixed_cost_items (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('insurance', 'gps')),
  scope text NOT NULL CHECK (scope IN ('vehicle', 'rental', 'fleet', 'default')),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE CASCADE,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE CASCADE,
  label text CHECK (label IS NULL OR length(label) <= 80),
  -- Staff-only note of who bills it. Never shown to renters.
  provider text CHECK (provider IS NULL OR length(provider) <= 120),
  amount numeric(10,2) NOT NULL CHECK (amount >= 0 AND amount <= 100000),
  frequency text NOT NULL DEFAULT 'monthly'
    CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'semiannual', 'annual')),
  -- Next payment date, when known. Drives the Next 30 Days figure.
  next_due_on date,
  active boolean NOT NULL DEFAULT true,
  ended_on date,
  notes text CHECK (notes IS NULL OR length(notes) <= 500),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_cost_items_scope_shape CHECK (
    (scope = 'vehicle' AND vehicle_id IS NOT NULL AND rental_id IS NULL)
    OR (scope = 'rental' AND rental_id IS NOT NULL)
    OR (scope IN ('fleet', 'default') AND vehicle_id IS NULL AND rental_id IS NULL)
  )
);

COMMENT ON TABLE public.fixed_cost_items IS
  'Recurring insurance and GPS tracker costs. The Fixed Costs screen joins these
   to vehicles and active rentals live; a car or renter without a line shows as
   Missing Cost. Owner only.';

-- One active line per car, per rental and one active default, per kind, so a
-- Missing Cost row is filled exactly once and totals never double count.
CREATE UNIQUE INDEX IF NOT EXISTS fixed_cost_items_one_default
  ON public.fixed_cost_items (kind) WHERE scope = 'default' AND active;
CREATE UNIQUE INDEX IF NOT EXISTS fixed_cost_items_one_per_vehicle
  ON public.fixed_cost_items (kind, vehicle_id) WHERE scope = 'vehicle' AND active;
CREATE UNIQUE INDEX IF NOT EXISTS fixed_cost_items_one_per_rental
  ON public.fixed_cost_items (kind, rental_id) WHERE scope = 'rental' AND active;
CREATE INDEX IF NOT EXISTS fixed_cost_items_vehicle_idx ON public.fixed_cost_items (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fixed_cost_items_rental_idx ON public.fixed_cost_items (rental_id) WHERE rental_id IS NOT NULL;

ALTER TABLE public.fixed_cost_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage fixed costs" ON public.fixed_cost_items;
CREATE POLICY "Owners manage fixed costs" ON public.fixed_cost_items
  FOR ALL TO authenticated USING (private.is_owner()) WITH CHECK (private.is_owner());

REVOKE ALL ON public.fixed_cost_items FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_cost_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_cost_items TO service_role;

CREATE OR REPLACE FUNCTION public.touch_fixed_cost_item()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fixed_cost_items_touch ON public.fixed_cost_items;
CREATE TRIGGER fixed_cost_items_touch
  BEFORE UPDATE ON public.fixed_cost_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_fixed_cost_item();
