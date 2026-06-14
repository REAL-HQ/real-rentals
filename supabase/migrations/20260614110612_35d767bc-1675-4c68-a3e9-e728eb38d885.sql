
-- Driver lifecycle fields on applications (driver records)
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS deposit_status text NOT NULL DEFAULT 'not_paid',
  ADD COLUMN IF NOT EXISTS deposit_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS deposit_paid numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weekly_rent numeric(10,2),
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'current',
  ADD COLUMN IF NOT EXISTS background_check_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS mvr_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS incident_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_status_check
  CHECK (status IN ('new','reviewing','approved','active','suspended','declined','closed'));

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_deposit_status_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_deposit_status_check
  CHECK (deposit_status IN ('not_paid','partially_paid','paid','refunded'));

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_payment_status_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_payment_status_check
  CHECK (payment_status IN ('current','late','past_due','collections'));

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_bg_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_bg_check
  CHECK (background_check_status IN ('pending','passed','failed'));

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_mvr_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_mvr_check
  CHECK (mvr_status IN ('pending','passed','failed'));

-- Reusable updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS applications_updated_at ON public.applications;
CREATE TRIGGER applications_updated_at BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PARTNERS
CREATE TABLE IF NOT EXISTS public.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  partner_type text NOT NULL DEFAULT 'other'
    CHECK (partner_type IN ('vehicle_owner','capital_partner','private_lender','jv_partner','other')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('prospect','active','paused','closed')),
  capital_committed numeric(12,2) DEFAULT 0,
  vehicles_contributed integer DEFAULT 0,
  monthly_payment numeric(12,2) DEFAULT 0,
  notes text,
  documents jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partners TO authenticated;
GRANT ALL ON public.partners TO service_role;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage partners" ON public.partners
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP TRIGGER IF EXISTS partners_updated_at ON public.partners;
CREATE TRIGGER partners_updated_at BEFORE UPDATE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PAYMENTS
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'rent'
    CHECK (type IN ('rent','deposit','late_fee','other')),
  amount numeric(10,2) NOT NULL DEFAULT 0,
  due_date date,
  paid_date date,
  status text NOT NULL DEFAULT 'current'
    CHECK (status IN ('paid','current','late','past_due','collections')),
  payment_method text,
  late_fees numeric(10,2) NOT NULL DEFAULT 0,
  balance_due numeric(10,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage payments" ON public.payments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP TRIGGER IF EXISTS payments_updated_at ON public.payments;
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS payments_driver_idx ON public.payments(driver_id);
CREATE INDEX IF NOT EXISTS payments_due_idx ON public.payments(due_date);

-- APP SETTINGS (single-row key/value)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage settings" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP TRIGGER IF EXISTS app_settings_updated_at ON public.app_settings;
CREATE TRIGGER app_settings_updated_at BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
