-- =============================================================================
-- Applicant uploads: size and type enforced where Supabase can actually
-- enforce them, plus a rate limit on signed-URL issuance.
--
-- ON BYTE LIMITS, PLAINLY: createSignedUploadUrl() takes no size argument.
-- The signed URL authorizes a PUT and the bytes never pass through our server,
-- so requestUploadUrl CANNOT enforce a byte ceiling, and any claim that it
-- does would be false. The place Supabase Storage enforces size and MIME on
-- every upload — signed ones included — is the bucket, so that is where the
-- limit goes.
--
-- The bucket limit is one number, and images and PDFs want different ones
-- (15 MB and 25 MB). The bucket takes the higher of the two; the per-type
-- distinction stays a client-side UX check in image-optimize.ts, which is
-- honest about being UX: it gives a good message before a long upload rather
-- than being the control.
-- =============================================================================

UPDATE storage.buckets
   SET file_size_limit = 26214400,  -- 25 MiB, the PDF ceiling
       allowed_mime_types = ARRAY[
         'image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'
       ]
 WHERE id IN ('license-uploads', 'profile-screenshots');

-- --------------------------------------------------------------- rate limit
--
-- One signed URL is one opportunity to write an object. Without a ceiling,
-- anybody holding a live resume token can mint them in a loop and fill the
-- bucket. The limit is per application because that is what the token binds
-- to, and it is set well above what finishing a driver profile takes: five
-- documents, a few retakes each, and room for a bad connection.
CREATE TABLE IF NOT EXISTS public.applicant_upload_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS applicant_upload_grants_window_idx
  ON public.applicant_upload_grants (application_id, created_at DESC);

-- Same shape as application_resume_tokens: RLS on, no policy, no grant to any
-- browser role. Only the service role touches it.
ALTER TABLE public.applicant_upload_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.applicant_upload_grants FROM anon, authenticated;
GRANT ALL ON public.applicant_upload_grants TO service_role;

COMMENT ON TABLE public.applicant_upload_grants IS
  'One row per signed upload URL issued to an applicant. Read only to rate
   limit issuance; safe to prune anything older than a day.';
