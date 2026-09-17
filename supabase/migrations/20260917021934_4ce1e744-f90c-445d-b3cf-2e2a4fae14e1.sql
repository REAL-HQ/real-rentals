
CREATE TABLE public.agreement_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  body text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreement_templates TO authenticated;
GRANT ALL ON public.agreement_templates TO service_role;
ALTER TABLE public.agreement_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage agreement templates" ON public.agreement_templates
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER agreement_templates_set_updated_at BEFORE UPDATE ON public.agreement_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.agreement_templates(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Vehicle Rental Agreement',
  body text NOT NULL,
  merge_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  token_hash text UNIQUE,
  token_expires_at timestamptz,
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  voided_at timestamptz,
  signer_name text,
  signer_email text,
  signer_ip text,
  signer_user_agent text,
  company_signer_name text NOT NULL DEFAULT 'REAL RENTALS',
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agreements_application_idx ON public.agreements(application_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreements TO authenticated;
GRANT ALL ON public.agreements TO service_role;
ALTER TABLE public.agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage agreements" ON public.agreements
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Drivers view their own agreements" ON public.agreements
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.id = agreements.application_id AND a.user_id = auth.uid()
  ));
CREATE TRIGGER agreements_set_updated_at BEFORE UPDATE ON public.agreements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS expires_at date,
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS uploaded_by uuid,
  ADD COLUMN IF NOT EXISTS uploaded_by_role text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS size_bytes bigint;
CREATE INDEX IF NOT EXISTS documents_driver_category_idx ON public.documents(driver_id, category);
