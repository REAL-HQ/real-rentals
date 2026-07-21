-- Tighten storage upload policies: verify the first path segment corresponds
-- to an existing submission/application row, not just a UUID-shaped string.

DROP POLICY IF EXISTS "Scoped upload license photos" ON storage.objects;
CREATE POLICY "Scoped upload license photos" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'license-uploads'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]+$'
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id::text = split_part(storage.objects.name, '/', 1)
    )
  );

DROP POLICY IF EXISTS "Scoped upload profile screenshots" ON storage.objects;
CREATE POLICY "Scoped upload profile screenshots" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'profile-screenshots'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]+$'
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id::text = split_part(storage.objects.name, '/', 1)
    )
  );

DROP POLICY IF EXISTS "Scoped upload owner vehicle photos" ON storage.objects;
CREATE POLICY "Scoped upload owner vehicle photos" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'owner-vehicle-photos'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]+$'
    AND EXISTS (
      SELECT 1 FROM public.fleet_owner_submissions s
      WHERE s.id::text = split_part(storage.objects.name, '/', 1)
    )
  );

-- Allow the storage policies (which run as anon/authenticated) to verify
-- that the referenced row exists, without exposing row contents.
GRANT SELECT (id) ON public.applications TO anon;
GRANT SELECT (id) ON public.fleet_owner_submissions TO anon;