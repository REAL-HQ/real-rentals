
-- Canonical mileage history
CREATE TABLE public.odometer_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  mileage integer NOT NULL CHECK (mileage >= 0 AND mileage < 2000000),
  observed_on date NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('service','inspection','rental_checkout','rental_return','manual','fleet_inbox','title','registration','odometer_photo','incident','other')),
  source_id uuid,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  document_page integer,
  evidence_key text,
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','conflict','superseded')),
  supersedes_id uuid REFERENCES public.odometer_readings(id),
  note text,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX odometer_readings_evidence_uidx ON public.odometer_readings(evidence_key) WHERE evidence_key IS NOT NULL;
CREATE INDEX odometer_readings_vehicle_idx ON public.odometer_readings(vehicle_id, observed_on DESC);
GRANT SELECT, INSERT, UPDATE ON public.odometer_readings TO authenticated;
GRANT ALL ON public.odometer_readings TO service_role;
ALTER TABLE public.odometer_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read odometer" ON public.odometer_readings FOR SELECT TO authenticated USING (private.is_staff());
CREATE POLICY "Staff add odometer" ON public.odometer_readings FOR INSERT TO authenticated WITH CHECK (private.is_staff());
CREATE POLICY "Staff mark odometer" ON public.odometer_readings FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());

-- Readings are never edited in place except status/supersede
CREATE OR REPLACE FUNCTION public.odometer_readings_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE newer record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.mileage <> OLD.mileage OR NEW.observed_on <> OLD.observed_on OR NEW.vehicle_id <> OLD.vehicle_id
       OR NEW.source_type <> OLD.source_type OR NEW.document_id IS DISTINCT FROM OLD.document_id THEN
      RAISE EXCEPTION 'odometer_immutable: add a correcting reading instead';
    END IF;
    RETURN NEW;
  END IF;
  -- conflict: an earlier-or-same date reading with materially higher miles (>500)
  IF NEW.status = 'valid' AND EXISTS (
    SELECT 1 FROM public.odometer_readings r WHERE r.vehicle_id = NEW.vehicle_id AND r.status = 'valid'
      AND r.observed_on <= NEW.observed_on AND r.mileage > NEW.mileage + 500) THEN
    NEW.status := 'conflict';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER odometer_readings_guard BEFORE INSERT OR UPDATE ON public.odometer_readings FOR EACH ROW EXECUTE FUNCTION public.odometer_readings_guard();
CREATE OR REPLACE FUNCTION public.odometer_readings_block_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('app.odometer_cleanup', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'odometer_immutable: readings are never deleted';
END $$;
CREATE TRIGGER odometer_readings_no_delete BEFORE DELETE ON public.odometer_readings FOR EACH ROW EXECUTE FUNCTION public.odometer_readings_block_delete();

-- Current mileage = newest valid reading (by date, then miles); never lowered by older evidence
CREATE OR REPLACE FUNCTION public.vehicle_sync_current_odometer() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT mileage, observed_on INTO r FROM public.odometer_readings
   WHERE vehicle_id = COALESCE(NEW.vehicle_id, OLD.vehicle_id) AND status = 'valid'
   ORDER BY observed_on DESC, mileage DESC LIMIT 1;
  IF FOUND THEN
    UPDATE public.vehicles SET current_odometer = r.mileage, odometer_updated_at = r.observed_on::timestamptz
     WHERE id = COALESCE(NEW.vehicle_id, OLD.vehicle_id)
       AND (current_odometer IS DISTINCT FROM r.mileage);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER odometer_readings_sync AFTER INSERT OR UPDATE ON public.odometer_readings FOR EACH ROW EXECUTE FUNCTION public.vehicle_sync_current_odometer();

-- Service events: extend canonical maintenance_records
ALTER TABLE public.maintenance_records
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS labor_cost numeric,
  ADD COLUMN IF NOT EXISTS parts_cost numeric,
  ADD COLUMN IF NOT EXISTS tax_amount numeric,
  ADD COLUMN IF NOT EXISTS other_cost numeric,
  ADD COLUMN IF NOT EXISTS warranty_covered numeric,
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS priority text,
  ADD COLUMN IF NOT EXISTS vendor_name_raw text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS document_page integer,
  ADD COLUMN IF NOT EXISTS proposal_id uuid,
  ADD COLUMN IF NOT EXISTS original_extraction jsonb,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_records_proposal_uidx ON public.maintenance_records(proposal_id) WHERE proposal_id IS NOT NULL;

CREATE TABLE public.maintenance_record_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.maintenance_records(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'other',
  description text NOT NULL,
  quantity numeric,
  amount numeric,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_record_items_record_idx ON public.maintenance_record_items(record_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_record_items TO authenticated;
GRANT ALL ON public.maintenance_record_items TO service_role;
ALTER TABLE public.maintenance_record_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers manage service items" ON public.maintenance_record_items FOR ALL TO authenticated USING (private.is_manager()) WITH CHECK (private.is_manager());

-- One dollar counted once: an expense may point at its service event
ALTER TABLE public.vehicle_expenses ADD COLUMN IF NOT EXISTS maintenance_record_id uuid REFERENCES public.maintenance_records(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_expenses_maint_uidx ON public.vehicle_expenses(maintenance_record_id) WHERE maintenance_record_id IS NOT NULL;

-- vendor matching key
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS name_key text GENERATED ALWAYS AS (regexp_replace(lower(coalesce(name,'')), '[^a-z0-9]', '', 'g')) STORED;
CREATE INDEX IF NOT EXISTS vendors_name_key_idx ON public.vendors(name_key);

-- Company maintenance intervals
CREATE TABLE public.maintenance_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  interval_miles integer CHECK (interval_miles IS NULL OR interval_miles > 0),
  interval_days integer CHECK (interval_days IS NULL OR interval_days > 0),
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (interval_miles IS NOT NULL OR interval_days IS NOT NULL)
);
CREATE UNIQUE INDEX maintenance_defaults_item_uidx ON public.maintenance_defaults(lower(item));
GRANT SELECT ON public.maintenance_defaults TO authenticated;
GRANT ALL ON public.maintenance_defaults TO service_role;
ALTER TABLE public.maintenance_defaults ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read maintenance defaults" ON public.maintenance_defaults FOR SELECT TO authenticated USING (private.is_staff());
CREATE TRIGGER maintenance_defaults_updated_at BEFORE UPDATE ON public.maintenance_defaults FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.maintenance_schedules
  ADD COLUMN IF NOT EXISTS default_id uuid REFERENCES public.maintenance_defaults(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_override boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_schedules_vehicle_default_uidx ON public.maintenance_schedules(vehicle_id, default_id) WHERE default_id IS NOT NULL;

-- Downtime: opened/closed by human status changes into/out of Maintenance
CREATE TABLE public.vehicle_downtime (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  maintenance_record_id uuid REFERENCES public.maintenance_records(id) ON DELETE SET NULL,
  reason text NOT NULL DEFAULT 'maintenance',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  started_by uuid,
  ended_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vehicle_downtime_one_open_idx ON public.vehicle_downtime(vehicle_id) WHERE ended_at IS NULL;
GRANT SELECT ON public.vehicle_downtime TO authenticated;
GRANT ALL ON public.vehicle_downtime TO service_role;
ALTER TABLE public.vehicle_downtime ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read downtime" ON public.vehicle_downtime FOR SELECT TO authenticated USING (private.is_staff());

CREATE OR REPLACE FUNCTION public.vehicle_track_downtime() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'maintenance' THEN
      INSERT INTO public.vehicle_downtime(vehicle_id, started_by) VALUES (NEW.id, auth.uid()) ON CONFLICT DO NOTHING;
    ELSIF OLD.status = 'maintenance' THEN
      UPDATE public.vehicle_downtime SET ended_at = now(), ended_by = auth.uid() WHERE vehicle_id = NEW.id AND ended_at IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vehicles_track_downtime AFTER UPDATE OF status ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.vehicle_track_downtime();
