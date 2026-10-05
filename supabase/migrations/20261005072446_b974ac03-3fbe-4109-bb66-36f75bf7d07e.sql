CREATE TABLE public.email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resend_message_id text UNIQUE,
  workflow text NOT NULL,
  recipient text NOT NULL,
  state text NOT NULL DEFAULT 'accepted'
    CHECK (state IN ('sending', 'accepted', 'delivered', 'bounced', 'complained', 'failed')),
  accepted_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  failed_at timestamptz,
  provider_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_deliveries_resend_id_idx ON public.email_deliveries (resend_message_id);
CREATE INDEX email_deliveries_recipient_idx ON public.email_deliveries (recipient);

GRANT SELECT ON public.email_deliveries TO authenticated;
GRANT ALL ON public.email_deliveries TO service_role;

ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_deliveries_staff_read
  ON public.email_deliveries
  FOR SELECT TO authenticated
  USING (private.is_staff());