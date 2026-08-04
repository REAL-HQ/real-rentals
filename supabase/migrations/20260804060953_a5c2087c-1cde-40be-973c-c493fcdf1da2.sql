CREATE POLICY "Drivers view their own documents"
ON public.documents
FOR SELECT
TO authenticated
USING (
  'driver' = ANY (visibility)
  AND driver_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.id = documents.driver_id
      AND a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Public can read vehicle photos" ON storage.objects;

CREATE POLICY "Public can read vehicle photo images"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'vehicle-photos'
  AND storage.extension(name) = ANY (ARRAY['jpg','jpeg','png','webp','gif','avif'])
);