
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS doc_request_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS requested_docs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS doc_request_note text,
  ADD COLUMN IF NOT EXISTS insurance_doc_url text,
  ADD COLUMN IF NOT EXISTS recovery_sent_at timestamptz;
