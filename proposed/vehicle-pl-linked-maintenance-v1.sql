-- LOCAL PROPOSAL ONLY. Not a migration. Do not apply. Do not run against a hosted database.
-- Owner approval is required before this replaces public.vehicle_pl.
--
-- Live reporting today double-counts a service that already has a
-- vehicle_expenses row. exp sums every vehicle_expenses.amount, including
-- rows whose maintenance_record_id is set. maint then adds
-- COALESCE(company_share, total_cost, 0) for every in-window service,
-- including those linked rows.
--
-- In principle, each linked service whose maintenance date falls inside the
-- inclusive window inflates maintenance and reduces net by:
--   * company_share, when that share is present (a share equal to the
--     expense still inflates by the whole share; $100 expense + $100 share
--     is $100 too much maintenance and $100 too little net);
--   * total_cost, when company_share is null;
--   * 0, when company_share is 0, because 0 is already the amount added.
-- The expense column is not inflated. company_share is numeric NOT NULL
-- DEFAULT 0, so a stored zero does not inflate and a blank share is not a
-- normal stored row. This file does not query a hosted database and does
-- not state a fleet total.
--
-- The predicate below skips company_share and total_cost when any
-- vehicle_expenses row names the service. The expense row remains in exp
-- even when its incurred_on is outside this window, matching the once-per-row
-- rule. A month where the expense date and the service date fall on
-- different sides of the window can then omit that cost from both columns.
-- Date bounds stay inclusive BETWEEN. Grants are unchanged: CREATE OR REPLACE
-- keeps the existing service_role execute grant.

CREATE OR REPLACE FUNCTION public.vehicle_pl(_from date DEFAULT NULL::date, _to date DEFAULT NULL::date)
 RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, license_plate text, status text, revenue numeric, expenses numeric, maintenance numeric, net numeric, days_on_rent bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH bounds AS (SELECT COALESCE(_from, '1900-01-01'::date) AS lo, COALESCE(_to, '2999-12-31'::date) AS hi),
  rev AS (
    SELECT p.vehicle_id, COALESCE(sum(p.net_collected), 0) AS amt
    FROM public.payments p, bounds b
    WHERE p.vehicle_id IS NOT NULL AND p.status IN ('paid','refunded')
      AND p.type IN ('rent', 'late_fee', 'other')
      AND COALESCE(p.paid_date, p.due_date) BETWEEN b.lo AND b.hi
    GROUP BY p.vehicle_id),
  exp AS (SELECT e.vehicle_id, COALESCE(sum(e.amount), 0) AS amt FROM public.vehicle_expenses e, bounds b WHERE e.incurred_on BETWEEN b.lo AND b.hi GROUP BY e.vehicle_id),
  maint AS (SELECT m.vehicle_id, COALESCE(sum(COALESCE(m.company_share, m.total_cost, 0)), 0) AS amt FROM public.maintenance_records m, bounds b
    WHERE m.vehicle_id IS NOT NULL
      AND COALESCE(m.performed_on, m.completed_at::date, m.created_at::date) BETWEEN b.lo AND b.hi
      AND NOT EXISTS (SELECT 1 FROM public.vehicle_expenses e WHERE e.maintenance_record_id = m.id)
    GROUP BY m.vehicle_id),
  onrent AS (SELECT r.vehicle_id, COALESCE(sum(GREATEST(0,(LEAST(COALESCE(r.end_date, b.hi), b.hi) - GREATEST(r.start_date, b.lo)) + 1)), 0)::bigint AS days
    FROM public.rentals r, bounds b WHERE r.vehicle_id IS NOT NULL AND r.start_date <= b.hi AND COALESCE(r.end_date, b.hi) >= b.lo GROUP BY r.vehicle_id)
  SELECT v.id, v.year, v.make, v.model, v.license_plate, v.status,
    COALESCE(rev.amt, 0), COALESCE(exp.amt, 0), COALESCE(maint.amt, 0),
    COALESCE(rev.amt, 0) - COALESCE(exp.amt, 0) - COALESCE(maint.amt, 0), COALESCE(onrent.days, 0)
  FROM public.vehicles v
  LEFT JOIN rev ON rev.vehicle_id = v.id LEFT JOIN exp ON exp.vehicle_id = v.id
  LEFT JOIN maint ON maint.vehicle_id = v.id LEFT JOIN onrent ON onrent.vehicle_id = v.id
  ORDER BY (COALESCE(rev.amt,0) - COALESCE(exp.amt,0) - COALESCE(maint.amt,0)) DESC
$function$;
