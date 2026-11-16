-- PROPOSED, NOT APPLIED. Needs Dolmar's approval before it runs on production
-- (approved in principle: card t298s1611).
--
-- One car, one person for assignments (src/lib/fleet-assign.server.ts): at
-- most one Approved, not-deleted application may hold a given car. Reserve
-- already has rentals_one_reserved_per_vehicle for reservations; this covers
-- the step before it, so two FLEET calls (or FLEET and staff) at the same
-- moment cannot both assign the same car.
--
-- Preflight (must return 0 rows, checked Nov 15, 2026: 0):
--   SELECT vehicle_id, count(*) FROM public.applications
--   WHERE vehicle_id IS NOT NULL AND status = 'approved' AND deleted_at IS NULL
--   GROUP BY 1 HAVING count(*) > 1;
--
-- Additive. Without it FLEET's assign still re-checks after writing.
-- Effect on staff: saving the same car on a second Approved applicant is
-- refused until the first one's car is cleared.
CREATE UNIQUE INDEX IF NOT EXISTS applications_one_approved_per_vehicle
  ON public.applications (vehicle_id)
  WHERE vehicle_id IS NOT NULL AND status = 'approved' AND deleted_at IS NULL;

-- Rollback:
-- DROP INDEX IF EXISTS public.applications_one_approved_per_vehicle;
