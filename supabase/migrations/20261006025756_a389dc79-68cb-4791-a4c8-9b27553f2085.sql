-- Phase 1: Fleet Inbox foundation. Extends documents (the one vault) and vehicles.

-- 1. Content identity on the existing vault, for duplicate detection.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS source text;  -- 'fleet_inbox' | 'manual' | null (legacy)
CREATE UNIQUE INDEX IF NOT EXISTS documents_fleet_sha_unique
  ON public.documents (content_sha256)
  WHERE content_sha256 IS NOT NULL AND driver_id IS NULL;

-- 2. One document -> many vehicles (page-level provenance).
CREATE TABLE public.document_vehicle_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  page integer,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, vehicle_id)
);
CREATE INDEX document_vehicle_links_vehicle_idx ON public.document_vehicle_links (vehicle_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_vehicle_links TO authenticated;
GRANT ALL ON public.document_vehicle_links TO service_role;
ALTER TABLE public.document_vehicle_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage document vehicle links" ON public.document_vehicle_links
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());

-- Bridge existing single-vehicle documents.
INSERT INTO public.document_vehicle_links (document_id, vehicle_id)
SELECT id, vehicle_id FROM public.documents WHERE vehicle_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3. Batches.
CREATE TABLE public.fleet_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  status text NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading','processing','ready','needs_attention','applied','partially_applied','failed')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_import_batches TO authenticated;
GRANT ALL ON public.fleet_import_batches TO service_role;
ALTER TABLE public.fleet_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read fleet import batches" ON public.fleet_import_batches
  FOR SELECT TO authenticated USING (private.is_staff());
CREATE TRIGGER fleet_import_batches_updated BEFORE UPDATE ON public.fleet_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Items: one per uploaded file. Extraction excludes restricted finance facts.
CREATE TABLE public.fleet_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.fleet_import_batches(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  duplicate_of_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  content_sha256 text,
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded','analyzing','matching','ready','needs_attention','failed','duplicate','applied')),
  doc_class text,
  class_confidence text,
  classified_manually boolean NOT NULL DEFAULT false,
  extraction jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fleet_import_items_batch_idx ON public.fleet_import_items (batch_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_import_items TO authenticated;
GRANT ALL ON public.fleet_import_items TO service_role;
ALTER TABLE public.fleet_import_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read fleet import items" ON public.fleet_import_items
  FOR SELECT TO authenticated USING (private.is_staff());
CREATE TRIGGER fleet_import_items_updated BEFORE UPDATE ON public.fleet_import_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Proposals: one per detected vehicle entry.
CREATE TABLE public.fleet_import_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.fleet_import_batches(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.fleet_import_items(id) ON DELETE CASCADE,
  entry_index integer NOT NULL,
  page integer,
  kind text NOT NULL CHECK (kind IN ('new','match','conflict','unidentified')),
  vin text,
  vin_raw text,
  vin_check jsonb,
  identity jsonb NOT NULL DEFAULT '{}'::jsonb,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  match_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  match_basis text,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','applying','applied','ignored','failed')),
  applied_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  applied_by uuid,
  applied_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, entry_index)
);
CREATE INDEX fleet_import_proposals_batch_idx ON public.fleet_import_proposals (batch_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_import_proposals TO authenticated;
GRANT ALL ON public.fleet_import_proposals TO service_role;
ALTER TABLE public.fleet_import_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read fleet import proposals" ON public.fleet_import_proposals
  FOR SELECT TO authenticated USING (private.is_staff());
CREATE TRIGGER fleet_import_proposals_updated BEFORE UPDATE ON public.fleet_import_proposals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. Restricted finance facts extracted by the inbox: manager-only, like vehicle_finance.
CREATE TABLE public.fleet_import_finance_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.fleet_import_items(id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES public.fleet_import_proposals(id) ON DELETE CASCADE,
  field text NOT NULL,
  value text NOT NULL,
  confidence text,
  page integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_import_finance_facts TO authenticated;
GRANT ALL ON public.fleet_import_finance_facts TO service_role;
ALTER TABLE public.fleet_import_finance_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read fleet finance facts" ON public.fleet_import_finance_facts
  FOR SELECT TO authenticated USING (private.is_manager());

-- 7. Provenance of accepted facts on the canonical vehicle record.
CREATE TABLE public.vehicle_field_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  field text NOT NULL,
  value text,
  raw_value text,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  doc_class text,
  authority integer NOT NULL DEFAULT 0,
  page integer,
  method text NOT NULL DEFAULT 'ai_extraction',
  confidence text,
  extracted_at timestamptz,
  confirmed_by uuid,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  proposal_id uuid REFERENCES public.fleet_import_proposals(id) ON DELETE SET NULL,
  UNIQUE (proposal_id, field)
);
CREATE INDEX vehicle_field_provenance_vehicle_idx ON public.vehicle_field_provenance (vehicle_id, field, confirmed_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_field_provenance TO authenticated;
GRANT ALL ON public.vehicle_field_provenance TO service_role;
ALTER TABLE public.vehicle_field_provenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read vehicle provenance" ON public.vehicle_field_provenance
  FOR SELECT TO authenticated
  USING (private.is_staff() AND (field NOT IN ('legal_owner','lienholder','purchase_price','purchase_date','payoff_amount','loan_reference','monthly_payment') OR private.is_manager()));