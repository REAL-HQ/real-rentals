-- LOCAL PROPOSAL. Not a migration. Do not run against a hosted database.
-- NOT EXECUTED.
--
-- Maintenance Due already reads these existing columns and does not recreate them:
--   vehicles.registration_expires_on
--   vehicles.insurance_expires_on
--   vehicles.current_odometer
--   vehicle_expenses.category + vehicle_expenses.incurred_on
--     for tires, registration, and insurance only
--
-- These facts have no column, so the view shows Unknown until this table exists:
--   oil change (expenses have a shared "maintenance" category, not oil)
--   tire due date, tire due mileage, and tire mileage at service
--   inspection expiry (registration expiry is already on the vehicle;
--   inspections are pickup and return checklists, not a state-inspection date)
--
-- The app only SELECTs this table. A missing relation is treated as no rows.
-- There is no insert, update, or delete grant for the application roles.

CREATE TABLE public.maintenance_due_v1 (
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id) ON DELETE CASCADE,
  oil_last_on date,
  oil_last_miles integer,
  oil_due_on date,
  oil_due_miles integer,
  tires_last_miles integer,
  tires_due_on date,
  tires_due_miles integer,
  inspection_due_on date,
  CONSTRAINT maintenance_due_v1_oil_last_miles_nonneg CHECK (oil_last_miles IS NULL OR oil_last_miles >= 0),
  CONSTRAINT maintenance_due_v1_oil_due_miles_nonneg CHECK (oil_due_miles IS NULL OR oil_due_miles >= 0),
  CONSTRAINT maintenance_due_v1_tires_last_miles_nonneg CHECK (tires_last_miles IS NULL OR tires_last_miles >= 0),
  CONSTRAINT maintenance_due_v1_tires_due_miles_nonneg CHECK (tires_due_miles IS NULL OR tires_due_miles >= 0)
);

ALTER TABLE public.maintenance_due_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.maintenance_due_v1 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.maintenance_due_v1 TO service_role;
