-- ---------------------------------------------------------------- 0. helpers

CREATE OR REPLACE FUNCTION private.is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('admin'::public.app_role, 'team'::public.app_role)
  )
$$;
REVOKE ALL ON FUNCTION private.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_staff() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.driver_rents_vehicle(_vehicle_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rentals
    WHERE vehicle_id = _vehicle_id AND driver_id = auth.uid() AND status = 'active'
  )
$$;
REVOKE ALL ON FUNCTION private.driver_rents_vehicle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.driver_rents_vehicle(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.owns_application(_application_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.applications WHERE id = _application_id AND user_id = auth.uid()
  )
$$;
REVOKE ALL ON FUNCTION private.owns_application(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.owns_application(uuid) TO authenticated, service_role;

-- ------------------------------------------------- 1. vehicle master data

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS vin text,
  ADD COLUMN IF NOT EXISTS license_plate text,
  ADD COLUMN IF NOT EXISTS plate_state text,
  ADD COLUMN IF NOT EXISTS plate_expires_on date,
  ADD COLUMN IF NOT EXISTS registration_state text,
  ADD COLUMN IF NOT EXISTS registration_expires_on date,
  ADD COLUMN IF NOT EXISTS title_status text,
  ADD COLUMN IF NOT EXISTS title_number text,
  ADD COLUMN IF NOT EXISTS lienholder text,
  ADD COLUMN IF NOT EXISTS gps_provider text,
  ADD COLUMN IF NOT EXISTS gps_device_id text,
  ADD COLUMN IF NOT EXISTS gps_installed_on date,
  ADD COLUMN IF NOT EXISTS toll_transponder_id text,
  ADD COLUMN IF NOT EXISTS toll_account text,
  ADD COLUMN IF NOT EXISTS insurance_carrier text,
  ADD COLUMN IF NOT EXISTS insurance_policy_number text,
  ADD COLUMN IF NOT EXISTS insurance_expires_on date,
  ADD COLUMN IF NOT EXISTS purchase_date date,
  ADD COLUMN IF NOT EXISTS purchase_price numeric,
  ADD COLUMN IF NOT EXISTS key_count integer,
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS odometer_updated_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_vin_unique_idx
  ON public.vehicles (upper(vin)) WHERE vin IS NOT NULL AND vin <> '';
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_plate_unique_idx
  ON public.vehicles (upper(license_plate)) WHERE license_plate IS NOT NULL AND license_plate <> '';

-- ------------------------------------ 2. renter insurance at application time

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS insurance_carrier text,
  ADD COLUMN IF NOT EXISTS insurance_policy_number text,
  ADD COLUMN IF NOT EXISTS insurance_expires_on date,
  ADD COLUMN IF NOT EXISTS insurance_rideshare_endorsement boolean,
  ADD COLUMN IF NOT EXISTS insurance_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS sms_opt_out_at timestamptz;

COMMENT ON COLUMN public.applications.insurance_status IS
  'unknown | declared | verified | expired | none — drives fast qualify/disqualify';

-- ---------------------------------------------------------------- 3. vendors

CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  vendor_type text NOT NULL DEFAULT 'maintenance',
  contact_name text,
  phone text,
  email text,
  website text,
  address text,
  city text,
  state text,
  zip text,
  market_id uuid REFERENCES public.markets(id) ON DELETE SET NULL,
  services text[] NOT NULL DEFAULT '{}',
  hours text,
  account_number text,
  rate_notes text,
  preferred boolean NOT NULL DEFAULT false,
  rating integer,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendors_rating_range CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5))
);
COMMENT ON COLUMN public.vendors.vendor_type IS
  'maintenance | body_shop | tires | towing | detailing | gps | insurance | dmv | parts | fuel | other';

CREATE INDEX IF NOT EXISTS vendors_type_idx ON public.vendors(vendor_type) WHERE is_active;
CREATE INDEX IF NOT EXISTS vendors_market_idx ON public.vendors(market_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors TO authenticated;
GRANT ALL ON public.vendors TO service_role;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage vendors" ON public.vendors
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());

CREATE TRIGGER vendors_set_updated_at BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.maintenance_records
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS odometer integer,
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS performed_on date,
  ADD COLUMN IF NOT EXISTS schedule_id uuid;

-- ---------------------------------------------- 4. inspection checklists

CREATE TABLE IF NOT EXISTS public.inspection_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  inspection_type text NOT NULL DEFAULT 'pre_delivery',
  description text,
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.inspection_templates.inspection_type IS
  'pre_delivery | return | periodic | post_maintenance';

CREATE TABLE IF NOT EXISTS public.inspection_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.inspection_templates(id) ON DELETE CASCADE,
  section text NOT NULL DEFAULT 'General',
  label text NOT NULL,
  help_text text,
  requires_photo boolean NOT NULL DEFAULT false,
  is_critical boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inspection_template_items_template_idx
  ON public.inspection_template_items(template_id, sort_order);

CREATE TABLE IF NOT EXISTS public.inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.inspection_templates(id) ON DELETE SET NULL,
  inspection_type text NOT NULL DEFAULT 'pre_delivery',
  status text NOT NULL DEFAULT 'in_progress',
  odometer integer,
  fuel_level text,
  exterior_notes text,
  interior_notes text,
  notes text,
  inspector_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  inspector_name text,
  driver_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  driver_signature_name text,
  driver_signed_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.inspections.status IS 'in_progress | passed | failed | void';
COMMENT ON COLUMN public.inspections.fuel_level IS 'empty | quarter | half | three_quarter | full';

CREATE INDEX IF NOT EXISTS inspections_vehicle_idx ON public.inspections(vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inspections_rental_idx ON public.inspections(rental_id);

CREATE TABLE IF NOT EXISTS public.inspection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  section text NOT NULL DEFAULT 'General',
  label text NOT NULL,
  result text NOT NULL DEFAULT 'pending',
  is_critical boolean NOT NULL DEFAULT false,
  requires_photo boolean NOT NULL DEFAULT false,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.inspection_items.result IS 'pending | pass | fail | na';
CREATE INDEX IF NOT EXISTS inspection_items_inspection_idx
  ON public.inspection_items(inspection_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inspection_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inspection_template_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inspections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inspection_items TO authenticated;
GRANT ALL ON public.inspection_templates TO service_role;
GRANT ALL ON public.inspection_template_items TO service_role;
GRANT ALL ON public.inspections TO service_role;
GRANT ALL ON public.inspection_items TO service_role;

ALTER TABLE public.inspection_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage inspection templates" ON public.inspection_templates
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY "Staff manage inspection template items" ON public.inspection_template_items
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY "Staff manage inspections" ON public.inspections
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY "Staff manage inspection items" ON public.inspection_items
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());

CREATE POLICY "Drivers read their inspections" ON public.inspections
  FOR SELECT TO authenticated
  USING (driver_user_id = auth.uid() OR private.driver_rents_vehicle(vehicle_id));
CREATE POLICY "Drivers read their inspection items" ON public.inspection_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.inspections i
    WHERE i.id = inspection_items.inspection_id
      AND (i.driver_user_id = auth.uid() OR private.driver_rents_vehicle(i.vehicle_id))
  ));

CREATE TRIGGER inspection_templates_set_updated_at BEFORE UPDATE ON public.inspection_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER inspections_set_updated_at BEFORE UPDATE ON public.inspections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER inspection_items_set_updated_at BEFORE UPDATE ON public.inspection_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------- 5. condition media

CREATE TABLE IF NOT EXISTS public.condition_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  inspection_id uuid REFERENCES public.inspections(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  phase text NOT NULL DEFAULT 'checkout',
  angle text,
  media_type text NOT NULL DEFAULT 'photo',
  storage_bucket text NOT NULL DEFAULT 'condition-media',
  storage_path text NOT NULL,
  file_name text,
  mime_type text,
  size_bytes bigint,
  captured_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  captured_by_role text NOT NULL DEFAULT 'driver',
  caption text,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.condition_media.phase IS
  'checkout (before booking) | checkin (after booking) | damage | other';
COMMENT ON COLUMN public.condition_media.captured_by_role IS 'driver | staff';

CREATE INDEX IF NOT EXISTS condition_media_vehicle_idx
  ON public.condition_media(vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS condition_media_rental_idx ON public.condition_media(rental_id, phase);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.condition_media TO authenticated;
GRANT ALL ON public.condition_media TO service_role;
ALTER TABLE public.condition_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage condition media" ON public.condition_media
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY "Drivers read condition media on their vehicle" ON public.condition_media
  FOR SELECT TO authenticated
  USING (captured_by = auth.uid() OR private.driver_rents_vehicle(vehicle_id));
CREATE POLICY "Drivers add condition media on their vehicle" ON public.condition_media
  FOR INSERT TO authenticated
  WITH CHECK (
    captured_by = auth.uid()
    AND captured_by_role = 'driver'
    AND private.driver_rents_vehicle(vehicle_id)
  );

-- ------------------------------------------------ 6. maintenance schedules

CREATE TABLE IF NOT EXISTS public.maintenance_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  item text NOT NULL,
  category text NOT NULL DEFAULT 'routine',
  interval_miles integer,
  interval_days integer,
  last_done_on date,
  last_done_miles integer,
  next_due_on date,
  next_due_miles integer,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_schedules_has_interval
    CHECK (interval_miles IS NOT NULL OR interval_days IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS maintenance_schedules_vehicle_idx
  ON public.maintenance_schedules(vehicle_id) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_schedules_vehicle_item_idx
  ON public.maintenance_schedules(vehicle_id, lower(item));

ALTER TABLE public.maintenance_records
  ADD CONSTRAINT maintenance_records_schedule_fkey
  FOREIGN KEY (schedule_id) REFERENCES public.maintenance_schedules(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.maintenance_schedule_roll_next()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.interval_days IS NOT NULL AND NEW.last_done_on IS NOT NULL THEN
    NEW.next_due_on := NEW.last_done_on + (NEW.interval_days || ' days')::interval;
  END IF;
  IF NEW.interval_miles IS NOT NULL AND NEW.last_done_miles IS NOT NULL THEN
    NEW.next_due_miles := NEW.last_done_miles + NEW.interval_miles;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER maintenance_schedules_roll_next
  BEFORE INSERT OR UPDATE ON public.maintenance_schedules
  FOR EACH ROW EXECUTE FUNCTION public.maintenance_schedule_roll_next();
CREATE TRIGGER maintenance_schedules_set_updated_at BEFORE UPDATE ON public.maintenance_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_schedules TO authenticated;
GRANT ALL ON public.maintenance_schedules TO service_role;
ALTER TABLE public.maintenance_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage maintenance schedules" ON public.maintenance_schedules
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY "Drivers read schedules on their vehicle" ON public.maintenance_schedules
  FOR SELECT TO authenticated USING (private.driver_rents_vehicle(vehicle_id));