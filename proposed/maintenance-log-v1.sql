-- Proposed. Not a migration. Do not run this against a hosted database.
-- NOT EXECUTED. Do not copy this file into the migrations directory.
--
-- The maintenance log already reads these columns and does not recreate them:
--   vehicles.current_odometer
--   vehicles.last_oil_change_miles
--   vehicles.oil_interval_miles
--   vehicles.last_tire_date
--   vehicles.last_brake_inspection_date
--   vehicles.registration_expires_on
--   vehicles.insurance_expires_on
--   maintenance_records (oil, tires, brakes, inspection history)
--   inspections (checklist history, not an expiry)
--
-- Inspection expiry has no column. Until this table exists the log leaves
-- that fact unknown and still shows the checklist history.
--
-- SELECT only. Owner and Manager (private.is_manager(), the same bar as
-- "Admins manage maintenance": roles admin and team). Coordinators, drivers,
-- anon, and public have no policy and no write grant.

CREATE TABLE public.maintenance_log_v1 (
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id) ON DELETE CASCADE,
  inspection_due_on date
);

ALTER TABLE public.maintenance_log_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.maintenance_log_v1 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.maintenance_log_v1 TO service_role;
GRANT SELECT ON TABLE public.maintenance_log_v1 TO authenticated;

CREATE POLICY "Admins read maintenance log"
  ON public.maintenance_log_v1
  FOR SELECT
  TO authenticated
  USING (private.is_manager());
