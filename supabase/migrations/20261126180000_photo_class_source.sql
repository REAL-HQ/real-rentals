-- NOT APPLIED. This file is included for review only. Do not run it as part of
-- this change. Until it is applied, labeling still fills photo_class when the
-- value is null or unknown, and cost is written to the audit log.
--
-- photo_class_source records who chose the angle so an automatic label never
-- overwrites a person. photo_label_spend is separate from Photo Studio's cap.

ALTER TABLE public.vehicle_media
  ADD COLUMN IF NOT EXISTS photo_class_source text;

ALTER TABLE public.vehicle_media DROP CONSTRAINT IF EXISTS vehicle_media_photo_class_source_check;
ALTER TABLE public.vehicle_media ADD CONSTRAINT vehicle_media_photo_class_source_check
  CHECK (photo_class_source IS NULL OR photo_class_source IN ('auto', 'manual'));

CREATE TABLE IF NOT EXISTS public.photo_label_spend (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  media_id uuid REFERENCES public.vehicle_media(id) ON DELETE SET NULL,
  model text NOT NULL,
  cost_cents numeric(10,3) NOT NULL CHECK (cost_cents >= 0),
  outcome text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photo_label_spend_created_idx ON public.photo_label_spend (created_at);
ALTER TABLE public.photo_label_spend ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read photo label spend" ON public.photo_label_spend;
CREATE POLICY "Admins read photo label spend" ON public.photo_label_spend
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
REVOKE ALL ON public.photo_label_spend FROM anon;
