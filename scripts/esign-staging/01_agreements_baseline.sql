-- ===========================================================================
-- eSign STAGING BASELINE — the real existing agreements schema.
-- PROPOSED. NOT APPLIED. Staging only (bhpdppyxnkokzhlkgcsc).
--
-- Every object below was extracted from the live production catalogue of
-- yuyzdsnrbfhkmfzpvhwx on 2026-10-13 (read-only), not reconstructed from the
-- migration files. Column order, defaults, constraint expressions, index
-- predicates, trigger wiring, policy expressions and function bodies are the
-- production definitions verbatim. Nothing here is invented, and there are no
-- placeholder tables.
--
-- DELIBERATELY EXCLUDED, per scope:
--   * the historical production cron surface (esign-archive-retry and the
--     other five cron routes). Staging runs no scheduled work.
--   * broad Coordinator permissions. Production's "Staff read agreements"
--     policy grants SELECT to private.is_staff(), which includes the
--     coordinator tier. It is reproduced here EXACTLY so the baseline matches
--     production, and 0023 is what narrows it: its restrictive
--     identity_agreement_boundary limits staff reads to private.is_manager().
--     Narrowing it here instead would mean staging never tests the production
--     policy stack that 0023 actually has to intersect with.
--
-- Prerequisites this file does NOT create, and the installer verifies first:
--   public.applications, public.vehicles, public.rentals, public.documents,
--   public.user_roles, the app_role enum, private.has_role/is_staff/is_manager.
-- ===========================================================================

-- NO BEGIN/COMMIT HERE. The runner owns the transaction: install.sh wraps
-- preflight, this payload, the ledger receipt and postflight in ONE
-- transaction, which is what makes the stage and its receipt atomic. A
-- COMMIT in this file would end that transaction early and let the work
-- land without — or before — its receipt.

-- --------------------------------------------------------------- functions
-- The shared updated_at trigger function. CREATE OR REPLACE: if staging
-- already carries it from an earlier receipt, this is a no-op rather than a
-- conflict, and the body is identical to production's.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END $function$;

-- ------------------------------------------------------- agreement_templates
CREATE TABLE IF NOT EXISTS public.agreement_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  body        text NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------- agreements
-- 44 columns, in production's ordinal order. A signed agreement's body,
-- sha256 and signed_at are the record of what somebody agreed to, so this
-- table is only ever added to — never rewritten.
CREATE TABLE IF NOT EXISTS public.agreements (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id          uuid,
  vehicle_id              uuid,
  rental_id               uuid,
  template_id             uuid,
  title                   text NOT NULL DEFAULT 'Vehicle Rental Agreement'::text,
  body                    text NOT NULL,
  merge_data              jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                  text NOT NULL DEFAULT 'draft'::text,
  token_hash              text,
  token_expires_at        timestamptz,
  sent_at                 timestamptz,
  viewed_at               timestamptz,
  signed_at               timestamptz,
  voided_at               timestamptz,
  signer_name             text,
  signer_email            text,
  signer_ip               text,
  signer_user_agent       text,
  company_signer_name     text NOT NULL DEFAULT 'REAL RENTALS'::text,
  document_id             uuid,
  created_by              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  source                  text NOT NULL DEFAULT 'rental'::text,
  completed_at            timestamptz,
  expires_at              timestamptz,
  completed_document_id   uuid,
  archive_status          text NOT NULL DEFAULT 'none'::text,
  archive_error           text,
  archive_attempts        integer NOT NULL DEFAULT 0,
  sha256                  text,
  body_sha256             text,
  company_signer_title    text,
  signing_started_at      timestamptz,
  auth_method             text,
  metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,
  email_status            text NOT NULL DEFAULT 'not_attempted'::text,
  email_error             text,
  email_attempted_at      timestamptz,
  sms_status              text NOT NULL DEFAULT 'not_attempted'::text,
  sms_error               text,
  sms_attempted_at        timestamptz,
  archive_last_attempt_at timestamptz
);

-- Constraints, exactly as production defines them. Added separately and
-- guarded, because ADD CONSTRAINT has no IF NOT EXISTS.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agreements_status_chk' AND conrelid='public.agreements'::regclass) THEN
    ALTER TABLE public.agreements ADD CONSTRAINT agreements_status_chk
      CHECK (status = ANY (ARRAY['draft'::text,'sent'::text,'viewed'::text,'signing'::text,'signed'::text,'voided'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agreements_source_chk' AND conrelid='public.agreements'::regclass) THEN
    ALTER TABLE public.agreements ADD CONSTRAINT agreements_source_chk
      CHECK (source = ANY (ARRAY['rental'::text,'standalone'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agreements_archive_chk' AND conrelid='public.agreements'::regclass) THEN
    ALTER TABLE public.agreements ADD CONSTRAINT agreements_archive_chk
      CHECK (archive_status = ANY (ARRAY['none'::text,'pending'::text,'archived'::text,'failed'::text]));
  END IF;
  -- A rental agreement must name the applicant it binds.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agreements_rental_app_chk' AND conrelid='public.agreements'::regclass) THEN
    ALTER TABLE public.agreements ADD CONSTRAINT agreements_rental_app_chk
      CHECK ((source <> 'rental'::text) OR (application_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agreements_token_hash_key' AND conrelid='public.agreements'::regclass) THEN
    ALTER TABLE public.agreements ADD CONSTRAINT agreements_token_hash_key UNIQUE (token_hash);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agreements_application_id_fkey' AND conrelid='public.agreements'::regclass) THEN
    ALTER TABLE public.agreements ADD CONSTRAINT agreements_application_id_fkey
      FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agreements_vehicle_id_fkey' AND conrelid='public.agreements'::regclass) THEN
    ALTER TABLE public.agreements ADD CONSTRAINT agreements_vehicle_id_fkey
      FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agreements_rental_id_fkey' AND conrelid='public.agreements'::regclass) THEN
    ALTER TABLE public.agreements ADD CONSTRAINT agreements_rental_id_fkey
      FOREIGN KEY (rental_id) REFERENCES public.rentals(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agreements_template_id_fkey' AND conrelid='public.agreements'::regclass) THEN
    ALTER TABLE public.agreements ADD CONSTRAINT agreements_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES public.agreement_templates(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agreements_document_id_fkey' AND conrelid='public.agreements'::regclass) THEN
    ALTER TABLE public.agreements ADD CONSTRAINT agreements_document_id_fkey
      FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS agreements_application_idx ON public.agreements USING btree (application_id);
-- Production carries both the UNIQUE constraint's index and this partial one.
CREATE UNIQUE INDEX IF NOT EXISTS agreements_token_hash_uidx
  ON public.agreements USING btree (token_hash) WHERE (token_hash IS NOT NULL);

DROP TRIGGER IF EXISTS agreements_set_updated_at ON public.agreements;
CREATE TRIGGER agreements_set_updated_at BEFORE UPDATE ON public.agreements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------- esign_recipients
-- The recipient table. document_id references agreements(id) — the column is
-- named document_id for historical reasons; it is the agreement.
CREATE TABLE IF NOT EXISTS public.esign_recipients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       uuid NOT NULL,
  name              text,
  email             text,
  phone             text,
  role              text NOT NULL DEFAULT 'signer'::text,
  signing_order     integer NOT NULL DEFAULT 1,
  status            text NOT NULL DEFAULT 'pending'::text,
  sent_at           timestamptz,
  viewed_at         timestamptz,
  signed_at         timestamptz,
  ip                text,
  user_agent        text,
  auth_method       text,
  token_hash        text,
  token_expires_at  timestamptz,
  token_revoked_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='esign_recipients_role_check' AND conrelid='public.esign_recipients'::regclass) THEN
    ALTER TABLE public.esign_recipients ADD CONSTRAINT esign_recipients_role_check
      CHECK (role = ANY (ARRAY['signer'::text,'cc'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='esign_recipients_document_id_fkey' AND conrelid='public.esign_recipients'::regclass) THEN
    ALTER TABLE public.esign_recipients ADD CONSTRAINT esign_recipients_document_id_fkey
      FOREIGN KEY (document_id) REFERENCES public.agreements(id) ON DELETE CASCADE;
  END IF;
END $$;

-- One signer per position on an agreement. CC rows are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS esign_recipients_signer_uidx
  ON public.esign_recipients USING btree (document_id, signing_order) WHERE (role = 'signer'::text);

DROP TRIGGER IF EXISTS esign_recipients_set_updated_at ON public.esign_recipients;
CREATE TRIGGER esign_recipients_set_updated_at BEFORE UPDATE ON public.esign_recipients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------- signing claim/void RPCs
-- The atomic claim. Two tabs opening the same signing link must not both
-- reach a signature: exactly one UPDATE wins, and the loser is told which
-- state it actually found. The two-minute window releases a claim abandoned
-- mid-signature rather than wedging the agreement forever.
CREATE OR REPLACE FUNCTION public.esign_claim(_id uuid, _token_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
END $function$;

-- Void never touches a signed agreement: the WHERE clause only matches
-- draft/sent/viewed, and the caller is told the state it actually found.
CREATE OR REPLACE FUNCTION public.esign_void(_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
END $function$;

-- ------------------------------------------------------------- RLS and grants
ALTER TABLE public.agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esign_recipients ENABLE ROW LEVEL SECURITY;

-- Table grants as production holds them. RLS is what actually decides access;
-- these only open the door far enough for a policy to be consulted.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreement_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.esign_recipients TO authenticated;
GRANT ALL ON public.agreements, public.agreement_templates, public.esign_recipients TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agreements' AND policyname='Managers manage agreements') THEN
    CREATE POLICY "Managers manage agreements" ON public.agreements
      FOR ALL TO authenticated USING (private.is_manager()) WITH CHECK (private.is_manager());
  END IF;
  -- Reproduced exactly as production has it, coordinator reach included.
  -- 0023's restrictive identity_agreement_boundary is what narrows this to
  -- Manager, and it can only be shown to do that against the real policy.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agreements' AND policyname='Staff read agreements') THEN
    CREATE POLICY "Staff read agreements" ON public.agreements
      FOR SELECT TO authenticated USING (private.is_staff());
  END IF;
  -- A driver sees their own agreement and no other.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agreements' AND policyname='Drivers view their own agreements') THEN
    CREATE POLICY "Drivers view their own agreements" ON public.agreements
      FOR SELECT TO authenticated USING (EXISTS (
        SELECT 1 FROM public.applications a
         WHERE a.id = agreements.application_id AND a.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agreement_templates' AND policyname='Admins manage agreement templates') THEN
    CREATE POLICY "Admins manage agreement templates" ON public.agreement_templates
      FOR ALL TO authenticated
      USING (private.has_role(auth.uid(), 'admin'::app_role))
      WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='esign_recipients' AND policyname='Staff read recipients') THEN
    CREATE POLICY "Staff read recipients" ON public.esign_recipients
      FOR SELECT TO authenticated USING (private.is_staff());
  END IF;
END $$;

