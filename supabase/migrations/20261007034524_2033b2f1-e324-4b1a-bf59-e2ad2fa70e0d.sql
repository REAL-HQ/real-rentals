CREATE TABLE public.fleet_service_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.fleet_import_batches(id) ON DELETE CASCADE,
  group_key text NOT NULL,
  item_ids uuid[] NOT NULL DEFAULT '{}',
  kind text NOT NULL DEFAULT 'unidentified' CHECK (kind IN ('match','conflict','unidentified')),
  match_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  match_basis text,
  operational jsonb NOT NULL DEFAULT '{}'::jsonb,
  financial jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applying','applied','ignored','failed','superseded')),
  applied_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  applied_by uuid, applied_at timestamptz, result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fleet_service_transactions TO authenticated;
GRANT ALL ON public.fleet_service_transactions TO service_role;
ALTER TABLE public.fleet_service_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read service transactions" ON public.fleet_service_transactions
  FOR SELECT TO authenticated USING (private.is_manager());
CREATE INDEX fleet_service_transactions_batch_idx ON public.fleet_service_transactions(batch_id);
CREATE TRIGGER fleet_service_transactions_updated BEFORE UPDATE ON public.fleet_service_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.maintenance_records
  ADD COLUMN mileage_in integer, ADD COLUMN mileage_out integer,
  ADD COLUMN transaction_id uuid REFERENCES public.fleet_service_transactions(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX maintenance_records_transaction_uidx ON public.maintenance_records(transaction_id) WHERE transaction_id IS NOT NULL;

ALTER TABLE public.maintenance_record_items
  ADD COLUMN original_heading text, ADD COLUMN customer_request text, ADD COLUMN work_performed text,
  ADD COLUMN technician_notes text, ADD COLUMN charge_type text, ADD COLUMN parts_amount numeric,
  ADD COLUMN labor_amount numeric, ADD COLUMN details jsonb;

ALTER TABLE public.fleet_import_proposals DROP CONSTRAINT IF EXISTS fleet_import_proposals_status_check;
ALTER TABLE public.fleet_import_proposals ADD CONSTRAINT fleet_import_proposals_status_check
  CHECK (status IN ('pending','applying','applied','ignored','failed','superseded'));

ALTER TABLE public.documents ADD COLUMN evidence_class text NOT NULL DEFAULT 'operational'
  CHECK (evidence_class IN ('operational','financial','mixed'));
UPDATE public.documents SET evidence_class = 'mixed'
  WHERE driver_id IS NULL AND kind IN ('service_receipt','repair_invoice','oil_service','tires','brakes','parts_receipt','tow_receipt');
UPDATE public.documents SET evidence_class = 'financial'
  WHERE driver_id IS NULL AND kind IN ('purchase_document','loan_document','payoff_statement','lender_statement','purchase_agreement','bill_of_sale','purchase','lien_release');

CREATE OR REPLACE FUNCTION private.vehicle_doc_object_restricted(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.documents d WHERE d.storage_bucket = 'vehicle-docs'
    AND d.storage_path = _path AND d.evidence_class IN ('financial','mixed'))
$$;
REVOKE ALL ON FUNCTION private.vehicle_doc_object_restricted(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.vehicle_doc_object_restricted(text) TO authenticated;

DROP POLICY IF EXISTS "Staff manage vehicle doc objects" ON storage.objects;
CREATE POLICY "Managers manage vehicle doc objects" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'vehicle-docs' AND private.is_manager())
  WITH CHECK (bucket_id = 'vehicle-docs' AND private.is_manager());
CREATE POLICY "Staff manage operational vehicle doc objects" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'vehicle-docs' AND private.is_staff() AND NOT private.vehicle_doc_object_restricted(name))
  WITH CHECK (bucket_id = 'vehicle-docs' AND private.is_staff());