-- Proposed. Not a migration. Do not run this against a hosted database.
-- NOT EXECUTED. Do not copy this file into the migrations directory.
--
-- The incidents log already reads public.incidents and does not recreate it:
--   rental_id, vehicle_id, application_id, occurred_at, incident_type,
--   description, estimated_cost, actual_cost, claim_number, status.
--
-- Photo links and the recovered amount have no table. Until these exist the
-- log leaves both unknown and still shows the incident row.
-- amount_recovered is a recorded number. This file does not insert a
-- payment, a charge, or a deposit_deductions row, and it does not grant
-- INSERT, UPDATE, or DELETE.
--
-- A link names one existing documents row or one existing inspections row.
-- SELECT only. Owner and Manager (private.is_manager()). Coordinators,
-- drivers, anon, and public have no policy.

CREATE TABLE public.incidents_log_v1 (
  incident_id uuid PRIMARY KEY REFERENCES public.incidents(id) ON DELETE CASCADE,
  amount_recovered numeric,
  CONSTRAINT incidents_log_v1_amount_nonneg CHECK (amount_recovered IS NULL OR amount_recovered >= 0)
);

CREATE TABLE public.incidents_log_v1_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  inspection_id uuid REFERENCES public.inspections(id) ON DELETE CASCADE,
  CONSTRAINT incidents_log_v1_links_one_target CHECK (
    (document_id IS NOT NULL AND inspection_id IS NULL)
    OR (document_id IS NULL AND inspection_id IS NOT NULL)
  )
);

ALTER TABLE public.incidents_log_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents_log_v1_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.incidents_log_v1 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.incidents_log_v1_links FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.incidents_log_v1 TO service_role;
GRANT SELECT ON TABLE public.incidents_log_v1 TO authenticated;
GRANT SELECT ON TABLE public.incidents_log_v1_links TO service_role;
GRANT SELECT ON TABLE public.incidents_log_v1_links TO authenticated;

CREATE POLICY "Admins read incidents log"
  ON public.incidents_log_v1
  FOR SELECT
  TO authenticated
  USING (private.is_manager());

CREATE POLICY "Admins read incidents log links"
  ON public.incidents_log_v1_links
  FOR SELECT
  TO authenticated
  USING (private.is_manager());
