-- For Sale (vehicles.status = 'for_sale').
--
-- public.vehicles.status is free text. It is not an enum and it has no CHECK
-- constraint, so storing 'for_sale' does not need a new constraint. This
-- migration exists because the public catalog view filters on status: sold,
-- retired, and archived cars are already hidden, and For Sale must be hidden
-- the same way. Do not apply this file from the app. An owner applies it.
--
-- The column list is unchanged, so CREATE OR REPLACE keeps the existing grants.
-- They are restated below so a replaced view cannot be written through.

CREATE OR REPLACE VIEW public.vehicles_public
  WITH (security_invoker = false, security_barrier = true) AS
  SELECT
    v.id,
    v.year,
    v.make,
    v.model,
    v.trim,
    v.color,
    v.body_type,
    v.status,
    v.weekly_rate,
    v.monthly_rate,
    v.mpg,
    v.miles_per_tank,
    v.doors,
    v.seats,
    v.fuel_type,
    v.uber_eligibility,
    v.badges,
    v.photos,
    v.description
  FROM public.vehicles v
  WHERE v.archived_at IS NULL
    AND v.status NOT IN ('retired', 'archived', 'sold', 'for_sale');

COMMENT ON VIEW public.vehicles_public IS
  'The only vehicle data anon may read. Fixed whitelist: a column added to
   public.vehicles does not appear here until someone adds it on purpose.
   For Sale is hidden with retired, archived, and sold. Runs as owner because
   staff and renters share the authenticated role, so SELECT is granted and
   every write privilege is revoked.';

REVOKE ALL ON public.vehicles_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vehicles_public TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
