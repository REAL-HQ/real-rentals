-- SMS consent evidence for agreement signing and the Reservation Fee page.
-- NOT APPLIED. Do not run this against a hosted database until it is reviewed.
-- The application writes through the service role. Staff can read. The public cannot.
--
-- application_id is the lead / driver record (public.applications) when the
-- signer is the primary renter. additional_driver_id is that person's own
-- rental_additional_drivers row when they sign as a later signer. It is not a
-- foreign key: that table is created by a separate migration. The phone is
-- copied from the row on file at write time.

CREATE TABLE IF NOT EXISTS public.sms_consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consented_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text,
  wording text NOT NULL,
  wording_version text NOT NULL,
  agreement_id uuid REFERENCES public.agreements(id) ON DELETE SET NULL,
  esign_recipient_id uuid REFERENCES public.esign_recipients(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  additional_driver_id uuid,
  phone text,
  source text NOT NULL,
  consent boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sms_consent_log_source_chk CHECK (source IN ('agreement_signing', 'reservation_fee')),
  CONSTRAINT sms_consent_log_person_chk CHECK (
    application_id IS NOT NULL
    OR additional_driver_id IS NOT NULL
    OR esign_recipient_id IS NOT NULL
  )
);

COMMENT ON TABLE public.sms_consent_log IS
  'Append-only SMS consent choices from agreement signing and the Reservation Fee page. Phone is the number on file, copied server-side.';

CREATE INDEX IF NOT EXISTS sms_consent_log_application_idx ON public.sms_consent_log (application_id);
CREATE INDEX IF NOT EXISTS sms_consent_log_additional_driver_idx ON public.sms_consent_log (additional_driver_id);
CREATE INDEX IF NOT EXISTS sms_consent_log_agreement_idx ON public.sms_consent_log (agreement_id);
CREATE INDEX IF NOT EXISTS sms_consent_log_recipient_idx ON public.sms_consent_log (esign_recipient_id);

ALTER TABLE public.sms_consent_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_consent_log FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.sms_consent_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sms_consent_log TO authenticated;
GRANT ALL ON public.sms_consent_log TO service_role;

DROP POLICY IF EXISTS "Staff read sms consent log" ON public.sms_consent_log;
CREATE POLICY "Staff read sms consent log"
  ON public.sms_consent_log
  FOR SELECT TO authenticated
  USING ((SELECT private.is_staff()));
