
DROP POLICY IF EXISTS "anon can upload profile screenshots" ON storage.objects;
DROP POLICY IF EXISTS "anon can upload licenses" ON storage.objects;
DROP POLICY IF EXISTS "admins read profile screenshots" ON storage.objects;
DROP POLICY IF EXISTS "admins read licenses" ON storage.objects;

CREATE POLICY "anon can upload profile screenshots"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'profile-screenshots');

CREATE POLICY "anon can upload licenses"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'license-uploads');

CREATE POLICY "admins read profile screenshots"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'profile-screenshots' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins read licenses"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'license-uploads' AND public.has_role(auth.uid(), 'admin'));
