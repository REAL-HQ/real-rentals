CREATE TABLE public.application_identity_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  submitted_full_name text,
  submitted_email text,
  submitted_phone text,
  source text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution text CHECK (resolution IS NULL OR resolution IN ('same_person','different_person','dismissed')),
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.application_identity_reviews IS 'Durable identity conflicts (e.g. same phone, different email). Never auto-merged; resolved only by Manager+ via server function, audited. Not touched by AI scoring.';
CREATE INDEX application_identity_reviews_app_idx ON public.application_identity_reviews (application_id, status);
CREATE UNIQUE INDEX application_identity_reviews_open_uniq ON public.application_identity_reviews (application_id, kind, lower(coalesce(submitted_email,'')), coalesce(submitted_phone,'')) WHERE status = 'open';
GRANT SELECT ON public.application_identity_reviews TO authenticated;
GRANT ALL ON public.application_identity_reviews TO service_role;
ALTER TABLE public.application_identity_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view identity reviews" ON public.application_identity_reviews FOR SELECT TO authenticated USING (private.is_staff());