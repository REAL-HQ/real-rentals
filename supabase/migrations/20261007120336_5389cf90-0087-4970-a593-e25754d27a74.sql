CREATE TABLE public.inbound_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'resend',
  provider_event_id text,
  provider_email_id text NOT NULL,
  message_id text,
  in_reply_to text,
  references_header text,
  from_address text,
  from_name text,
  to_addresses text[] NOT NULL DEFAULT '{}',
  intake_address text,
  subject text,
  received_at timestamptz NOT NULL DEFAULT now(),
  text_body text,
  html_sanitized text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  batch_id uuid REFERENCES public.fleet_import_batches(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'received',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_email_id)
);
CREATE UNIQUE INDEX inbound_emails_event_idx ON public.inbound_emails(provider, provider_event_id) WHERE provider_event_id IS NOT NULL;
CREATE INDEX inbound_emails_message_idx ON public.inbound_emails(message_id);
GRANT SELECT ON public.inbound_emails TO authenticated;
GRANT ALL ON public.inbound_emails TO service_role;
ALTER TABLE public.inbound_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read inbound emails" ON public.inbound_emails FOR SELECT TO authenticated USING (private.is_manager());
CREATE TRIGGER inbound_emails_set_updated_at BEFORE UPDATE ON public.inbound_emails FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.fleet_import_batches
  ADD COLUMN source_channel text NOT NULL DEFAULT 'fleet_inbox',
  ADD COLUMN inbound_email_id uuid REFERENCES public.inbound_emails(id) ON DELETE SET NULL;
ALTER TABLE public.fleet_import_items
  ADD COLUMN source_channel text NOT NULL DEFAULT 'fleet_inbox',
  ADD COLUMN inbound_email_id uuid REFERENCES public.inbound_emails(id) ON DELETE SET NULL,
  ADD COLUMN source_attachment_id text;