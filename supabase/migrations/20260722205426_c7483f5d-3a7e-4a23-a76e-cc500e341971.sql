
-- 1) Safety: ensure sms_consent exists on the leads table
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS sms_consent boolean DEFAULT false;

-- 2) driver_screenings (one-to-one with applications)
CREATE TABLE IF NOT EXISTS public.driver_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES public.applications(id) ON DELETE CASCADE,
  interview_completed_at timestamptz,
  interviewed_by text,
  gig_apps text[],
  gig_account_status text CHECK (gig_account_status IS NULL OR gig_account_status IN ('active','pending','deactivated')),
  months_on_platform int,
  trip_count int,
  driver_rating numeric(3,2),
  drive_type text CHECK (drive_type IS NULL OR drive_type IN ('full_time','part_time')),
  has_current_vehicle boolean,
  needed_by_date date,
  rate_confirmed boolean,
  card_in_own_name boolean,
  license_state text,
  license_active boolean,
  license_years int,
  driver_age int,
  has_personal_insurance boolean,
  insurance_carrier text,
  insurance_policy_number text,
  insurance_carrier_phone text,
  policy_active boolean,
  rideshare_endorsement boolean,
  insurance_name_matches_license boolean,
  accidents_last_3yr int,
  has_dui boolean,
  major_violations boolean,
  license_points int,
  mvr_authorized boolean,
  interview_notes text,
  qualification_score int,
  disqualified boolean NOT NULL DEFAULT false,
  disqualification_reason text,
  insurance_verified boolean NOT NULL DEFAULT false,
  insurance_verified_by text,
  insurance_verified_at timestamptz,
  verification_recording_url text,
  status text NOT NULL DEFAULT 'new_lead' CHECK (status IN (
    'new_lead','contacted','interview_complete','docs_pending',
    'insurance_verified','approved','pickup_scheduled','active_renter','disqualified'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_screenings TO authenticated;
GRANT ALL ON public.driver_screenings TO service_role;
ALTER TABLE public.driver_screenings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage screenings" ON public.driver_screenings;
CREATE POLICY "Admins manage screenings" ON public.driver_screenings
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(),'admin'))
  WITH CHECK (private.has_role(auth.uid(),'admin'));
DROP TRIGGER IF EXISTS driver_screenings_set_updated_at ON public.driver_screenings;
CREATE TRIGGER driver_screenings_set_updated_at
  BEFORE UPDATE ON public.driver_screenings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) lead_documents
CREATE TABLE IF NOT EXISTS public.lead_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN (
    'license_front','license_back','insurance_card','driver_profile_screenshot','verification_recording'
  )),
  file_url text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_documents_lead ON public.lead_documents(lead_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_documents TO authenticated;
GRANT ALL ON public.lead_documents TO service_role;
ALTER TABLE public.lead_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage lead_documents" ON public.lead_documents;
CREATE POLICY "Admins manage lead_documents" ON public.lead_documents
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(),'admin'))
  WITH CHECK (private.has_role(auth.uid(),'admin'));

-- 4) Pipeline gating trigger
CREATE OR REPLACE FUNCTION public.enforce_screening_pipeline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  doc_count int;
  rec_count int;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('docs_pending','insurance_verified','approved','pickup_scheduled','active_renter') THEN
    IF NEW.interview_completed_at IS NULL THEN
      RAISE EXCEPTION 'Cannot advance to %: interview must be completed first', NEW.status;
    END IF;
    IF NEW.disqualified THEN
      RAISE EXCEPTION 'Cannot advance to %: driver is disqualified', NEW.status;
    END IF;
  END IF;
  IF NEW.status IN ('insurance_verified','approved','pickup_scheduled','active_renter') THEN
    SELECT count(DISTINCT doc_type) INTO doc_count
      FROM public.lead_documents
      WHERE lead_id = NEW.lead_id
        AND doc_type IN ('license_front','license_back','insurance_card','driver_profile_screenshot');
    IF doc_count < 4 THEN
      RAISE EXCEPTION 'Cannot advance to %: all four driver documents required (have %)', NEW.status, doc_count;
    END IF;
    IF NEW.insurance_verified IS NOT TRUE THEN
      RAISE EXCEPTION 'Cannot advance to %: insurance not yet verified', NEW.status;
    END IF;
    SELECT count(*) INTO rec_count
      FROM public.lead_documents
      WHERE lead_id = NEW.lead_id AND doc_type = 'verification_recording';
    IF rec_count < 1 THEN
      RAISE EXCEPTION 'Cannot advance to %: verification call recording required', NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS driver_screenings_pipeline ON public.driver_screenings;
CREATE TRIGGER driver_screenings_pipeline
  BEFORE UPDATE OF status ON public.driver_screenings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_screening_pipeline();

-- 5) Storage RLS for driver-docs (admins only)
DROP POLICY IF EXISTS "driver-docs admin read" ON storage.objects;
DROP POLICY IF EXISTS "driver-docs admin insert" ON storage.objects;
DROP POLICY IF EXISTS "driver-docs admin update" ON storage.objects;
DROP POLICY IF EXISTS "driver-docs admin delete" ON storage.objects;
CREATE POLICY "driver-docs admin read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'driver-docs' AND private.has_role(auth.uid(),'admin'));
CREATE POLICY "driver-docs admin insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'driver-docs' AND private.has_role(auth.uid(),'admin'));
CREATE POLICY "driver-docs admin update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'driver-docs' AND private.has_role(auth.uid(),'admin'));
CREATE POLICY "driver-docs admin delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'driver-docs' AND private.has_role(auth.uid(),'admin'));
