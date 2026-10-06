ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'outbound',
  ADD COLUMN IF NOT EXISTS delivery_state text,
  ADD COLUMN IF NOT EXISTS delivery_error text,
  ADD COLUMN IF NOT EXISTS email_delivery_id uuid REFERENCES public.email_deliveries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS to_address text;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_channel_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_channel_check CHECK (channel IN ('sms','email','internal','system'));
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_direction_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_direction_check CHECK (direction IN ('inbound','outbound','internal'));
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_delivery_state_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_delivery_state_check CHECK (delivery_state IS NULL OR delivery_state IN ('sending','accepted','sent','delivered','failed','bounced','complained','skipped'));
CREATE INDEX IF NOT EXISTS messages_application_created_idx ON public.messages (application_id, created_at DESC);
GRANT ALL ON public.messages TO service_role;