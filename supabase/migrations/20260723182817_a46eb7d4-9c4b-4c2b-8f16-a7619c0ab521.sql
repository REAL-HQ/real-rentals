
DROP POLICY IF EXISTS "Scoped upload license photos" ON storage.objects;
CREATE POLICY "Scoped upload license photos" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'license-uploads'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]+$'
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id::text = split_part(objects.name, '/', 1)
        AND a.created_at > now() - interval '14 days'
        AND COALESCE(lower(a.status), '') NOT IN ('complete','completed','approved','rejected','active')
        AND COALESCE(lower(a.current_step), '') NOT IN ('confirmation','complete','done')
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
      WHERE a.id::text = split_part(objects.name, '/', 1)
        AND a.created_at > now() - interval '14 days'
        AND COALESCE(lower(a.status), '') NOT IN ('complete','completed','approved','rejected','active')
        AND COALESCE(lower(a.current_step), '') NOT IN ('confirmation','complete','done')
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
      WHERE s.id::text = split_part(objects.name, '/', 1)
        AND s.created_at > now() - interval '14 days'
        AND COALESCE(lower(s.status), '') NOT IN ('approved','enrolled','declined')
    )
  );
