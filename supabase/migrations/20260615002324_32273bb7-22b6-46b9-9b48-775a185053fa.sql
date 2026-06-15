
-- =========================================
-- Column additions
-- =========================================
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS applications_user_id_idx ON public.applications(user_id);

-- =========================================
-- Markets (cities served)
-- =========================================
CREATE TABLE IF NOT EXISTS public.markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  state text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.markets TO anon, authenticated;
GRANT ALL ON public.markets TO service_role;
ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Markets are publicly readable" ON public.markets FOR SELECT USING (true);
CREATE POLICY "Admins manage markets" ON public.markets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
CREATE TRIGGER markets_set_updated_at BEFORE UPDATE ON public.markets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Vehicles.market_id (after markets exists)
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS market_id uuid REFERENCES public.markets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS vehicles_market_id_idx ON public.vehicles(market_id);

-- =========================================
-- Sites (per-market microsites) + content blocks
-- =========================================
CREATE TABLE IF NOT EXISTS public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid REFERENCES public.markets(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sites TO anon, authenticated;
GRANT ALL ON public.sites TO service_role;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Published sites are publicly readable" ON public.sites FOR SELECT USING (is_published = true OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
CREATE POLICY "Admins manage sites" ON public.sites FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
CREATE TRIGGER sites_set_updated_at BEFORE UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.site_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, key)
);
GRANT SELECT ON public.site_content TO anon, authenticated;
GRANT ALL ON public.site_content TO service_role;
ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Site content publicly readable" ON public.site_content FOR SELECT USING (true);
CREATE POLICY "Admins manage site_content" ON public.site_content FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
CREATE TRIGGER site_content_set_updated_at BEFORE UPDATE ON public.site_content FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- Shops (preferred mechanics, market-scoped)
-- =========================================
CREATE TABLE IF NOT EXISTS public.shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  phone text,
  services text[] NOT NULL DEFAULT '{}',
  market_id uuid REFERENCES public.markets(id) ON DELETE SET NULL,
  hours text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shops TO authenticated;
GRANT ALL ON public.shops TO service_role;
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Active shops readable by signed-in users" ON public.shops FOR SELECT TO authenticated USING (is_active = true OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
CREATE POLICY "Admins manage shops" ON public.shops FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
CREATE TRIGGER shops_set_updated_at BEFORE UPDATE ON public.shops FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- Rentals (active driver <-> vehicle link)
-- =========================================
CREATE TABLE IF NOT EXISTS public.rentals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  status text NOT NULL DEFAULT 'active',
  weekly_rate numeric NOT NULL DEFAULT 0,
  deposit_amount numeric NOT NULL DEFAULT 0,
  deposit_held boolean NOT NULL DEFAULT false,
  next_payment_due date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rentals TO authenticated;
GRANT ALL ON public.rentals TO service_role;
ALTER TABLE public.rentals ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS rentals_driver_idx ON public.rentals(driver_id);
CREATE INDEX IF NOT EXISTS rentals_vehicle_idx ON public.rentals(vehicle_id);

-- Helper functions (need to exist before policies using them)
CREATE OR REPLACE FUNCTION public.driver_owns_rental(_rental_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.rentals WHERE id = _rental_id AND driver_id = auth.uid())
$$;
REVOKE EXECUTE ON FUNCTION public.driver_owns_rental(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_owns_rental(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.partner_owns_rental(_rental_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rentals r
    JOIN public.vehicles v ON v.id = r.vehicle_id
    JOIN public.partners p ON p.id = v.partner_id
    WHERE r.id = _rental_id AND p.user_id = auth.uid()
  )
$$;
REVOKE EXECUTE ON FUNCTION public.partner_owns_rental(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_owns_rental(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.driver_market_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.market_id
  FROM public.rentals r
  JOIN public.vehicles v ON v.id = r.vehicle_id
  WHERE r.driver_id = auth.uid() AND r.status = 'active'
  LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.driver_market_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_market_id() TO authenticated, service_role;

CREATE POLICY "Drivers read own rentals" ON public.rentals FOR SELECT TO authenticated USING (driver_id = auth.uid());
CREATE POLICY "Partners read rentals on own vehicles" ON public.rentals FOR SELECT TO authenticated USING (public.partner_owns_vehicle(vehicle_id));
CREATE POLICY "Admins manage all rentals" ON public.rentals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
CREATE TRIGGER rentals_set_updated_at BEFORE UPDATE ON public.rentals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Driver-scoped shop visibility (their market only)
CREATE POLICY "Drivers read shops in their market" ON public.shops FOR SELECT TO authenticated
  USING (is_active = true AND market_id IS NOT NULL AND market_id = public.driver_market_id());

-- =========================================
-- Messages
-- =========================================
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL DEFAULT gen_random_uuid(),
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.partners(id) ON DELETE CASCADE,
  body text NOT NULL,
  kind text NOT NULL DEFAULT 'message',
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS messages_thread_idx ON public.messages(thread_id);
CREATE INDEX IF NOT EXISTS messages_driver_idx ON public.messages(driver_id);
CREATE INDEX IF NOT EXISTS messages_partner_idx ON public.messages(partner_id);
CREATE POLICY "Participants read own messages" ON public.messages FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid() OR driver_id = auth.uid() OR public.is_partner_owner(partner_id));
CREATE POLICY "Participants send messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid());
CREATE POLICY "Recipient marks read" ON public.messages FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid() OR driver_id = auth.uid() OR public.is_partner_owner(partner_id))
  WITH CHECK (recipient_id = auth.uid() OR driver_id = auth.uid() OR public.is_partner_owner(partner_id));
CREATE POLICY "Admins manage all messages" ON public.messages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));

-- =========================================
-- Issues (driver reports)
-- =========================================
CREATE TABLE IF NOT EXISTS public.issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'other',
  severity text NOT NULL DEFAULT 'normal',
  title text NOT NULL,
  body text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.issues TO authenticated;
GRANT ALL ON public.issues TO service_role;
ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS issues_driver_idx ON public.issues(driver_id);
CREATE POLICY "Drivers read own issues" ON public.issues FOR SELECT TO authenticated USING (driver_id = auth.uid());
CREATE POLICY "Drivers create own issues" ON public.issues FOR INSERT TO authenticated WITH CHECK (driver_id = auth.uid());
CREATE POLICY "Partners read issues on own vehicles" ON public.issues FOR SELECT TO authenticated USING (vehicle_id IS NOT NULL AND public.partner_owns_vehicle(vehicle_id));
CREATE POLICY "Admins manage all issues" ON public.issues FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
CREATE TRIGGER issues_set_updated_at BEFORE UPDATE ON public.issues FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- Payouts (monthly partner statements)
-- =========================================
CREATE TABLE IF NOT EXISTS public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  gross_rent numeric NOT NULL DEFAULT 0,
  partner_share numeric NOT NULL DEFAULT 0,
  maintenance_share numeric NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  paid_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, period_start, period_end)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payouts TO authenticated;
GRANT ALL ON public.payouts TO service_role;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Partners read own payouts" ON public.payouts FOR SELECT TO authenticated USING (public.is_partner_owner(partner_id));
CREATE POLICY "Admins manage payouts" ON public.payouts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
CREATE TRIGGER payouts_set_updated_at BEFORE UPDATE ON public.payouts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- Referrals
-- =========================================
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_email text,
  referred_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'invited',
  reward_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Drivers read own referrals" ON public.referrals FOR SELECT TO authenticated USING (referrer_id = auth.uid());
CREATE POLICY "Drivers create own referrals" ON public.referrals FOR INSERT TO authenticated WITH CHECK (referrer_id = auth.uid());
CREATE POLICY "Admins manage referrals" ON public.referrals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
CREATE TRIGGER referrals_set_updated_at BEFORE UPDATE ON public.referrals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- Maintenance records
-- =========================================
CREATE TABLE IF NOT EXISTS public.maintenance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  item text NOT NULL,
  category text NOT NULL DEFAULT 'routine',
  status text NOT NULL DEFAULT 'upcoming',
  due_date date,
  due_mileage int,
  total_cost numeric NOT NULL DEFAULT 0,
  cost_split text NOT NULL DEFAULT '50_50',
  partner_share numeric NOT NULL DEFAULT 0,
  company_share numeric NOT NULL DEFAULT 0,
  shop_id uuid REFERENCES public.shops(id) ON DELETE SET NULL,
  notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_records TO authenticated;
GRANT ALL ON public.maintenance_records TO service_role;
ALTER TABLE public.maintenance_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS maintenance_vehicle_idx ON public.maintenance_records(vehicle_id);
CREATE POLICY "Drivers read own maintenance" ON public.maintenance_records FOR SELECT TO authenticated USING (driver_id = auth.uid());
CREATE POLICY "Partners read maintenance on own vehicles" ON public.maintenance_records FOR SELECT TO authenticated USING (public.partner_owns_vehicle(vehicle_id));
CREATE POLICY "Admins manage maintenance" ON public.maintenance_records FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
CREATE TRIGGER maintenance_set_updated_at BEFORE UPDATE ON public.maintenance_records FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- Notifications (driver-facing in-app alerts)
-- =========================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.partners(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  body text,
  channels text[] NOT NULL DEFAULT ARRAY['in_app']::text[],
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS notifications_driver_idx ON public.notifications(driver_id);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications(user_id);
CREATE POLICY "Recipients read own notifications" ON public.notifications FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR user_id = auth.uid() OR public.is_partner_owner(partner_id));
CREATE POLICY "Recipients mark read" ON public.notifications FOR UPDATE TO authenticated
  USING (driver_id = auth.uid() OR user_id = auth.uid() OR public.is_partner_owner(partner_id))
  WITH CHECK (driver_id = auth.uid() OR user_id = auth.uid() OR public.is_partner_owner(partner_id));
CREATE POLICY "Admins manage notifications" ON public.notifications FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
