-- PROPOSED — NOT APPLIED. eSign Phase A: version-controlled agreement templates.
-- Apply only after Codex's Application Resume migration 0022 is approved and the
-- journal is coordinated; take the next free number then (do not create a
-- conflicting 0022). Additive only: no drops, renames or type changes.

-- 1. Template version metadata ------------------------------------------------
ALTER TABLE public.agreement_templates
  ADD COLUMN IF NOT EXISTS effective_date date,
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

ALTER TABLE public.agreement_templates
  ADD CONSTRAINT agreement_templates_status_chk
    CHECK (approval_status IN ('draft','approved','retired')),
  ADD CONSTRAINT agreement_templates_approval_chk
    CHECK (approval_status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND effective_date IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS agreement_templates_name_version_uq
  ON public.agreement_templates (name, version);

-- 2. Immutable content snapshot ----------------------------------------------
-- body/name/version/content_sha256 never change after insert; edits create a
-- new version row. Only status may move draft->approved->retired (or draft->retired).
CREATE OR REPLACE FUNCTION public.agreement_template_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Agreement template versions cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.content_sha256 := encode(extensions.digest(NEW.body, 'sha256'), 'hex');
    IF NEW.approval_status <> 'draft' THEN
      RAISE EXCEPTION 'New template versions start as draft';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 THEN
    RAISE EXCEPTION 'Template wording is immutable; save a new version instead';
  END IF;
  IF OLD.approval_status = 'retired' AND NEW.approval_status <> 'retired' THEN
    RAISE EXCEPTION 'A retired template cannot be reactivated';
  END IF;
  IF OLD.approval_status = 'approved' AND NEW.approval_status = 'draft' THEN
    RAISE EXCEPTION 'An approved template cannot return to draft';
  END IF;
  IF OLD.approval_status = 'approved' AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
    RAISE EXCEPTION 'Approval record is immutable';
  END IF;
  RETURN NEW;
END $$;

-- Backfill hashes for any existing rows before the guard runs.
UPDATE public.agreement_templates
   SET content_sha256 = encode(extensions.digest(body, 'sha256'), 'hex')
 WHERE content_sha256 IS NULL;

DROP TRIGGER IF EXISTS agreement_template_guard ON public.agreement_templates;
CREATE TRIGGER agreement_template_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.agreement_templates
  FOR EACH ROW EXECUTE FUNCTION public.agreement_template_guard();

-- Only Owner may write templates (server functions use requireOwner; this is
-- the database boundary for any authenticated client path).
REVOKE INSERT, UPDATE, DELETE ON public.agreement_templates FROM authenticated, anon;

-- 3. Template reference frozen on every agreement ---------------------------
ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS template_version integer,
  ADD COLUMN IF NOT EXISTS template_sha256 text,
  ADD COLUMN IF NOT EXISTS template_status_at_send text,
  ADD COLUMN IF NOT EXISTS preview_fingerprint text;

COMMENT ON COLUMN public.agreements.template_version IS
  'Template version frozen at send. NULL for agreements sent before versioning (in-code Draft v1 wording).';

-- Sent/signed agreements keep their content permanently: body and merge_data
-- may not change once an agreement has left draft.
CREATE OR REPLACE FUNCTION public.agreement_content_freeze()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.body IS DISTINCT FROM OLD.body OR NEW.merge_data IS DISTINCT FROM OLD.merge_data
    OR NEW.template_id IS DISTINCT FROM OLD.template_id OR NEW.template_version IS DISTINCT FROM OLD.template_version
    OR NEW.template_sha256 IS DISTINCT FROM OLD.template_sha256) THEN
    RAISE EXCEPTION 'A sent or signed agreement''s content cannot be changed';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS agreement_content_freeze ON public.agreements;
CREATE TRIGGER agreement_content_freeze
  BEFORE UPDATE ON public.agreements
  FOR EACH ROW EXECUTE FUNCTION public.agreement_content_freeze();

-- 4. Draft v1 baseline -------------------------------------------------------
-- Inserted by a separate, approved data step (not in this migration) using the
-- exact DEFAULT_AGREEMENT_BODY text from src/lib/agreement-merge.ts:
--   name 'Rental Agreement', version 1, approval_status 'draft',
--   effective_date NULL. It is NOT approved automatically.
-- Once this migration is live, the app refuses to send until the Owner approves
-- a version (activation of the approval policy).

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
  USING (private.is_manager())
  WITH CHECK (private.is_manager());
-- Uploading proof never sets status: a trigger should require verified_by and
-- verified_at whenever status = 'verified'.

-- Packaging completion: verified insurance requires attributed evidence.
CREATE FUNCTION public.guard_insurance_verification() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF NEW.status='verified' AND (NEW.verified_by IS NULL OR NEW.verified_at IS NULL OR nullif(btrim(NEW.method),'') IS NULL) THEN
  RAISE EXCEPTION 'Verified insurance requires actor, timestamp and method';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_insurance_verification BEFORE INSERT OR UPDATE
ON public.rental_insurance_verifications FOR EACH ROW EXECUTE FUNCTION public.guard_insurance_verification();
-- If 0030 preceded agreements, establish its boundary before any staff access.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.agreements'::regclass AND polname='identity_agreement_boundary') THEN
  CREATE POLICY identity_agreement_boundary ON public.agreements AS RESTRICTIVE
   FOR SELECT TO authenticated USING (NOT private.is_staff() OR private.is_manager());
 END IF;
END $$;

-- Freeze new library fields together with the already protected signed body.
CREATE OR REPLACE FUNCTION public.agreement_content_freeze()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF OLD.status <> 'draft' AND (
  NEW.body IS DISTINCT FROM OLD.body OR NEW.merge_data IS DISTINCT FROM OLD.merge_data
  OR NEW.template_id IS DISTINCT FROM OLD.template_id OR NEW.template_version IS DISTINCT FROM OLD.template_version
  OR NEW.template_sha256 IS DISTINCT FROM OLD.template_sha256 OR NEW.template_key IS DISTINCT FROM OLD.template_key
  OR NEW.insurance_snapshot IS DISTINCT FROM OLD.insurance_snapshot OR NEW.preview_fingerprint IS DISTINCT FROM OLD.preview_fingerprint
  OR NEW.template_status_at_send IS DISTINCT FROM OLD.template_status_at_send
 ) THEN RAISE EXCEPTION 'A sent or signed agreement content snapshot cannot be changed'; END IF;
 RETURN NEW;
END $$;
