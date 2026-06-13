CREATE POLICY "Anyone can upload owner vehicle photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'owner-vehicle-photos');

CREATE POLICY "Admins can view owner vehicle photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'owner-vehicle-photos' AND public.has_role(auth.uid(), 'admin'));