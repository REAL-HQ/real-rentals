-- PROPOSED — NOT APPLIED. Agreement Template Library (multi-template eSign).
-- Fold into the pending template-versioning migration (provisionally 0023,
-- after Codex's Application Resume 0022). Agreement numbering and Vehicle
-- Pricing follow it. Additive only: no drops, renames or type changes.

ALTER TABLE public.agreement_templates
  ADD COLUMN IF NOT EXISTS template_key text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS display_version text,
  ADD COLUMN IF NOT EXISTS insurance_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS retired_by uuid,
  ADD COLUMN IF NOT EXISTS source_document_path text,
  ADD COLUMN IF NOT EXISTS field_map jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Independent version history per family (replaces the name+version index
-- from the versioning proposal for keyed rows).
CREATE UNIQUE INDEX IF NOT EXISTS agreement_templates_key_version_uq
  ON public.agreement_templates (template_key, version);
-- At most one approved (sendable) version per family.
CREATE UNIQUE INDEX IF NOT EXISTS agreement_templates_one_approved_per_key
  ON public.agreement_templates (template_key) WHERE approval_status = 'approved';

ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS template_key text,
  ADD COLUMN IF NOT EXISTS insurance_snapshot jsonb;  -- frozen at send

CREATE TABLE public.rental_insurance_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id),
  carrier text NOT NULL,
  policy_number text NOT NULL,
  coverage_start date,
  coverage_end date,
  proof_document_id uuid REFERENCES public.documents(id),
  status text NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','verified','rejected','lapsed')),
  verified_by uuid,
  verified_at timestamptz,
  method text,          -- e.g. carrier phone call, agent email
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.rental_insurance_verifications TO authenticated;
GRANT ALL ON public.rental_insurance_verifications TO service_role;
ALTER TABLE public.rental_insurance_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage insurance verifications" ON public.rental_insurance_verifications
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
-- Uploading proof never sets status: a trigger should require verified_by and
-- verified_at whenever status = 'verified'.
