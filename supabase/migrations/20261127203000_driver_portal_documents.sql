-- Driver portal: a renter sees their own records, including files staff or
-- FLEET filed team only, and never internal categories (Dolmar, 11/27/2026
-- 3:07 PM and 3:08 PM ET). Same rule as src/lib/driver-portal-documents.ts;
-- scripts/driver-portal-visibility.test.ts keeps the two lists equal.
--
-- NOT APPLIED. Owner approval required before this runs on production.
-- The app does not depend on it: the portal server reads these rows by the
-- renter's own application id and signs links itself. This adds the same rule
-- at the database layer (documents RLS and a storage read policy), scoped to
-- the signed-in renter's own application, so a renter's own session can
-- never read another renter's file or an internal category.
--
-- Rollback:
--   DROP POLICY IF EXISTS "Drivers read own portal document objects" ON storage.objects;
--   DROP POLICY IF EXISTS "Drivers view their own documents" ON public.documents;
--   CREATE POLICY "Drivers view their own documents" ON public.documents
--     FOR SELECT TO authenticated
--     USING ('driver' = ANY (visibility) AND driver_id IS NOT NULL AND EXISTS (
--       SELECT 1 FROM public.applications a WHERE a.id = documents.driver_id AND a.user_id = auth.uid()));
--   DROP FUNCTION IF EXISTS private.driver_can_read_document_object(text, text);
--   DROP FUNCTION IF EXISTS private.driver_portal_document_visible(text, text, text[]);

CREATE OR REPLACE FUNCTION private.driver_portal_document_visible(p_category text, p_kind text, p_visibility text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT
    -- Internal: screening and background reports, broker or insurer quotes,
    -- verification call recordings, vehicle titles, repair and service invoices.
    coalesce(p_category, 'other') <> ALL (ARRAY['screening', 'insurance_quote', 'verification_recording', 'title', 'repair_invoice', 'service_receipt'])
    AND coalesce(p_kind, '') <> ALL (ARRAY['screening', 'insurance_quote', 'verification_recording', 'title', 'repair_invoice', 'service_receipt'])
    AND (
      'driver' = ANY (coalesce(p_visibility, ARRAY[]::text[]))
      -- The renter's own records, even when filed team only.
      OR coalesce(p_category, '') = ANY (ARRAY['rental_application', 'agreement', 'license_front', 'license_back', 'insurance', 'gig_profile', 'income', 'trip_history'])
    )
$$;

REVOKE ALL ON FUNCTION private.driver_portal_document_visible(text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.driver_portal_document_visible(text, text, text[]) TO authenticated, service_role;

DROP POLICY IF EXISTS "Drivers view their own documents" ON public.documents;
CREATE POLICY "Drivers view their own documents" ON public.documents
  FOR SELECT TO authenticated
  USING (
    driver_id IS NOT NULL
    AND private.driver_portal_document_visible(category, kind, visibility)
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = documents.driver_id AND a.user_id = auth.uid()
    )
  );

-- A storage object the signed-in renter may read: it is the file of a
-- document row on their own application that the rule above shows them.
-- SECURITY DEFINER so the lookup is not itself filtered by documents RLS;
-- it only ever answers for auth.uid().
CREATE OR REPLACE FUNCTION private.driver_can_read_document_object(p_bucket text, p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.applications a ON a.id = d.driver_id
    WHERE d.storage_bucket = p_bucket
      AND d.storage_path = p_name
      AND a.user_id = auth.uid()
      AND private.driver_portal_document_visible(d.category, d.kind, d.visibility)
  )
$$;

REVOKE ALL ON FUNCTION private.driver_can_read_document_object(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.driver_can_read_document_object(text, text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Drivers read own portal document objects" ON storage.objects;
CREATE POLICY "Drivers read own portal document objects" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = ANY (ARRAY['driver-docs', 'license-uploads', 'profile-screenshots', 'rental-agreements'])
    AND private.driver_can_read_document_object(bucket_id, name)
  );
