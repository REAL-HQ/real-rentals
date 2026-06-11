
CREATE POLICY "Anyone can upload license photos" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'license-uploads');
CREATE POLICY "Admins can view license photos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'license-uploads' AND public.has_role(auth.uid(), 'admin'));
