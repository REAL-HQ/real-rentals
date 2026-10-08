ALTER TABLE public.vehicle_media DROP CONSTRAINT vehicle_media_enhancement_mode_check;
ALTER TABLE public.vehicle_media ADD CONSTRAINT vehicle_media_enhancement_mode_check CHECK (enhancement_mode IS NULL OR enhancement_mode = ANY (ARRAY['clean_background','studio','outdoor','dealer_listing','enhanced']));
ALTER TABLE public.vehicle_media ADD COLUMN review_status text CHECK (review_status IN ('pending','approved','rejected'));
ALTER TABLE public.vehicle_media ADD COLUMN quality_flags jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.vehicle_media ADD COLUMN processing_ms integer;
ALTER TABLE public.vehicle_media ADD COLUMN reviewed_by uuid;
ALTER TABLE public.vehicle_media ADD COLUMN reviewed_at timestamptz;

-- A retouched image reaches the website only after a person approved it, whatever path writes the row.
CREATE OR REPLACE FUNCTION public.vehicle_media_enhanced_publish_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'ai_enhanced' AND NEW.published AND NEW.review_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'A retouched photo must be approved before it can be published';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vehicle_media_enhanced_publish_guard BEFORE INSERT OR UPDATE ON public.vehicle_media
FOR EACH ROW EXECUTE FUNCTION public.vehicle_media_enhanced_publish_guard();

CREATE TABLE public.photo_enhance_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  daily_limit integer NOT NULL DEFAULT 20 CHECK (daily_limit BETWEEN 0 AND 1000),
  monthly_paid_cap_cents integer NOT NULL DEFAULT 1000 CHECK (monthly_paid_cap_cents >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.photo_enhance_settings TO authenticated;
GRANT ALL ON public.photo_enhance_settings TO service_role;
ALTER TABLE public.photo_enhance_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read photo enhance settings" ON public.photo_enhance_settings FOR SELECT TO authenticated USING (private.is_staff());
INSERT INTO public.photo_enhance_settings (id) VALUES (true);

CREATE TABLE public.photo_enhance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  source_media_id uuid,
  result_media_id uuid,
  mode text NOT NULL,
  status text NOT NULL CHECK (status IN ('started','succeeded','failed')),
  error text,
  processing_ms integer,
  cost_cents integer NOT NULL DEFAULT 0,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX photo_enhance_events_created_idx ON public.photo_enhance_events (created_at DESC);
GRANT SELECT ON public.photo_enhance_events TO authenticated;
GRANT ALL ON public.photo_enhance_events TO service_role;
ALTER TABLE public.photo_enhance_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read photo enhance events" ON public.photo_enhance_events FOR SELECT TO authenticated USING (private.is_manager());