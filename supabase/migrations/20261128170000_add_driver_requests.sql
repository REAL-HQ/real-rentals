-- Add Driver requests from the Driver Portal (Dolmar, Nov 28 2026 11:41 AM ET).
--
-- NOT APPLIED. Owner approval required before this runs on any hosted database.
-- The feature is also behind Automations → Add Driver (Portal)
-- (app_settings automation_controls key renter_add_driver), which is Off until
-- an Owner turns it on.
--
-- One row is one request by a renter to add a driver who lives at the same
-- address. Order: Requested → Paid → Insurance Pending → Approved or Denied.
-- A Denied request may also come straight from Requested or Paid.
--
--   * Reads: the renter whose application the row is on (applications.user_id
--     = auth.uid()), and Managers or Owners (private.is_manager()). Nobody else.
--   * Writes: service role only, from server functions. The renter submits and
--     pays through token-checked server functions; only staff server functions
--     (Manager+) move a request to Insurance Pending, Approved or Denied.
--   * The guard trigger refuses a skipped or backward step, an Approved
--     without a staff decision and an insurance card on file, and a Denied
--     without a staff decision and a note. Nothing here marks anyone insured
--     or verified on its own.
--   * No insurer, broker or rep name is stored for the renter to see.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.additional_driver_requests;
--   DROP FUNCTION IF EXISTS public.guard_additional_driver_request();

CREATE TABLE IF NOT EXISTS public.additional_driver_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  full_name text NOT NULL,
  dob date NOT NULL,
  phone text NOT NULL,
  email text NOT NULL,
  relationship text NOT NULL,
  address_line1 text NOT NULL,
  address_line2 text,
  city text NOT NULL,
  state text NOT NULL,
  zip text NOT NULL,
  license_number text NOT NULL,
  license_state text NOT NULL,
  license_expiration date NOT NULL,
  years_licensed integer,
  license_front_path text NOT NULL,
  license_back_path text NOT NULL,
  consent_version text NOT NULL,
  consent_at timestamptz NOT NULL DEFAULT now(),
  fee_cents integer NOT NULL DEFAULT 10000,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  checkout_session_id text,
  checkout_url text,
  checkout_created_at timestamptz,
  paid_at timestamptz,
  insurance_started_at timestamptz,
  insurance_started_by uuid,
  decided_at timestamptz,
  decided_by uuid,
  decision_notes text,
  insurance_card_path text,
  insurance_card_uploaded_at timestamptz,
  insurance_card_uploaded_by uuid,
  refund_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT additional_driver_requests_status_chk
    CHECK (status IN ('requested', 'paid', 'insurance_pending', 'approved', 'denied')),
  CONSTRAINT additional_driver_requests_fee_chk CHECK (fee_cents > 0),
  CONSTRAINT additional_driver_requests_years_chk CHECK (years_licensed IS NULL OR years_licensed BETWEEN 0 AND 80)
);

CREATE INDEX IF NOT EXISTS additional_driver_requests_application_idx ON public.additional_driver_requests (application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS additional_driver_requests_rental_idx ON public.additional_driver_requests (rental_id);
CREATE INDEX IF NOT EXISTS additional_driver_requests_status_idx ON public.additional_driver_requests (status, created_at);
CREATE INDEX IF NOT EXISTS additional_driver_requests_payment_idx ON public.additional_driver_requests (payment_id);

DROP TRIGGER IF EXISTS additional_driver_requests_set_updated_at ON public.additional_driver_requests;
CREATE TRIGGER additional_driver_requests_set_updated_at
  BEFORE UPDATE ON public.additional_driver_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Status order and the facts each step needs. Same rule as
-- src/lib/add-driver-requests.ts (ADD_DRIVER_TRANSITIONS); the Postgres test
-- keeps the two in step.
CREATE OR REPLACE FUNCTION public.guard_additional_driver_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'requested' THEN
      RAISE EXCEPTION 'add_driver_request_must_start_requested' USING ERRCODE = '42501';
    END IF;
    IF NEW.paid_at IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.insurance_card_path IS NOT NULL THEN
      RAISE EXCEPTION 'add_driver_request_must_start_requested' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Who asked, for whom, and the details they sent never change after submit.
  IF NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.full_name IS DISTINCT FROM OLD.full_name
     OR NEW.dob IS DISTINCT FROM OLD.dob
     OR NEW.license_number IS DISTINCT FROM OLD.license_number
     OR NEW.license_front_path IS DISTINCT FROM OLD.license_front_path
     OR NEW.license_back_path IS DISTINCT FROM OLD.license_back_path
     OR NEW.address_line1 IS DISTINCT FROM OLD.address_line1
     OR NEW.zip IS DISTINCT FROM OLD.zip THEN
    RAISE EXCEPTION 'add_driver_request_details_locked' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('approved', 'denied') THEN
      RAISE EXCEPTION 'add_driver_request_closed' USING ERRCODE = '42501';
    END IF;
    IF NOT (
      (OLD.status = 'requested' AND NEW.status IN ('paid', 'denied'))
      OR (OLD.status = 'paid' AND NEW.status IN ('insurance_pending', 'denied'))
      OR (OLD.status = 'insurance_pending' AND NEW.status IN ('approved', 'denied'))
    ) THEN
      RAISE EXCEPTION 'add_driver_request_bad_step' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'paid' AND (NEW.paid_at IS NULL OR NEW.payment_id IS NULL) THEN
      RAISE EXCEPTION 'add_driver_request_paid_needs_payment' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'insurance_pending' AND (NEW.insurance_started_by IS NULL OR NEW.insurance_started_at IS NULL) THEN
      RAISE EXCEPTION 'add_driver_request_needs_staff' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'approved' AND (NEW.decided_by IS NULL OR NEW.decided_at IS NULL OR NEW.insurance_card_path IS NULL) THEN
      RAISE EXCEPTION 'add_driver_request_approve_needs_card' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'denied' AND (NEW.decided_by IS NULL OR NEW.decided_at IS NULL OR coalesce(btrim(NEW.decision_notes), '') = '') THEN
      RAISE EXCEPTION 'add_driver_request_deny_needs_note' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS additional_driver_requests_guard ON public.additional_driver_requests;
CREATE TRIGGER additional_driver_requests_guard
  BEFORE INSERT OR UPDATE ON public.additional_driver_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_additional_driver_request();

ALTER TABLE public.additional_driver_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.additional_driver_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.additional_driver_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.additional_driver_requests TO authenticated;
GRANT ALL ON public.additional_driver_requests TO service_role;

DROP POLICY IF EXISTS "Managers read add driver requests" ON public.additional_driver_requests;
CREATE POLICY "Managers read add driver requests"
  ON public.additional_driver_requests
  FOR SELECT TO authenticated
  USING (private.is_manager());

DROP POLICY IF EXISTS "Renter reads own add driver requests" ON public.additional_driver_requests;
CREATE POLICY "Renter reads own add driver requests"
  ON public.additional_driver_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = additional_driver_requests.application_id AND a.user_id = auth.uid()
    )
  );
