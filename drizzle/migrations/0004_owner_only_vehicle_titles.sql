-- Backup snapshot of affected records (taken before any change)
CREATE TABLE IF NOT EXISTS private.vehicle_title_backup_20261008 AS
  SELECT id AS vehicle_id, title_number, title_status, now() AS captured_at FROM public.vehicles;

-- Owner-only title store
CREATE TABLE public.vehicle_titles (
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id) ON DELETE CASCADE,
  title_number text,
  title_status text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_titles TO authenticated;
GRANT ALL ON public.vehicle_titles TO service_role;
ALTER TABLE public.vehicle_titles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage vehicle titles" ON public.vehicle_titles
  FOR ALL TO authenticated USING (private.is_owner()) WITH CHECK (private.is_owner());

-- Safe operational indicator
ALTER TABLE public.vehicles ADD COLUMN title_on_file boolean NOT NULL DEFAULT false;

-- Copy (no loss) then verify before clearing
INSERT INTO public.vehicle_titles (vehicle_id, title_number, title_status)
  SELECT id, title_number, title_status FROM public.vehicles
  WHERE title_number IS NOT NULL OR title_status IS NOT NULL;
UPDATE public.vehicles v SET title_on_file = true
  FROM public.vehicle_titles t WHERE t.vehicle_id = v.id;
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM public.vehicles v
  LEFT JOIN public.vehicle_titles t ON t.vehicle_id = v.id
  WHERE (v.title_number IS NOT NULL OR v.title_status IS NOT NULL)
    AND (t.vehicle_id IS NULL OR t.title_number IS DISTINCT FROM v.title_number OR t.title_status IS DISTINCT FROM v.title_status);
  IF bad > 0 THEN RAISE EXCEPTION 'Title copy verification failed for % vehicles', bad; END IF;
END $$;
UPDATE public.vehicles SET title_number = NULL, title_status = NULL
  WHERE title_number IS NOT NULL OR title_status IS NOT NULL;

-- Any future write to the old columns is diverted into the Owner-only table
CREATE OR REPLACE FUNCTION public.vehicles_divert_title()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.title_number IS NOT NULL OR NEW.title_status IS NOT NULL THEN
    INSERT INTO public.vehicle_titles (vehicle_id, title_number, title_status, updated_by)
    VALUES (NEW.id, NEW.title_number, NEW.title_status, auth.uid())
    ON CONFLICT (vehicle_id) DO UPDATE SET
      title_number = COALESCE(EXCLUDED.title_number, vehicle_titles.title_number),
      title_status = COALESCE(EXCLUDED.title_status, vehicle_titles.title_status),
      updated_at = now(), updated_by = EXCLUDED.updated_by;
    NEW.title_number := NULL;
    NEW.title_status := NULL;
    NEW.title_on_file := true;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vehicles_divert_title_ins BEFORE INSERT ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.vehicles_divert_title();
CREATE TRIGGER vehicles_divert_title_upd BEFORE UPDATE OF title_number, title_status ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.vehicles_divert_title();
-- The insert trigger runs before the row exists; defer the title row via AFTER trigger instead
DROP TRIGGER vehicles_divert_title_ins ON public.vehicles;
CREATE OR REPLACE FUNCTION public.vehicles_divert_title_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.title_number IS NOT NULL OR NEW.title_status IS NOT NULL THEN
    INSERT INTO public.vehicle_titles (vehicle_id, title_number, title_status, updated_by)
    VALUES (NEW.id, NEW.title_number, NEW.title_status, auth.uid())
    ON CONFLICT (vehicle_id) DO NOTHING;
    UPDATE public.vehicles SET title_number = NULL, title_status = NULL, title_on_file = true WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER vehicles_divert_title_after_ins AFTER INSERT ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.vehicles_divert_title_after_insert();
REVOKE EXECUTE ON FUNCTION public.vehicles_divert_title() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.vehicles_divert_title_after_insert() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.vehicles.title_number IS 'DEPRECATED: moved to Owner-only public.vehicle_titles; writes are diverted';
COMMENT ON COLUMN public.vehicles.title_status IS 'DEPRECATED: moved to Owner-only public.vehicle_titles; writes are diverted';

-- Title provenance becomes Owner-only
DROP POLICY "Staff read vehicle provenance" ON public.vehicle_field_provenance;
CREATE POLICY "Staff read vehicle provenance" ON public.vehicle_field_provenance FOR SELECT TO authenticated
USING (private.is_staff()
  AND ((field <> ALL (ARRAY['legal_owner','lienholder','purchase_price','purchase_date','payoff_amount','loan_reference','monthly_payment','loan_maturity_date','seller_dealer','ownership_type','title_number','title_status'])) OR private.is_owner())
  AND ((field <> ALL (ARRAY['service.total','service.labor_total','service.parts_total','service.tax_total'])) OR private.is_manager()));

-- One preview start/end per session key
CREATE UNIQUE INDEX audit_log_driver_preview_session_uniq
  ON public.audit_log (action, entity_id, ((metadata->>'session_key')))
  WHERE action IN ('driver_preview.started','driver_preview.ended') AND (metadata->>'session_key') IS NOT NULL;