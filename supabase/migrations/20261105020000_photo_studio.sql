-- Photo Studio (PR A). Additive only. REHEARSE ON STAGING FIRST; production
-- needs the Owner's explicit approval.
--
-- * vehicle_media gains a third kind, 'marketing': an AI-generated template
--   shot (front / driver / passenger / rear / interior_1..3) derived from one
--   or more originals of the SAME car.
-- * A marketing shot can never be published unless the whole car's set was
--   approved by a person (review_status = 'approved' + approved_by). Enforced
--   by trigger on INSERT and UPDATE, extending the existing ai_enhanced rule.
-- * Studio originals land in a private, staff-only bucket and are only ever
--   served through short-lived signed URLs.
-- * Spend is logged per call so the monthly cap is computed from facts.
-- No existing policy, Security 0031 or S1 object is modified.

ALTER TABLE public.vehicle_media DROP CONSTRAINT IF EXISTS vehicle_media_kind_check;
ALTER TABLE public.vehicle_media ADD CONSTRAINT vehicle_media_kind_check
  CHECK (kind IN ('original', 'ai_enhanced', 'marketing'));

ALTER TABLE public.vehicle_media DROP CONSTRAINT IF EXISTS vehicle_media_provenance_check;
ALTER TABLE public.vehicle_media ADD CONSTRAINT vehicle_media_provenance_check
  CHECK (provenance IN ('uploaded', 'adopted', 'ai_enhanced', 'ai_generated'));

ALTER TABLE public.vehicle_media
  ADD COLUMN IF NOT EXISTS shot_slot text,
  ADD COLUMN IF NOT EXISTS source_media_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS generation_model text,
  ADD COLUMN IF NOT EXISTS studio_review_status text,
  ADD COLUMN IF NOT EXISTS studio_check jsonb,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS fleet_inbox_item_id uuid,
  ADD COLUMN IF NOT EXISTS photo_class text;

ALTER TABLE public.vehicle_media DROP CONSTRAINT IF EXISTS vehicle_media_shot_slot_check;
ALTER TABLE public.vehicle_media ADD CONSTRAINT vehicle_media_shot_slot_check
  CHECK (shot_slot IS NULL OR shot_slot IN ('front','driver_side','passenger_side','rear','interior_1','interior_2','interior_3'));

ALTER TABLE public.vehicle_media DROP CONSTRAINT IF EXISTS vehicle_media_studio_review_check;
ALTER TABLE public.vehicle_media ADD CONSTRAINT vehicle_media_studio_review_check
  CHECK (studio_review_status IS NULL OR studio_review_status IN ('pending','approved','rejected'));

-- Derivation: originals carry nothing; enhanced as before; marketing needs a
-- slot, at least one source and a model name.
ALTER TABLE public.vehicle_media DROP CONSTRAINT IF EXISTS vehicle_media_derivation_check;
ALTER TABLE public.vehicle_media ADD CONSTRAINT vehicle_media_derivation_check
  CHECK (
    (kind = 'ai_enhanced' AND derived_from_id IS NOT NULL AND enhancement_mode IS NOT NULL)
    OR (kind = 'original' AND derived_from_id IS NULL AND enhancement_mode IS NULL AND shot_slot IS NULL)
    OR (kind = 'marketing' AND shot_slot IS NOT NULL AND cardinality(source_media_ids) > 0
        AND generation_model IS NOT NULL AND enhancement_mode IS NULL)
  );

-- One live (non-rejected) marketing shot per car per slot.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_media_marketing_slot_idx
  ON public.vehicle_media (vehicle_id, shot_slot)
  WHERE kind = 'marketing' AND studio_review_status IS DISTINCT FROM 'rejected';

-- Extend the "never published on arrival" rule. Runs on INSERT and UPDATE.
CREATE OR REPLACE FUNCTION public.vehicle_media_enhanced_unpublished()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'ai_enhanced' AND TG_OP = 'INSERT' THEN
    NEW.published := false;
    NEW.provenance := 'ai_enhanced';
  END IF;
  IF NEW.kind = 'marketing' THEN
    NEW.provenance := 'ai_generated';
    IF TG_OP = 'INSERT' THEN
      NEW.published := false;
      NEW.studio_review_status := 'pending';
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
    END IF;
    IF NEW.published AND NOT (NEW.studio_review_status = 'approved' AND NEW.approved_by IS NOT NULL) THEN
      RAISE EXCEPTION 'marketing shot % cannot be published before a person approves it', NEW.id;
    END IF;
  END IF;
  -- An original stored in the private studio bucket is team-only evidence.
  IF NEW.kind = 'original' AND NEW.storage_bucket = 'vehicle-originals' THEN
    NEW.published := false;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS vehicle_media_enhanced_unpublished ON public.vehicle_media;
CREATE TRIGGER vehicle_media_enhanced_unpublished
  BEFORE INSERT OR UPDATE ON public.vehicle_media
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_media_enhanced_unpublished();

-- Private bucket for studio originals. No public read, staff only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vehicle-originals', 'vehicle-originals', false, 26214400,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Staff read vehicle originals" ON storage.objects;
CREATE POLICY "Staff read vehicle originals" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'vehicle-originals' AND private.is_staff());
DROP POLICY IF EXISTS "Staff upload vehicle originals" ON storage.objects;
CREATE POLICY "Staff upload vehicle originals" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'vehicle-originals' AND private.is_staff());

-- Spend ledger. Admin-only read; written by the server (service role).
CREATE TABLE IF NOT EXISTS public.photo_studio_spend (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  shot_slot text,
  provider text NOT NULL,
  model text NOT NULL,
  cost_cents numeric(10,3) NOT NULL CHECK (cost_cents >= 0),
  outcome text NOT NULL CHECK (outcome IN ('ok','rejected_check','provider_error','mock')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photo_studio_spend_month_idx ON public.photo_studio_spend (created_at);
ALTER TABLE public.photo_studio_spend ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read studio spend" ON public.photo_studio_spend;
CREATE POLICY "Admins read studio spend" ON public.photo_studio_spend
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
REVOKE ALL ON public.photo_studio_spend FROM anon;

-- Settings live in app_settings under key 'photo_studio' (admin-only RLS).
-- Seeded OFF. Monthly cap $100 per the Owner.
INSERT INTO public.app_settings (key, value)
VALUES ('photo_studio', jsonb_build_object('enabled', false, 'dailyImageLimit', 60,
  'monthlyCapCents', 10000, 'provider', 'gemini', 'model', 'gemini-2.5-flash-image', 'version', 0))
ON CONFLICT (key) DO NOTHING;
