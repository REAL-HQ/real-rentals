-- Restores public.vehicle_pl from
-- supabase/migrations/20261006020456_cf3a2cce-fa6e-4f72-85b9-c95c5d634bb4.sql.
-- The function only. That migration also drops a storage policy. This file does not.
-- Leave that migration unchanged. This is not an install step.
-- Do not run it against a hosted database until the owner approves the undo.

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
    WHERE m.vehicle_id IS NOT NULL AND COALESCE(m.performed_on, m.completed_at::date, m.created_at::date) BETWEEN b.lo AND b.hi GROUP BY m.vehicle_id),
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
