
-- 1. Fix always-true INSERT policies with meaningful field validation
DROP POLICY IF EXISTS "Anyone can submit applications" ON public.applications;
CREATE POLICY "Anyone can submit applications" ON public.applications
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(full_name) > 0
    AND char_length(email) > 3
    AND char_length(phone) > 0
  );

DROP POLICY IF EXISTS "Anyone can submit contact" ON public.contact_leads;
CREATE POLICY "Anyone can submit contact" ON public.contact_leads
  FOR INSERT TO anon, authenticated
  WITH CHECK (char_length(name) > 0 AND char_length(email) > 3);

DROP POLICY IF EXISTS "Anyone can submit investor" ON public.investor_leads;
CREATE POLICY "Anyone can submit investor" ON public.investor_leads
  FOR INSERT TO anon, authenticated
  WITH CHECK (char_length(name) > 0 AND char_length(email) > 3);

DROP POLICY IF EXISTS "Anyone can submit a vehicle" ON public.fleet_owner_submissions;
CREATE POLICY "Anyone can submit a vehicle" ON public.fleet_owner_submissions
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(full_name) > 0
    AND char_length(email) > 3
    AND char_length(vin) > 0
  );

DROP POLICY IF EXISTS "Anyone can join waitlist" ON public.waitlist;
CREATE POLICY "Anyone can join waitlist" ON public.waitlist
  FOR INSERT TO anon, authenticated
  WITH CHECK (char_length(email) > 3);

-- 2. Applicants can view their own application when linked
CREATE POLICY "Users can view their own application" ON public.applications
  FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid());

-- 3. Restrict storage uploads to UUID-scoped paths so users cannot overwrite others' files
DROP POLICY IF EXISTS "Anyone can upload license photos" ON storage.objects;
DROP POLICY IF EXISTS "anon can upload licenses" ON storage.objects;
CREATE POLICY "Scoped upload license photos" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'license-uploads'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]+$'
  );

DROP POLICY IF EXISTS "anon can upload profile screenshots" ON storage.objects;
CREATE POLICY "Scoped upload profile screenshots" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'profile-screenshots'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]+$'
  );

DROP POLICY IF EXISTS "Anyone can upload owner vehicle photos" ON storage.objects;
CREATE POLICY "Scoped upload owner vehicle photos" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'owner-vehicle-photos'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]+$'
  );

-- 4. Revoke public/anon EXECUTE on SECURITY DEFINER helper functions;
--    RLS policies that call them run as authenticated, which retains access.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_market_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_owns_rental(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.partner_owns_rental(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.partner_owns_vehicle(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_partner_owner(uuid) FROM PUBLIC, anon;
