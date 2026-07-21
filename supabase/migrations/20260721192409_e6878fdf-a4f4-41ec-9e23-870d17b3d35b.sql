
-- Admin-only UPDATE/DELETE policies for sensitive upload buckets
CREATE POLICY "Admins update license photos" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'license-uploads' AND private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'license-uploads' AND private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete license photos" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'license-uploads' AND private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update owner vehicle photos" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'owner-vehicle-photos' AND private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'owner-vehicle-photos' AND private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete owner vehicle photos" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'owner-vehicle-photos' AND private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update profile screenshots" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'profile-screenshots' AND private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'profile-screenshots' AND private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete profile screenshots" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'profile-screenshots' AND private.has_role(auth.uid(), 'admin'::app_role));

-- Vehicle-photos: writes are already admin-only. Add a documented constraint that the bucket is intended
-- for public marketing assets only, and cap object size implicitly via existing admin control. Add a
-- policy that explicitly blocks anon INSERT (already the case, but make it explicit and add a size check
-- comment). We also ensure only image mimetypes can be uploaded to reduce misuse.
DROP POLICY IF EXISTS "Admins upload vehicle photos" ON storage.objects;
CREATE POLICY "Admins upload vehicle photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vehicle-photos'
    AND private.has_role(auth.uid(), 'admin'::app_role)
    AND (storage.extension(name) IN ('jpg','jpeg','png','webp','gif','avif'))
  );

-- Tighten public-insert validation on lead-capture tables to reduce bulk spam.
-- Use email format regex, reasonable max lengths, and require sensible field bounds.

DROP POLICY IF EXISTS "Anyone can join waitlist" ON public.waitlist;
CREATE POLICY "Anyone can join waitlist" ON public.waitlist FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(email) BETWEEN 5 AND 255
    AND email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  );

DROP POLICY IF EXISTS "Anyone can submit contact" ON public.contact_leads;
CREATE POLICY "Anyone can submit contact" ON public.contact_leads FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(name) BETWEEN 1 AND 120
    AND char_length(email) BETWEEN 5 AND 255
    AND email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    AND (message IS NULL OR char_length(message) <= 5000)
  );

DROP POLICY IF EXISTS "Anyone can submit investor" ON public.investor_leads;
CREATE POLICY "Anyone can submit investor" ON public.investor_leads FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(name) BETWEEN 1 AND 120
    AND char_length(email) BETWEEN 5 AND 255
    AND email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  );

DROP POLICY IF EXISTS "Anyone can submit a vehicle" ON public.fleet_owner_submissions;
CREATE POLICY "Anyone can submit a vehicle" ON public.fleet_owner_submissions FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(full_name) BETWEEN 1 AND 120
    AND char_length(email) BETWEEN 5 AND 255
    AND email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    AND char_length(vin) BETWEEN 5 AND 32
    AND (phone IS NULL OR char_length(phone) BETWEEN 7 AND 32)
  );

DROP POLICY IF EXISTS "Anyone can submit applications" ON public.applications;
CREATE POLICY "Anyone can submit applications" ON public.applications FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(full_name) BETWEEN 1 AND 120
    AND char_length(email) BETWEEN 5 AND 255
    AND email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    AND char_length(phone) BETWEEN 7 AND 32
  );
