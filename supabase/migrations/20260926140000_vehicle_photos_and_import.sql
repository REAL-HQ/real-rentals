-- =============================================================================
-- Vehicle photography — Phase 3
--
-- Three corrections and one addition, all additive and replay-safe.
--
-- 1. Deleting an original that had an AI-enhanced derivative was impossible.
--    Phase 1 gave derived_from_id ON DELETE SET NULL while also requiring
--    ai_enhanced rows to carry a non-null derived_from_id, so the cascade
--    produced a row its own CHECK rejected. Verified against the live schema:
--      ERROR 23514 vehicle_media_derivation_check
--    CASCADE is what the constraint always meant: a derivative whose original
--    is gone cannot be traced to anything, so it should not outlive it.
--
-- 2. Photography was Owner-only in practice. vehicle_media is staff-managed,
--    but every storage policy on the vehicle-photos bucket tested
--    has_role(auth.uid(), 'admin') — so a Manager or Coordinator could create
--    the database row and then fail to upload the file it points at.
--
-- 3. vehicle_media granted ALL to staff, which let a Coordinator permanently
--    delete an original. Reading, adding and arranging stay with staff;
--    destroying the only copy of a photograph moves to Manager.
--
-- 4. vehicles.photos becomes derived rather than separately maintained.
--
-- ORDER IS LOAD-BEARING. The legacy vehicles.photos array is adopted into
-- vehicle_media BEFORE the sync trigger exists. Rehearsed the other way round
-- first, and lost a photo: backfilling the enhanced rows fired the trigger,
-- which rewrote vehicles.photos from the media rows that existed at that
-- moment, and the adoption step then read an array that had already been
-- truncated. Nothing here may write to vehicle_media until adoption is done.
-- =============================================================================

-- ------------------------------------- 1. columns, before anything can react

ALTER TABLE public.vehicle_media
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS provenance text NOT NULL DEFAULT 'uploaded';

ALTER TABLE public.vehicle_media DROP CONSTRAINT IF EXISTS vehicle_media_provenance_check;
ALTER TABLE public.vehicle_media ADD CONSTRAINT vehicle_media_provenance_check
  CHECK (provenance IN ('uploaded', 'adopted', 'ai_enhanced'));

COMMENT ON COLUMN public.vehicle_media.published IS
  'Whether this image feeds vehicles.photos and therefore the public fleet
   page. Unpublished keeps a photo on file without listing it. This is listing
   control, not access control: files in vehicle-photos are readable by anyone
   holding the path, which is random but not secret.';

COMMENT ON COLUMN public.vehicle_media.provenance IS
  'uploaded — a file someone put here. adopted — carried over from the legacy
   vehicles.photos array, provenance unknown. ai_enhanced — produced by an
   enhancement adapter from the original it points at.';

-- --------------------------------------- 2. derivatives follow their original

ALTER TABLE public.vehicle_media DROP CONSTRAINT IF EXISTS vehicle_media_derived_from_id_fkey;
ALTER TABLE public.vehicle_media
  ADD CONSTRAINT vehicle_media_derived_from_id_fkey
  FOREIGN KEY (derived_from_id) REFERENCES public.vehicle_media(id) ON DELETE CASCADE;

-- ------------------------------------ 3. adopt the legacy array — FIRST write
--
-- vehicles.photos predates vehicle_media. Once the trigger below owns the
-- array, anything only ever present in the array is lost the first time a
-- media row changes for that vehicle. So it is adopted now, while the array is
-- still untouched.
--
-- Marked adopted rather than uploaded because that is the truth: we know the
-- path and nothing else. We cannot tell whether an entry was a real photograph
-- or output from the old 'Generate with AI' button, which invented a studio
-- shot of a car that does not exist.

DO $adopt$
DECLARE adopted int := 0;
BEGIN
  WITH legacy AS (
    SELECT v.id AS vehicle_id, p.path, p.ord
    FROM public.vehicles v
    CROSS JOIN LATERAL unnest(COALESCE(v.photos, '{}')) WITH ORDINALITY AS p(path, ord)
    WHERE p.path IS NOT NULL AND p.path <> ''
  ),
  missing AS (
    SELECT l.* FROM legacy l
    WHERE NOT EXISTS (
      SELECT 1 FROM public.vehicle_media m
      WHERE m.vehicle_id = l.vehicle_id AND m.storage_path = l.path
    )
  ),
  ins AS (
    INSERT INTO public.vehicle_media
      (vehicle_id, kind, storage_path, provenance, is_primary, sort_order, published)
    SELECT
      m.vehicle_id, 'original', m.path, 'adopted',
      -- Only claim primary if the vehicle does not already have one, or the
      -- unique index below would reject the whole migration.
      m.ord = 1 AND NOT EXISTS (
        SELECT 1 FROM public.vehicle_media x
        WHERE x.vehicle_id = m.vehicle_id AND x.is_primary AND x.published
      ),
      (m.ord - 1)::int,
      true
    FROM missing m
    RETURNING 1
  )
  SELECT count(*) INTO adopted FROM ins;

  RAISE NOTICE 'vehicle_media: adopted % legacy photo(s).', adopted;
END $adopt$;

-- Rows that predate these columns. Safe now: adoption has already read the array.
UPDATE public.vehicle_media SET provenance = 'ai_enhanced'
  WHERE kind = 'ai_enhanced' AND provenance <> 'ai_enhanced';
UPDATE public.vehicle_media SET published = false
  WHERE kind = 'ai_enhanced' AND published;

-- Only one primary, and only among published images.
DROP INDEX IF EXISTS vehicle_media_one_primary_idx;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_media_one_primary_idx
  ON public.vehicle_media (vehicle_id) WHERE is_primary AND published;

-- --------------------------- 4. an enhanced image is never published on arrival
--
-- A renter comparing the listing to the car in the lot is entitled to see the
-- car. An enhanced image is a retouched derivative, so it reaches the website
-- only when someone puts it there deliberately. Enforced on INSERT rather than
-- by a column default, because a default cannot see which kind of row it is
-- defaulting for — and the first rehearsal of this migration published an AI
-- image straight to the public fleet page.

CREATE OR REPLACE FUNCTION public.vehicle_media_enhanced_unpublished()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'ai_enhanced' THEN
    NEW.published := false;
    -- kind and provenance cannot be allowed to disagree. The server function
    -- sets this too, but a row inserted any other way would otherwise inherit
    -- the column default and describe a retouched image as an upload.
    NEW.provenance := 'ai_enhanced';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS vehicle_media_enhanced_unpublished ON public.vehicle_media;
CREATE TRIGGER vehicle_media_enhanced_unpublished
  BEFORE INSERT ON public.vehicle_media
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_media_enhanced_unpublished();

-- -------------------------------------------- 5. vehicles.photos, derived
--
-- Two copies of the same fact drift, so the array the public projection
-- exposes is computed from the table rather than maintained by whichever code
-- path happened to run. Ordering is primary first, then sort_order, then
-- oldest — the same order the gallery shows, so what an operator arranges is
-- what a visitor sees.

CREATE OR REPLACE FUNCTION public.sync_vehicle_photos(_vehicle_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.vehicles v
  SET photos = COALESCE((
    SELECT array_agg(m.storage_path ORDER BY m.is_primary DESC, m.sort_order, m.created_at)
    FROM public.vehicle_media m
    WHERE m.vehicle_id = _vehicle_id AND m.published
  ), '{}')
  WHERE v.id = _vehicle_id;
$$;

REVOKE ALL ON FUNCTION public.sync_vehicle_photos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_vehicle_photos(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.vehicle_media_sync_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_vehicle_photos(OLD.vehicle_id);
    RETURN OLD;
  END IF;
  PERFORM public.sync_vehicle_photos(NEW.vehicle_id);
  -- A row moved between vehicles leaves the old one stale otherwise.
  IF TG_OP = 'UPDATE' AND OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id THEN
    PERFORM public.sync_vehicle_photos(OLD.vehicle_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS vehicle_media_sync ON public.vehicle_media;
CREATE TRIGGER vehicle_media_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.vehicle_media
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_media_sync_trigger();

-- Bring every array into line with the table, now that the table is complete.
DO $resync$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT vehicle_id FROM public.vehicle_media LOOP
    PERFORM public.sync_vehicle_photos(r.vehicle_id);
  END LOOP;
END $resync$;

-- ---------------------------------------------------- 6. media, by tier

DROP POLICY IF EXISTS "Staff manage vehicle media" ON public.vehicle_media;

DROP POLICY IF EXISTS "Staff read vehicle media" ON public.vehicle_media;
CREATE POLICY "Staff read vehicle media" ON public.vehicle_media
  FOR SELECT TO authenticated USING (private.is_staff());

DROP POLICY IF EXISTS "Staff add vehicle media" ON public.vehicle_media;
CREATE POLICY "Staff add vehicle media" ON public.vehicle_media
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS "Staff arrange vehicle media" ON public.vehicle_media;
CREATE POLICY "Staff arrange vehicle media" ON public.vehicle_media
  FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS "Managers delete vehicle media" ON public.vehicle_media;
CREATE POLICY "Managers delete vehicle media" ON public.vehicle_media
  FOR DELETE TO authenticated USING (private.is_manager());

-- "Partners read media on their vehicles" is unchanged.

-- ------------------------------------------- 7. the bucket, by the same tiers
--
-- Public read of image files stays: it is what serves the marketing site, and
-- vehicles_public hands out the same paths.

DROP POLICY IF EXISTS "Admins upload vehicle photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins update vehicle photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins delete vehicle photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins read vehicle photos" ON storage.objects;

DROP POLICY IF EXISTS "Staff read vehicle photos" ON storage.objects;
CREATE POLICY "Staff read vehicle photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'vehicle-photos' AND private.is_staff());

DROP POLICY IF EXISTS "Staff upload vehicle photos" ON storage.objects;
CREATE POLICY "Staff upload vehicle photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vehicle-photos'
    AND private.is_staff()
    AND storage.extension(name) = ANY (ARRAY['jpg','jpeg','png','webp','gif','avif'])
  );

DROP POLICY IF EXISTS "Staff update vehicle photos" ON storage.objects;
CREATE POLICY "Staff update vehicle photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'vehicle-photos' AND private.is_staff())
  WITH CHECK (
    bucket_id = 'vehicle-photos'
    AND private.is_staff()
    AND storage.extension(name) = ANY (ARRAY['jpg','jpeg','png','webp','gif','avif'])
  );

DROP POLICY IF EXISTS "Managers delete vehicle photos" ON storage.objects;
CREATE POLICY "Managers delete vehicle photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'vehicle-photos' AND private.is_manager());

NOTIFY pgrst, 'reload schema';
