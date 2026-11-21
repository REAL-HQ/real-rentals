-- RentID screening reports on the driver profile (Dolmar, t582u, Nov 21 2026).
-- NOT APPLIED. Run only with Dolmar's approval. Applying it changes no
-- application, screening, document or setting; it only adds an empty table.
-- The FLEET path stays off until the Owner turns on "RentID Reports (FLEET)"
-- (app_settings automation_controls, key rentid_report_imports).
--
-- One row per driver per RentID order. A record, never a decision: nothing
-- reads this table to approve, verify or decline anyone, and no trigger
-- touches applications.background_check_status / mvr_status.
--
-- Writers: the service role only (server functions check Manager+, the FLEET
-- endpoint checks FLEET_API_KEY + the switch). Staff read through RLS
-- (private.is_manager(), the tier that can read driver documents).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.rentid_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  -- As shown by RentID: INV-XXXXXXXX on the receipt, or the bare portal order.
  order_id text NOT NULL CHECK (order_id ~ '^(INV-)?[A-Z0-9]{6,16}$'),
  -- order_id without INV-, so the receipt and the portal order are one row.
  order_key text NOT NULL CHECK (order_key ~ '^[A-Z0-9]{6,16}$'),
  -- The portal report page (rent-id.io/rentid/<report_ref>), e.g. req_1793719376790_jn4khlc48.
  report_ref text CHECK (report_ref IS NULL OR report_ref ~ '^req_[0-9]{6,20}_j[a-z0-9]{6,16}$'),
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'reported')),
  renter_name text CHECK (renter_name IS NULL OR length(renter_name) <= 120),
  products text[] NOT NULL DEFAULT '{}',
  ordered_at timestamptz,
  checked_at timestamptz,
  license_status text CHECK (license_status IS NULL OR license_status IN
    ('active','suspended','revoked','expired','inactive','invalid','provisional','restricted','unavailable')),
  license_state text CHECK (license_state IS NULL OR license_state ~ '^[A-Z]{2}$'),
  criminal_record text CHECK (criminal_record IS NULL OR criminal_record IN ('not_detected','detected','unavailable')),
  criminal_case_count integer CHECK (criminal_case_count IS NULL OR criminal_case_count BETWEEN 0 AND 999),
  -- [{case_number,alt_case_numbers,internal_id,date(offense),file_date,offense(charges),
  --   level(degree),disposition,jurisdiction(court/county)}], at most 200, one per case:
  -- the same case from two sources (AOC 10004830MMMO / Clerk 032010MM004830XXOXMX)
  -- is merged in the app before it is stored. No name or DOB is stored per case.
  criminal_cases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(criminal_cases) = 'array' AND jsonb_array_length(criminal_cases) <= 200),
  identity_result text CHECK (identity_result IS NULL OR identity_result IN ('approved','failed','pending','unavailable')),
  -- The screenshot / PDF of the RentID result, filed under Screening (team only).
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('staff','fleet')),
  recorded_by uuid,
  recorded_by_label text CHECK (recorded_by_label IS NULL OR length(recorded_by_label) <= 120),
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rentid_reports_ref_matches_order CHECK (report_ref IS NULL OR upper(substring(report_ref from '_j([a-z0-9]+)$')) = order_key),
  CONSTRAINT rentid_reports_order_matches_key CHECK (regexp_replace(order_id, '^INV-', '') = order_key),
  CONSTRAINT rentid_reports_not_detected_has_no_cases CHECK (
    criminal_record IS DISTINCT FROM 'not_detected'
    OR (coalesce(criminal_case_count, 0) = 0 AND jsonb_array_length(criminal_cases) = 0)
  )
);

-- One RentID order belongs to one driver.
CREATE UNIQUE INDEX IF NOT EXISTS rentid_reports_order_key_uq ON public.rentid_reports (order_key);
CREATE INDEX IF NOT EXISTS rentid_reports_application_idx ON public.rentid_reports (application_id, created_at DESC);

ALTER TABLE public.rentid_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Managers read RentID reports" ON public.rentid_reports;
CREATE POLICY "Managers read RentID reports" ON public.rentid_reports
  FOR SELECT TO authenticated USING (private.is_manager());

REVOKE ALL ON public.rentid_reports FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rentid_reports FROM authenticated;
GRANT ALL ON public.rentid_reports TO service_role;

COMMIT;

-- Rollback (drops the reports; the report files stay under Documents → Screening):
-- DROP TABLE IF EXISTS public.rentid_reports;
