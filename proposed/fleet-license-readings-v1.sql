-- PROPOSED, NOT APPLIED. Needs Dolmar's approval before it runs on production
-- (approved in principle: card t298s1611).
--
-- FLEET license readings (src/lib/fleet-license.server.ts):
--   public.fleet_license_readings: every date of birth / license expiry FLEET
--   read off an applicant's license photo, labelled "Read by FLEET from license
--   photo". A reading is never a verification. Written only by the server
--   (service role). Staff can read.
--
-- Additive. Sends nothing. Before this runs, POST /api/public/fleet/license-facts
-- answers 503 and changes nothing. Rollback at the bottom.
BEGIN;
CREATE TABLE IF NOT EXISTS public.fleet_license_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  dob date,
  license_expiration date,
  applied_fields text[] NOT NULL DEFAULT '{}',
  conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  note text CHECK (note IS NULL OR length(note) <= 300),
  source_label text NOT NULL DEFAULT 'Read by FLEET from license photo',
  read_by text NOT NULL DEFAULT 'FLEET (automated)',
  idempotency_key text UNIQUE CHECK (idempotency_key IS NULL OR length(idempotency_key) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (dob IS NOT NULL OR license_expiration IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS fleet_license_readings_application_idx
  ON public.fleet_license_readings (application_id, created_at DESC);

ALTER TABLE public.fleet_license_readings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read fleet license readings" ON public.fleet_license_readings;
CREATE POLICY "Staff read fleet license readings" ON public.fleet_license_readings
  FOR SELECT TO authenticated USING (private.is_staff());
REVOKE ALL ON public.fleet_license_readings FROM anon;
COMMIT;

-- Rollback (the dates already copied onto applications stay; clear them with
-- the reading ids if needed):
-- DROP TABLE IF EXISTS public.fleet_license_readings;
