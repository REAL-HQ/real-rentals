ALTER TABLE public.agreements ALTER COLUMN application_id DROP NOT NULL;
ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'rental',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_document_id uuid,
  ADD COLUMN IF NOT EXISTS archive_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS archive_error text,
  ADD COLUMN IF NOT EXISTS archive_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sha256 text,
  ADD COLUMN IF NOT EXISTS body_sha256 text,
  ADD COLUMN IF NOT EXISTS company_signer_title text,
  ADD COLUMN IF NOT EXISTS signing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS auth_method text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.agreements ADD CONSTRAINT agreements_source_chk CHECK (source IN ('rental','standalone'));
ALTER TABLE public.agreements ADD CONSTRAINT agreements_rental_app_chk CHECK (source <> 'rental' OR application_id IS NOT NULL);
ALTER TABLE public.agreements ADD CONSTRAINT agreements_status_chk CHECK (status IN ('draft','sent','viewed','signing','signed','voided'));
ALTER TABLE public.agreements ADD CONSTRAINT agreements_archive_chk CHECK (archive_status IN ('none','pending','archived','failed'));
CREATE UNIQUE INDEX IF NOT EXISTS agreements_token_hash_uidx ON public.agreements(token_hash) WHERE token_hash IS NOT NULL;

CREATE TABLE public.esign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.agreements(id) ON DELETE CASCADE,
  name text, email text, phone text,
  role text NOT NULL DEFAULT 'signer' CHECK (role IN ('signer','cc')),
  signing_order int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz, viewed_at timestamptz, signed_at timestamptz,
  ip text, user_agent text, auth_method text,
  token_hash text, token_expires_at timestamptz, token_revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX esign_recipients_signer_uidx ON public.esign_recipients(document_id, signing_order) WHERE role='signer';
GRANT SELECT ON public.esign_recipients TO authenticated;
GRANT ALL ON public.esign_recipients TO service_role;
ALTER TABLE public.esign_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read recipients" ON public.esign_recipients FOR SELECT TO authenticated USING (private.is_staff());
CREATE TRIGGER esign_recipients_set_updated_at BEFORE UPDATE ON public.esign_recipients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Staff (coordinators) can read; managers still manage.
CREATE POLICY "Staff read agreements" ON public.agreements FOR SELECT TO authenticated USING (private.is_staff());

REVOKE ALL ON public.agreements FROM anon;
REVOKE ALL ON public.agreement_templates FROM anon;

-- Atomic claim: only one caller moves sent/viewed -> signing.
CREATE OR REPLACE FUNCTION public.esign_claim(_id uuid, _token_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.agreements%ROWTYPE; n int;
BEGIN
  UPDATE public.agreements SET status='signing', signing_started_at=now()
   WHERE id=_id
     AND (status IN ('sent','viewed') OR (status='signing' AND signing_started_at < now() - interval '2 minutes'))
     AND (_token_hash IS NULL OR token_hash=_token_hash)
     AND (token_expires_at IS NULL OR token_expires_at > now() OR _token_hash IS NULL);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 THEN RETURN 'won'; END IF;
  SELECT * INTO r FROM public.agreements WHERE id=_id;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF r.status='signed' THEN RETURN 'already_signed'; END IF;
  IF r.status='signing' THEN RETURN 'in_progress'; END IF;
  IF r.status='voided' THEN RETURN 'voided'; END IF;
  IF _token_hash IS NOT NULL AND r.token_hash IS DISTINCT FROM _token_hash THEN RETURN 'invalid'; END IF;
  RETURN 'expired';
END $$;
REVOKE ALL ON FUNCTION public.esign_claim(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.esign_claim(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.esign_void(_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int; s text;
BEGIN
  UPDATE public.agreements SET status='voided', voided_at=now(), token_hash=NULL
   WHERE id=_id AND status IN ('draft','sent','viewed');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 THEN
    UPDATE public.esign_recipients SET token_revoked_at=now(), status='voided' WHERE document_id=_id AND token_revoked_at IS NULL;
    RETURN 'voided';
  END IF;
  SELECT status INTO s FROM public.agreements WHERE id=_id;
  RETURN coalesce(s,'invalid');
END $$;
REVOKE ALL ON FUNCTION public.esign_void(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.esign_void(uuid) TO service_role;