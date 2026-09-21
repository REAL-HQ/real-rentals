-- =============================================================================
-- Charges, incidents and deposit disposition
--
-- The money that leaks out of a rideshare rental fleet does not leak through
-- rent — it leaks through tolls, citations, damage and deposits nobody
-- reconciled. None of it had anywhere to live:
--
--   1. toll_charges     — tolls, citations and admin fees, billed to the
--                         renter who actually had the car at the time
--   2. incidents        — accidents, damage, theft and the insurance claim
--   3. deposit_deductions — itemised disposition of a deposit at return
--   4. late-fee policy  — so overdue rent accrues automatically
-- =============================================================================

-- --------------------------------------------------- 1. tolls & violations

CREATE TABLE IF NOT EXISTS public.toll_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  -- Set when we can tell who had the car; left null when it cannot be
  -- attributed (e.g. the car was on the lot) so it shows up for review
  -- rather than being silently billed to the wrong person.
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  charge_type text NOT NULL DEFAULT 'toll',
  occurred_at timestamptz NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  admin_fee numeric NOT NULL DEFAULT 0,
  agency text,
  location text,
  reference_number text,
  status text NOT NULL DEFAULT 'new',
  source text NOT NULL DEFAULT 'manual',
  -- The payment raised to recover this from the renter, once rebilled.
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT toll_charges_amount_nonneg CHECK (amount >= 0 AND admin_fee >= 0)
);
COMMENT ON COLUMN public.toll_charges.charge_type IS
  'toll | citation | red_light | speeding | parking | impound | admin_fee | other';
COMMENT ON COLUMN public.toll_charges.status IS
  'new | assigned | rebilled | paid | disputed | written_off';
COMMENT ON COLUMN public.toll_charges.occurred_at IS
  'When the toll or violation happened — this is what decides who gets billed.';

-- A toll statement re-imported twice must not bill the renter twice. The
-- agency's own reference number is the natural key when present.
CREATE UNIQUE INDEX IF NOT EXISTS toll_charges_reference_idx
  ON public.toll_charges (lower(reference_number))
  WHERE reference_number IS NOT NULL AND reference_number <> '';

CREATE INDEX IF NOT EXISTS toll_charges_vehicle_time_idx
  ON public.toll_charges (vehicle_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS toll_charges_application_idx
  ON public.toll_charges (application_id) WHERE application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS toll_charges_unassigned_idx
  ON public.toll_charges (occurred_at DESC) WHERE rental_id IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.toll_charges TO authenticated;
GRANT ALL ON public.toll_charges TO service_role;
ALTER TABLE public.toll_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage toll charges" ON public.toll_charges
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());

-- A renter can see what they are being charged for, but never edit it.
CREATE POLICY "Drivers read their own charges" ON public.toll_charges
  FOR SELECT TO authenticated
  USING (application_id IS NOT NULL AND private.owns_application(application_id));

CREATE TRIGGER toll_charges_set_updated_at BEFORE UPDATE ON public.toll_charges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------- 2. incidents

CREATE TABLE IF NOT EXISTS public.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  incident_type text NOT NULL DEFAULT 'accident',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reported_at timestamptz NOT NULL DEFAULT now(),
  location text,
  description text,
  at_fault text NOT NULL DEFAULT 'unknown',
  injuries boolean NOT NULL DEFAULT false,
  drivable boolean,
  police_report_number text,
  other_party text,
  severity text NOT NULL DEFAULT 'minor',
  status text NOT NULL DEFAULT 'open',
  -- Claim tracking
  claim_number text,
  insurance_carrier text,
  claim_opened_on date,
  claim_closed_on date,
  deductible numeric NOT NULL DEFAULT 0,
  estimated_cost numeric NOT NULL DEFAULT 0,
  actual_cost numeric NOT NULL DEFAULT 0,
  insurance_payout numeric NOT NULL DEFAULT 0,
  driver_responsible_amount numeric NOT NULL DEFAULT 0,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.incidents.incident_type IS
  'accident | damage | theft | vandalism | breakdown | tow | other';
COMMENT ON COLUMN public.incidents.at_fault IS 'driver | third_party | none | unknown';
COMMENT ON COLUMN public.incidents.severity IS 'minor | moderate | major | total_loss';
COMMENT ON COLUMN public.incidents.status IS
  'open | in_claim | repairing | closed | written_off';

CREATE INDEX IF NOT EXISTS incidents_vehicle_idx ON public.incidents (vehicle_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS incidents_open_idx ON public.incidents (status) WHERE status <> 'closed';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.incidents TO authenticated;
GRANT ALL ON public.incidents TO service_role;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage incidents" ON public.incidents
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY "Drivers read their own incidents" ON public.incidents
  FOR SELECT TO authenticated
  USING (application_id IS NOT NULL AND private.owns_application(application_id));

CREATE TRIGGER incidents_set_updated_at BEFORE UPDATE ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Damage photos belong to the incident they document.
ALTER TABLE public.condition_media
  ADD COLUMN IF NOT EXISTS incident_id uuid REFERENCES public.incidents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS condition_media_incident_idx
  ON public.condition_media (incident_id) WHERE incident_id IS NOT NULL;

-- --------------------------------------------- 3. deposit disposition

ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS deposit_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS deposit_refund_amount numeric,
  ADD COLUMN IF NOT EXISTS deposit_settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_notes text;
COMMENT ON COLUMN public.rentals.deposit_status IS
  'none | held | pending_disposition | partially_refunded | refunded | forfeited';

CREATE TABLE IF NOT EXISTS public.deposit_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  reason text NOT NULL,
  amount numeric NOT NULL,
  -- Where the deduction came from, so the renter can be shown the evidence
  -- rather than just a number.
  toll_charge_id uuid REFERENCES public.toll_charges(id) ON DELETE SET NULL,
  incident_id uuid REFERENCES public.incidents(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deposit_deductions_amount_positive CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS deposit_deductions_rental_idx
  ON public.deposit_deductions (rental_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deposit_deductions TO authenticated;
GRANT ALL ON public.deposit_deductions TO service_role;
ALTER TABLE public.deposit_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage deposit deductions" ON public.deposit_deductions
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY "Drivers read deductions on their rental" ON public.deposit_deductions
  FOR SELECT TO authenticated
  USING (private.driver_owns_rental(rental_id));

-- ------------------------------------------------------- 4. late fees

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS late_fee_applied_through date;
COMMENT ON COLUMN public.payments.late_fee_applied_through IS
  'Last date late fees were assessed for this payment. Keeps a re-run of the
   late-fee sweep from charging the same day twice.';

-- Policy lives in app_settings so an operator can change it without a deploy.
INSERT INTO public.app_settings (key, value)
VALUES (
  'late_fee_policy',
  jsonb_build_object(
    'enabled', false,
    'grace_days', 3,
    'flat_fee', 25,
    'daily_fee', 0,
    'max_fee', 100
  )
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO private.cron_tokens (name, token)
VALUES ('late-fees', encode(extensions.gen_random_bytes(24), 'hex'))
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'late-fees-daily';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

SELECT cron.schedule(
  'late-fees-daily',
  '30 11 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://drivereal.com/api/public/cron/late-fees',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = 'late-fees')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);

-- ------------------------------------------- 5. who had the car at time T

-- Attribution is the whole point of toll_charges, so it lives in the database
-- as one definition rather than being re-implemented by each caller.
--
-- A rental covers [start_date, end_date]. end_date is inclusive — a car
-- returned on the 10th was still the renter's responsibility that day — and a
-- null end_date means the rental is still running.
CREATE OR REPLACE FUNCTION public.rental_at_time(_vehicle_id uuid, _at timestamptz)
RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT r.id
  FROM public.rentals r
  WHERE r.vehicle_id = _vehicle_id
    AND r.start_date <= (_at AT TIME ZONE 'UTC')::date
    AND (r.end_date IS NULL OR r.end_date >= (_at AT TIME ZONE 'UTC')::date)
  -- Prefer the still-open rental, then the most recently started, so an
  -- overlapping historical record never wins over the live one.
  ORDER BY (r.status = 'active') DESC, r.start_date DESC
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.rental_at_time(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_at_time(uuid, timestamptz) TO authenticated, service_role;
