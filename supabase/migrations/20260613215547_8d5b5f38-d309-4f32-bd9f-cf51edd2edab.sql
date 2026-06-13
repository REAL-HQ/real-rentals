
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS color TEXT;

CREATE POLICY "Admins can delete contact" ON public.contact_leads FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update contact" ON public.contact_leads FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete investors" ON public.investor_leads FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update investors" ON public.investor_leads FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete fleet submissions" ON public.fleet_owner_submissions FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins read vehicle photos" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'vehicle-photos' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins upload vehicle photos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'vehicle-photos' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins update vehicle photos" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'vehicle-photos' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete vehicle photos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'vehicle-photos' AND has_role(auth.uid(), 'admin'::app_role));
