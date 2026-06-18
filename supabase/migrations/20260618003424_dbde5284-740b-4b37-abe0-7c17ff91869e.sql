DROP POLICY IF EXISTS "Published sites are publicly readable" ON public.sites;

CREATE POLICY "Published sites are publicly readable"
ON public.sites
FOR SELECT
TO anon, authenticated
USING (is_published = true);