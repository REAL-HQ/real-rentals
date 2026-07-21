
REVOKE ALL ON public.applications FROM anon;
REVOKE ALL ON public.waitlist FROM anon;
REVOKE ALL ON public.contact_leads FROM anon;
REVOKE ALL ON public.investor_leads FROM anon;
REVOKE ALL ON public.fleet_owner_submissions FROM anon;

GRANT INSERT (
  full_name, phone, email, city, state, market_id, sms_consent, source,
  pickup_date, return_date, rental_length, rental_term, vehicle_id, platform_status,
  utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid
) ON public.applications TO anon;

GRANT INSERT (
  full_name, email, phone, market_id, driver_status, source,
  utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid
) ON public.waitlist TO anon;

GRANT INSERT (name, email, phone, message) ON public.contact_leads TO anon;

GRANT INSERT (name, email, phone, capital_range, vehicles_interested, message)
  ON public.investor_leads TO anon;

GRANT INSERT (
  full_name, email, phone, vin, year, make, model, trim, mileage,
  title_status, lien_status, registration_state, currently_insured, condition,
  photo_urls, message
) ON public.fleet_owner_submissions TO anon;
