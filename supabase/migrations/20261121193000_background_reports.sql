-- Background reports on the driver profile (Dolmar, t582u, Nov 21 2026:
-- "call it 'Background' ... we should also upload the DMV reports here too.
-- should be able to upload multiple files").
-- NOT APPLIED. Run only with Dolmar's approval. Applying it changes no
-- application, screening, document or setting; it only adds two empty tables.
-- The FLEET path stays off until the Owner turns on "Background Reports (FLEET)"
-- (app_settings automation_controls, key background_report_imports).
--
-- One row per background check entry (RentID order, FL DMV / FLHSMV license
-- check, or other provider), with any number of files (documents, category
-- screening, team only) through background_report_documents.
--
-- A record, never a decision: nothing reads these tables to approve, verify or
-- decline anyone, and no trigger touches applications.background_check_status,
-- mvr_status, license or insurance verification.
--
-- Writers: the service role only (server functions check Manager+, the FLEET
-- endpoint checks FLEET_API_KEY + the switch). Staff read through RLS
-- (private.is_manager(), the tier that can read driver documents).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.background_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('rentid', 'fl_dmv', 'other')),
  provider_name text CHECK (provider_name IS NULL OR length(btrim(provider_name)) BETWEEN 1 AND 80),
  report_type text NOT NULL CHECK (report_type IN ('background_screening', 'dmv_license_check', 'other')),
  -- Order / reference number. RentID: INV-XXXXXXXX (receipt) or the bare portal order.
  reference text CHECK (reference IS NULL OR length(reference) BETWEEN 1 AND 60),
  -- RentID only: reference without INV-, so the receipt and the portal order are one entry.
  order_key text CHECK (order_key IS NULL OR order_key ~ '^[A-Z0-9]{6,16}$'),
  -- RentID only: the portal report page id (rent-id.io/rentid/<report_ref>).
  report_ref text CHECK (report_ref IS NULL OR report_ref ~ '^req_[0-9]{6,20}_j[a-z0-9]{6,16}$'),
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'reported')),
  renter_name text CHECK (renter_name IS NULL OR length(renter_name) <= 120),
  products text[] NOT NULL DEFAULT '{}',
  ordered_at timestamptz,
  checked_at timestamptz,
  -- As the provider reported it. Display only: never copied to mvr_status or any license-verified field.
  license_status text CHECK (license_status IS NULL OR license_status IN
    ('active','suspended','revoked','expired','inactive','invalid','provisional','restricted','unavailable')),
  license_state text CHECK (license_state IS NULL OR license_state ~ '^[A-Z]{2}$'),
  criminal_record text CHECK (criminal_record IS NULL OR criminal_record IN ('not_detected','detected','unavailable')),
  -- The provider's own count (RentID lists many cases twice).
  criminal_case_count integer CHECK (criminal_case_count IS NULL OR criminal_case_count BETWEEN 0 AND 999),
  -- Distinct cases: [{case_number,alt_case_numbers,internal_id,date(offense),file_date,
  --   offense(charges),level(degree),disposition,jurisdiction(court/county)}], at most 200.
  -- The same case from two sources (AOC 10004830MMMO / Clerk 032010MM004830XXOXMX)
  -- is merged in the app before it is stored. No name or DOB is stored per case.
  criminal_cases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(criminal_cases) = 'array' AND jsonb_array_length(criminal_cases) <= 200),
  identity_result text CHECK (identity_result IS NULL OR identity_result IN ('approved','failed','pending','unavailable')),
  source text NOT NULL CHECK (source IN ('staff','fleet')),
  idempotency_key text UNIQUE CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 120),
  recorded_by uuid,
  recorded_by_label text CHECK (recorded_by_label IS NULL OR length(recorded_by_label) <= 120),
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT background_reports_rentid_fields CHECK (
    provider = 'rentid'
    OR (order_key IS NULL AND report_ref IS NULL)
  ),
  CONSTRAINT background_reports_rentid_reference CHECK (
    provider <> 'rentid' OR reference IS NULL
    OR (reference ~ '^(INV-)?[A-Z0-9]{6,16}$' AND regexp_replace(reference, '^INV-', '') = order_key)
  ),
  CONSTRAINT background_reports_ref_matches_order CHECK (
    report_ref IS NULL OR upper(substring(report_ref from '_j([a-z0-9]+)$')) = order_key
  ),
  CONSTRAINT background_reports_other_named CHECK (provider <> 'other' OR provider_name IS NOT NULL),
  CONSTRAINT background_reports_not_detected_has_no_cases CHECK (
    criminal_record IS DISTINCT FROM 'not_detected'
    OR (coalesce(criminal_case_count, 0) = 0 AND jsonb_array_length(criminal_cases) = 0)
  )
);

-- One RentID order belongs to one driver.
CREATE UNIQUE INDEX IF NOT EXISTS background_reports_rentid_order_uq
  ON public.background_reports (order_key) WHERE provider = 'rentid' AND order_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS background_reports_application_idx
  ON public.background_reports (application_id, created_at DESC);

-- Files on an entry. The document row (category screening, visibility admin) is
-- the file; deleting the entry leaves the file under Documents.
CREATE TABLE IF NOT EXISTS public.background_report_documents (
  report_id uuid NOT NULL REFERENCES public.background_reports(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, document_id)
);
CREATE INDEX IF NOT EXISTS background_report_documents_document_idx
  ON public.background_report_documents (document_id);

ALTER TABLE public.background_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Managers read background reports" ON public.background_reports;
CREATE POLICY "Managers read background reports" ON public.background_reports
  FOR SELECT TO authenticated USING (private.is_manager());
REVOKE ALL ON public.background_reports FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.background_reports FROM authenticated;
GRANT ALL ON public.background_reports TO service_role;

ALTER TABLE public.background_report_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Managers read background report documents" ON public.background_report_documents;
CREATE POLICY "Managers read background report documents" ON public.background_report_documents
  FOR SELECT TO authenticated USING (private.is_manager());
REVOKE ALL ON public.background_report_documents FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.background_report_documents FROM authenticated;
GRANT ALL ON public.background_report_documents TO service_role;

COMMIT;

-- Rollback (drops the entries; their files stay under Documents → Screening):
-- DROP TABLE IF EXISTS public.background_report_documents;
-- DROP TABLE IF EXISTS public.background_reports;
