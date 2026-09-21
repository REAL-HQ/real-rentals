-- =============================================================================
-- Fleet operations foundation
--
-- Adds the operational backbone the back office was missing:
--   1. Vehicle master data (VIN, plates, GPS, registration, insurance, keys)
--   2. Renter insurance detail captured at application time
--   3. Vendors directory (maintenance, towing, GPS, insurance, ...)
--   4. Inspection checklists (templates + completed inspections)
--   5. Condition media — before/after photos & video from staff AND renters
--   6. Per-vehicle maintenance schedules with automatic next-due rollover
--   7. Automation workflows (trigger -> delayed SMS/email steps)
--   8. Outbound message log + SMS opt-out ledger
--
-- Conventions followed from earlier migrations:
--   * RLS helpers live in the `private` schema (private.has_role).
--   * `driver_id` on legacy tables is ambiguous — new tables use explicit
--     `application_id` (applications.id) and `driver_user_id` (auth.users.id).
-- =============================================================================

-- ---------------------------------------------------------------- 0. helpers

-- Staff = admin or team. Used by every policy below so the check stays in one
-- place instead of being repeated as `has_role(...) OR has_role(...)`.
CREATE OR REPLACE FUNCTION private.is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('admin'::public.app_role, 'team'::public.app_role)
  )
$$;
REVOKE ALL ON FUNCTION private.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_staff() TO authenticated, service_role;

-- Does the signed-in user rent this vehicle right now?
CREATE OR REPLACE FUNCTION private.driver_rents_vehicle(_vehicle_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rentals
    WHERE vehicle_id = _vehicle_id AND driver_id = auth.uid() AND status = 'active'
  )
$$;
REVOKE ALL ON FUNCTION private.driver_rents_vehicle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.driver_rents_vehicle(uuid) TO authenticated, service_role;

-- Does the signed-in user own this application?
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

-- VIN and plate must be unique across the fleet, but only when present, so
-- partially-entered vehicles don't collide on NULL.
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

-- Point maintenance records at a vendor, and record what the shop actually did.
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

-- A renter sees the inspections done on the car they are renting, so the
-- condition record at handover is not one-sided.
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

-- Renters see every photo on the car they rent (theirs and ours — that is the
-- point of the proof-of-condition record) but may only add their own.
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

-- Keep next_due_* derived from last_done_* + interval so callers only ever
-- record "this was done at X miles on Y date" and the due date follows.
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

-- ------------------------------------------------- 7. automation workflows

CREATE TABLE IF NOT EXISTS public.automation_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  trigger_event text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  quiet_hours_start integer NOT NULL DEFAULT 21,
  quiet_hours_end integer NOT NULL DEFAULT 8,
  stop_on_reply boolean NOT NULL DEFAULT true,
  stop_on_statuses text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_quiet_hours_valid CHECK (
    quiet_hours_start BETWEEN 0 AND 23 AND quiet_hours_end BETWEEN 0 AND 23
  )
);
COMMENT ON COLUMN public.automation_workflows.trigger_event IS
  'application_submitted | application_abandoned | application_approved | rental_started | payment_past_due';
COMMENT ON COLUMN public.automation_workflows.stop_on_statuses IS
  'Application statuses that cancel an in-flight enrollment (e.g. approved, rejected)';

CREATE TABLE IF NOT EXISTS public.automation_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.automation_workflows(id) ON DELETE CASCADE,
  step_order integer NOT NULL DEFAULT 1,
  delay_minutes integer NOT NULL DEFAULT 0,
  channel text NOT NULL DEFAULT 'sms',
  subject text,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_steps_channel CHECK (channel IN ('sms', 'email')),
  CONSTRAINT automation_steps_delay_nonneg CHECK (delay_minutes >= 0)
);
COMMENT ON COLUMN public.automation_steps.delay_minutes IS
  'Minutes after enrollment (not after the previous step) that this step fires';
CREATE UNIQUE INDEX IF NOT EXISTS automation_steps_order_idx
  ON public.automation_steps(workflow_id, step_order);

CREATE TABLE IF NOT EXISTS public.automation_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.automation_workflows(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  current_step integer NOT NULL DEFAULT 0,
  next_run_at timestamptz,
  cancelled_reason text,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.automation_enrollments.status IS 'active | completed | cancelled';

-- One live enrollment per workflow per application: re-running the trigger
-- must not double-text an applicant.
CREATE UNIQUE INDEX IF NOT EXISTS automation_enrollments_unique_idx
  ON public.automation_enrollments(workflow_id, application_id)
  WHERE application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS automation_enrollments_due_idx
  ON public.automation_enrollments(next_run_at) WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_workflows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_enrollments TO authenticated;
GRANT ALL ON public.automation_workflows TO service_role;
GRANT ALL ON public.automation_steps TO service_role;
GRANT ALL ON public.automation_enrollments TO service_role;

ALTER TABLE public.automation_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage automation workflows" ON public.automation_workflows
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY "Staff manage automation steps" ON public.automation_steps
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY "Staff manage automation enrollments" ON public.automation_enrollments
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());

CREATE TRIGGER automation_workflows_set_updated_at BEFORE UPDATE ON public.automation_workflows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER automation_steps_set_updated_at BEFORE UPDATE ON public.automation_steps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER automation_enrollments_set_updated_at BEFORE UPDATE ON public.automation_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------ 8. outbound message log + SMS opt-out ledger

CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  to_address text NOT NULL,
  from_address text,
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  provider text,
  provider_message_id text,
  error text,
  kind text,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  workflow_id uuid REFERENCES public.automation_workflows(id) ON DELETE SET NULL,
  enrollment_id uuid REFERENCES public.automation_enrollments(id) ON DELETE SET NULL,
  step_id uuid REFERENCES public.automation_steps(id) ON DELETE SET NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbound_messages_channel CHECK (channel IN ('sms', 'email')),
  CONSTRAINT outbound_messages_status CHECK (status IN ('queued', 'sent', 'failed', 'skipped'))
);
CREATE INDEX IF NOT EXISTS outbound_messages_application_idx
  ON public.outbound_messages(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outbound_messages_created_idx
  ON public.outbound_messages(created_at DESC);
-- Dedupe guard: one send per step per enrollment, enforced in the database so a
-- cron overlap cannot double-send.
CREATE UNIQUE INDEX IF NOT EXISTS outbound_messages_enrollment_step_idx
  ON public.outbound_messages(enrollment_id, step_id)
  WHERE enrollment_id IS NOT NULL AND step_id IS NOT NULL;

GRANT SELECT ON public.outbound_messages TO authenticated;
GRANT ALL ON public.outbound_messages TO service_role;
ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read outbound messages" ON public.outbound_messages
  FOR SELECT TO authenticated USING (private.is_staff());

-- Opt-out ledger. Keyed by E.164 phone so a STOP applies across every
-- application that person ever filed.
CREATE TABLE IF NOT EXISTS public.sms_opt_outs (
  phone text PRIMARY KEY,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sms_opt_outs TO authenticated;
GRANT ALL ON public.sms_opt_outs TO service_role;
ALTER TABLE public.sms_opt_outs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read sms opt-outs" ON public.sms_opt_outs
  FOR SELECT TO authenticated USING (private.is_staff());

-- ---------------------------------------------------------- 9. cron plumbing

INSERT INTO private.cron_tokens (name, token)
VALUES ('automations', encode(extensions.gen_random_bytes(24), 'hex'))
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'automations-every-5-min';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

SELECT cron.schedule(
  'automations-every-5-min',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://drivereal.com/api/public/cron/automations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = 'automations')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);

-- ------------------------------------------------------ 10. storage buckets

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'condition-media', 'condition-media', false, 52428800,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','video/mp4','video/quicktime']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-docs', 'vehicle-docs', false, 20971520,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Condition media is written through the server (service role) which bypasses
-- RLS; these policies let staff and the renting driver read directly.
DROP POLICY IF EXISTS "Staff manage condition media objects" ON storage.objects;
CREATE POLICY "Staff manage condition media objects" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'condition-media' AND private.is_staff())
  WITH CHECK (bucket_id = 'condition-media' AND private.is_staff());

DROP POLICY IF EXISTS "Staff manage vehicle doc objects" ON storage.objects;
CREATE POLICY "Staff manage vehicle doc objects" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'vehicle-docs' AND private.is_staff())
  WITH CHECK (bucket_id = 'vehicle-docs' AND private.is_staff());

-- ---------------------------------------------- 11. default seed content

-- A pre-delivery checklist modelled on what Turo/Uber hosts run before
-- handing over keys. Seeded once; staff can edit or add templates in the UI.
INSERT INTO public.inspection_templates (name, inspection_type, description, is_default)
SELECT 'Pre-Delivery Inspection', 'pre_delivery',
       'Run before every vehicle leaves the lot. Critical items block release.', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.inspection_templates WHERE inspection_type = 'pre_delivery' AND is_default
);

INSERT INTO public.inspection_template_items (template_id, section, label, requires_photo, is_critical, sort_order)
SELECT t.id, v.section, v.label, v.requires_photo, v.is_critical, v.sort_order
FROM public.inspection_templates t
CROSS JOIN (VALUES
  ('Exterior', 'Body free of new dents, dings or scratches', true,  false, 10),
  ('Exterior', 'Windshield free of cracks and chips',        false, true,  20),
  ('Exterior', 'All lights working (head, tail, brake, turn)', false, true,  30),
  ('Exterior', 'Mirrors intact and adjustable',              false, false, 40),
  ('Tires',    'Tread depth above 4/32" on all four tires',  true,  true,  50),
  ('Tires',    'Tire pressure set to door-jamb spec',        false, true,  60),
  ('Tires',    'Spare tire / inflation kit present',         false, false, 70),
  ('Fluids',   'Oil level and life within range',            false, true,  80),
  ('Fluids',   'Coolant, brake and washer fluid topped off', false, false, 90),
  ('Brakes',   'No grinding or pulling on test drive',       false, true,  100),
  ('Interior', 'Interior cleaned and detailed',              true,  false, 110),
  ('Interior', 'A/C and heat blow cold and hot',             false, true,  120),
  ('Interior', 'Seat belts latch and retract',               false, true,  130),
  ('Interior', 'No active dashboard warning lights',         true,  true,  140),
  ('Docs',     'Registration in glovebox and unexpired',     true,  true,  150),
  ('Docs',     'Insurance card in glovebox and unexpired',   true,  true,  160),
  ('Tech',     'GPS tracker online and reporting',           false, true,  170),
  ('Tech',     'Toll transponder present and mounted',       false, false, 180),
  ('Handover', 'Both key fobs present and working',          false, true,  190),
  ('Handover', 'Fuel level recorded and photographed',       true,  false, 200),
  ('Handover', 'Odometer recorded and photographed',         true,  true,  210)
) AS v(section, label, requires_photo, is_critical, sort_order)
WHERE t.inspection_type = 'pre_delivery' AND t.is_default
  AND NOT EXISTS (SELECT 1 FROM public.inspection_template_items i WHERE i.template_id = t.id);

-- Return checklist for when a vehicle comes back.
INSERT INTO public.inspection_templates (name, inspection_type, description, is_default)
SELECT 'Return Inspection', 'return',
       'Run when a vehicle comes back. Compare against the checkout photos.', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.inspection_templates WHERE inspection_type = 'return' AND is_default
);

INSERT INTO public.inspection_template_items (template_id, section, label, requires_photo, is_critical, sort_order)
SELECT t.id, v.section, v.label, v.requires_photo, v.is_critical, v.sort_order
FROM public.inspection_templates t
CROSS JOIN (VALUES
  ('Exterior', 'New damage compared to checkout photos', true,  true,  10),
  ('Tires',    'Tread and pressure still within spec',   false, true,  20),
  ('Interior', 'Interior condition and cleanliness',     true,  false, 30),
  ('Interior', 'No new dashboard warning lights',        false, true,  40),
  ('Handover', 'Odometer recorded and photographed',     true,  true,  50),
  ('Handover', 'Fuel level recorded and photographed',   true,  false, 60),
  ('Handover', 'Both key fobs returned',                 false, true,  70),
  ('Handover', 'Toll transponder returned',              false, false, 80),
  ('Handover', 'Personal belongings removed',            false, false, 90)
) AS v(section, label, requires_photo, is_critical, sort_order)
WHERE t.inspection_type = 'return' AND t.is_default
  AND NOT EXISTS (SELECT 1 FROM public.inspection_template_items i WHERE i.template_id = t.id);

-- Post-application SMS follow-up, seeded INACTIVE so nothing sends until the
-- Twilio credentials are in place and an operator switches it on.
INSERT INTO public.automation_workflows
  (name, description, trigger_event, is_active, stop_on_statuses)
SELECT 'New Applicant Follow-Up',
       'Texts a new applicant within minutes, then nudges at 1 day and 3 days if they have not been approved.',
       'application_submitted', false, ARRAY['approved','rejected','active']
WHERE NOT EXISTS (
  SELECT 1 FROM public.automation_workflows WHERE trigger_event = 'application_submitted'
);

INSERT INTO public.automation_steps (workflow_id, step_order, delay_minutes, channel, body)
SELECT w.id, v.step_order, v.delay_minutes, 'sms', v.body
FROM public.automation_workflows w
CROSS JOIN (VALUES
  (1, 5,    'Hi {{first_name}}, it''s REAL RENTALS — thanks for applying! We''re reviewing your application now and will reach out shortly. Questions? Just reply here. Reply STOP to opt out.'),
  (2, 1440, 'Hi {{first_name}}, REAL RENTALS here. Your application is still open — we just need a few details to get you approved. Reply here or call us at (813) 699-9118. Reply STOP to opt out.'),
  (3, 4320, 'Hi {{first_name}}, last check-in from REAL RENTALS — we still have vehicles available in {{city}}. Want us to hold one for you? Reply YES. Reply STOP to opt out.')
) AS v(step_order, delay_minutes, body)
WHERE w.trigger_event = 'application_submitted'
  AND NOT EXISTS (SELECT 1 FROM public.automation_steps s WHERE s.workflow_id = w.id);
