-- LOCAL PROPOSAL ONLY. Not a migration. Do not apply. Do not run this file.
-- The CREATE OR REPLACE below is not approved. The read-only query is in
-- comments so this file cannot change vehicle_pl if it is executed by mistake.
-- Copy that query out and run it alone if the owner wants the impact.
--
-- company_share is the company's portion of a service. partner_share is the
-- JV partner's portion. vehicle_pl's comment excludes partner-funded
-- maintenance from cost. Neither share is written today, and company_share
-- is numeric NOT NULL DEFAULT 0, so COALESCE(company_share, total_cost, 0)
-- adds $0 for every stored row.
--
-- Proposed maintenance amount, per row, inside the existing inclusive window:
--   * 0 when a vehicle_expenses row names the service (the expense is the
--     one count; this repeats the separately approved double-count guard so
--     this proposal is safe on its own and does not change the expense sum);
--   * company_share when that share is greater than 0;
--   * company_share (0) when partner_share is greater than 0;
--   * net service cost when company_share and partner_share are both 0 and
--     total_cost is greater than 0: total_cost minus warranty_covered minus
--     vendor_credit, not below 0.
-- That last branch is the owner decision. It is not applied.
-- Date bounds stay inclusive BETWEEN. Grants stay as they are.

-- READ ONLY. Not executed by this file. The owner can copy this query.
-- It does not update, insert, or replace anything.
-- Dollars are the population of unlinked services whose company_share and
-- partner_share are both still 0 and whose total_cost is greater than 0.
-- total_cost_omitted is the gross amount today's maintenance sum drops.
-- net_omitted is the amount the proposal would add. No date window: vehicle_pl
-- still restricts rows with its own inclusive bounds.
--
-- SELECT
--   count(*) FILTER (WHERE m.partner_share = 0) AS unlinked_zero_share_rows,
--   COALESCE(sum(m.total_cost) FILTER (WHERE m.partner_share = 0), 0) AS total_cost_omitted,
--   COALESCE(sum(GREATEST(m.total_cost - COALESCE(m.warranty_covered, 0) - COALESCE(m.vendor_credit, 0), 0))
--     FILTER (WHERE m.partner_share = 0), 0) AS net_omitted,
--   count(*) FILTER (WHERE m.partner_share > 0) AS left_out_because_partner_share
-- FROM public.maintenance_records m
-- WHERE m.company_share = 0
--   AND m.total_cost > 0
--   AND NOT EXISTS (
--     SELECT 1 FROM public.vehicle_expenses e WHERE e.maintenance_record_id = m.id
--   );
--
-- SELECT COALESCE(m.source, '(none)') AS source, m.status, count(*) AS rows,
--   COALESCE(sum(m.total_cost), 0) AS total_cost,
--   COALESCE(sum(GREATEST(m.total_cost - COALESCE(m.warranty_covered, 0) - COALESCE(m.vendor_credit, 0), 0)), 0) AS net_cost
-- FROM public.maintenance_records m
-- WHERE m.company_share = 0 AND m.partner_share = 0 AND m.total_cost > 0
--   AND NOT EXISTS (
--     SELECT 1 FROM public.vehicle_expenses e WHERE e.maintenance_record_id = m.id
--   )
-- GROUP BY 1, 2
-- ORDER BY 1, 2;

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
  maint AS (
    SELECT m.vehicle_id, COALESCE(sum(
      CASE
        WHEN EXISTS (SELECT 1 FROM public.vehicle_expenses e WHERE e.maintenance_record_id = m.id) THEN 0
        WHEN m.company_share > 0 THEN m.company_share
        WHEN m.partner_share > 0 THEN m.company_share
        WHEN m.company_share = 0 AND m.partner_share = 0 AND m.total_cost > 0 THEN
          GREATEST(m.total_cost - COALESCE(m.warranty_covered, 0) - COALESCE(m.vendor_credit, 0), 0)
        ELSE m.company_share
      END
    ), 0) AS amt
    FROM public.maintenance_records m, bounds b
    WHERE m.vehicle_id IS NOT NULL
      AND COALESCE(m.performed_on, m.completed_at::date, m.created_at::date) BETWEEN b.lo AND b.hi
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
