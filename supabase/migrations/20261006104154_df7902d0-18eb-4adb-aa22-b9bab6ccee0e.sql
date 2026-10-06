create table public.vehicle_defaults (
  body_type text primary key check (body_type ~ '^[a-z_]{2,30}$'),
  weekly_rate numeric check (weekly_rate is null or (weekly_rate >= 0 and weekly_rate <= 100000)),
  monthly_rate numeric check (monthly_rate is null or (monthly_rate >= 0 and monthly_rate <= 400000)),
  deposit numeric check (deposit is null or (deposit >= 0 and deposit <= 100000)),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.vehicle_defaults enable row level security;
create policy "Staff read vehicle defaults" on public.vehicle_defaults
  for select to authenticated using (private.is_staff());
revoke all on public.vehicle_defaults from anon, authenticated;
grant select on public.vehicle_defaults to authenticated;
grant all on public.vehicle_defaults to service_role;
create trigger vehicle_defaults_updated_at before update on public.vehicle_defaults
  for each row execute function public.set_updated_at();