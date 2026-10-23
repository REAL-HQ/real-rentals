-- Proposed only. This file is not a migration and the report does not read it.
--
-- Already stored, and used by the report when present:
--   vehicles.partner_id
--   partners.revenue_split_pct (not null, default 50) as the partner share of
--   attributed revenue
--
-- Not stored, which is why a vehicle with no partner shows
-- "Split not configured", and why maintenance is not split by a percent:
--   a vehicle-level percent that can differ from the partner default
--   the date range that percent is in force
--   the percent of maintenance or other expense categories the partner bears
--   which expense categories that percent applies to

create table public.jv_splits (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id),
  partner_id uuid not null references public.partners (id),
  revenue_split_pct numeric not null check (revenue_split_pct >= 0 and revenue_split_pct <= 100),
  maintenance_split_pct numeric not null check (maintenance_split_pct >= 0 and maintenance_split_pct <= 100),
  expense_categories text[] not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
