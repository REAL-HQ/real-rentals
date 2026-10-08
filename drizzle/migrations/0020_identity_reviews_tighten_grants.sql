REVOKE ALL ON public.application_identity_reviews FROM anon, authenticated;
GRANT SELECT ON public.application_identity_reviews TO authenticated;