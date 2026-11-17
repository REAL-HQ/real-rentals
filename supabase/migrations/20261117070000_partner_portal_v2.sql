-- =============================================================================
-- Partner Portal v2 (Dolmar, Nov 17 2026 via FLEET t157u)
--
-- What this adds
--   1. Intake fields on fleet_owner_submissions: address, business name,
--      private registration / ID document paths, SMS consent, the partner it
--      belongs to, a client idempotency key (the form used to create one row
--      per retry: 5 identical Rogue rows on Aug 28, 2 XC90 rows on Sep 15),
--      and the staff decision (listed vehicle, who, when).
--   2. Profile + payout-setup fields on partners (Stripe Connect account id,
--      never a bank account or routing number).
--   3. A private `partner-documents` bucket for registration, ID and payout
--      receipts. Every upload goes through a server-issued signed upload URL,
--      so anon gets no storage policy here at all. Partners may read only their
--      own folder (<partner_id>/...); staff (manager+) manage everything.
--   4. payouts.receipt_path / method / reference for payout receipts.
--   5. partner_notice_sends: once-per-rental claim for the "your car is rented"
--      notice (feature-flagged OFF in Back Office -> Automations).
--   6. approve_partner_submission(): the one-button "List This Car" decision,
--      atomic: partner -> active, vehicle created (or an unowned VIN linked),
--      submission -> approved. Service role only; the server function checks
--      the Manager tier before calling it.
--   7. Tightens partner RLS. Partners lose direct SELECT on applications,
--      rentals, payments, vehicle_expenses, issues, maintenance_records and
--      renter documents (plus the storage policy that let them open renter
--      licences and rental agreements). The portal reads all of that through
--      server functions that return a fixed whitelist: no renter name,
--      contact, vetting result, agreement, or insurance detail ever reaches a
--      partner. Production has 0 linked partner logins today (Nov 17 2026), so
--      nobody loses access they are using.
--
-- This migration is NOT applied by this PR; it ships as a file only.
-- Rollback: proposed/partner-portal-v2-rollback.sql
-- =============================================================================

-- ------------------------------------------------------------ 1. submissions
ALTER TABLE public.fleet_owner_submissions
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS license_plate text,
  ADD COLUMN IF NOT EXISTS registration_path text,
  ADD COLUMN IF NOT EXISTS id_document_path text,
  ADD COLUMN IF NOT EXISTS sms_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS listed_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decline_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS fleet_owner_submissions_idem_idx
  ON public.fleet_owner_submissions (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS fleet_owner_submissions_partner_idx
  ON public.fleet_owner_submissions (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fleet_owner_submissions_email_idx
  ON public.fleet_owner_submissions (lower(email));

-- ------------------------------------------------------------ 2. partners
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS sms_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS notify_rentals boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS activated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text,
  ADD COLUMN IF NOT EXISTS payouts_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_setup_updated_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS partners_email_lower_idx
  ON public.partners (lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS partners_user_id_idx
  ON public.partners (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS partners_stripe_connect_idx
  ON public.partners (stripe_connect_account_id) WHERE stripe_connect_account_id IS NOT NULL;

-- Partners read their own row (the portal header). Writes stay staff/server.
DROP POLICY IF EXISTS "Partners read own partner row" ON public.partners;
CREATE POLICY "Partners read own partner row" ON public.partners
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ------------------------------------------------------------ 3. bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('partner-documents', 'partner-documents', false, 26214400,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Managers manage partner documents" ON storage.objects;
CREATE POLICY "Managers manage partner documents" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'partner-documents' AND private.is_manager())
  WITH CHECK (bucket_id = 'partner-documents' AND private.is_manager());

-- Partners read only <their partner id>/... ; intake files live under
-- intake/<submission id>/... and are staff-only until approval.
DROP POLICY IF EXISTS "Partners read own partner documents" ON storage.objects;
CREATE POLICY "Partners read own partner documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'partner-documents'
    AND split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND private.is_partner_owner(split_part(name, '/', 1)::uuid)
  );

-- ------------------------------------------------------------ 4. payouts
ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS receipt_path text,
  ADD COLUMN IF NOT EXISTS method text,
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS expenses_total numeric NOT NULL DEFAULT 0;

-- ------------------------------------------------------------ 5. notice claims
CREATE TABLE IF NOT EXISTS public.partner_notice_sends (
  key text PRIMARY KEY,
  kind text NOT NULL,
  partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  channel text,
  status text NOT NULL DEFAULT 'claimed',
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.partner_notice_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_notice_sends FROM anon, authenticated;
GRANT ALL ON public.partner_notice_sends TO service_role;
GRANT SELECT ON public.partner_notice_sends TO authenticated;
DROP POLICY IF EXISTS partner_notice_sends_staff_read ON public.partner_notice_sends;
CREATE POLICY partner_notice_sends_staff_read ON public.partner_notice_sends
  FOR SELECT TO authenticated USING (private.is_staff());

-- ------------------------------------------------------------ 6. approval
CREATE OR REPLACE FUNCTION public.approve_partner_submission(
  _submission_id uuid,
  _actor uuid,
  _weekly_rate numeric,
  _revenue_split_pct numeric,
  _list_now boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.fleet_owner_submissions%ROWTYPE;
  p_id uuid;
  v_id uuid;
  v_owner uuid;
  v_status text;
BEGIN
  SELECT * INTO s FROM public.fleet_owner_submissions WHERE id = _submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission_not_found'; END IF;
  IF s.listed_vehicle_id IS NOT NULL OR lower(coalesce(s.status, '')) IN ('approved', 'enrolled') THEN
    RAISE EXCEPTION 'submission_already_approved';
  END IF;
  IF _revenue_split_pct IS NULL OR _revenue_split_pct <= 0 OR _revenue_split_pct >= 100 THEN
    RAISE EXCEPTION 'split_out_of_range';
  END IF;
  IF _list_now AND (_weekly_rate IS NULL OR _weekly_rate <= 0) THEN
    RAISE EXCEPTION 'weekly_rate_required';
  END IF;

  -- Partner: the one already linked, else the one with this email, else new.
  p_id := s.partner_id;
  IF p_id IS NULL THEN
    SELECT id INTO p_id FROM public.partners WHERE lower(email) = lower(s.email) LIMIT 1;
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.partners (name, email, phone, partner_type, status, business_name,
      address_line1, address_line2, city, state, postal_code, sms_consent_at, revenue_split_pct)
    VALUES (s.full_name, lower(s.email), s.phone, 'vehicle_owner', 'prospect', s.business_name,
      s.address_line1, s.address_line2, s.city, s.state, s.postal_code, s.sms_consent_at, _revenue_split_pct)
    RETURNING id INTO p_id;
  END IF;

  UPDATE public.partners SET
    status = 'active',
    activated_at = coalesce(activated_at, now()),
    activated_by = coalesce(activated_by, _actor),
    revenue_split_pct = _revenue_split_pct,
    vehicles_contributed = coalesce(vehicles_contributed, 0) + 1,
    updated_at = now()
  WHERE id = p_id;

  -- Vehicle: an existing unowned row with this VIN is linked, never duplicated.
  SELECT id, partner_id INTO v_id, v_owner FROM public.vehicles WHERE upper(vin) = upper(s.vin) LIMIT 1;
  IF v_id IS NOT NULL AND v_owner IS NOT NULL AND v_owner <> p_id THEN
    RAISE EXCEPTION 'vin_belongs_to_another_partner';
  END IF;
  v_status := CASE WHEN _list_now THEN 'available' ELSE 'onboarding' END;
  IF v_id IS NULL THEN
    INSERT INTO public.vehicles (year, make, model, trim, vin, color, license_plate,
      registration_state, title_status, current_odometer, weekly_rate, status, partner_id)
    VALUES (s.year, s.make, s.model, s.trim, upper(s.vin), s.color, nullif(upper(btrim(coalesce(s.license_plate, ''))), ''),
      s.registration_state, s.title_status, s.mileage, _weekly_rate, v_status, p_id)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.vehicles SET partner_id = p_id,
      weekly_rate = coalesce(_weekly_rate, weekly_rate),
      status = CASE WHEN status IN ('rented', 'reserved') THEN status ELSE v_status END
    WHERE id = v_id;
  END IF;

  UPDATE public.fleet_owner_submissions SET
    status = 'approved', partner_id = p_id, listed_vehicle_id = v_id,
    decided_at = now(), decided_by = _actor
  WHERE id = _submission_id;

  -- Any other open submissions from this email now belong to the partner.
  UPDATE public.fleet_owner_submissions SET partner_id = p_id
  WHERE partner_id IS NULL AND lower(email) = lower(s.email);

  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id, summary, metadata)
  VALUES (_actor, 'partner.submission.approved', 'fleet_owner_submission', _submission_id::text,
    'Approved partner vehicle ' || s.year || ' ' || s.make || ' ' || s.model,
    jsonb_build_object('partner_id', p_id, 'vehicle_id', v_id, 'listed', _list_now,
      'weekly_rate', _weekly_rate, 'revenue_split_pct', _revenue_split_pct));

  RETURN jsonb_build_object('partner_id', p_id, 'vehicle_id', v_id, 'status', v_status);
END $$;

REVOKE ALL ON FUNCTION public.approve_partner_submission(uuid, uuid, numeric, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_partner_submission(uuid, uuid, numeric, numeric, boolean) TO service_role;

-- ------------------------------------------------------------ 7. tighten RLS
-- Renter data never reaches a partner directly. The portal's server functions
-- (src/lib/partner-portal.functions.ts) project a fixed whitelist instead.
DROP POLICY IF EXISTS "Partners can view their assigned drivers" ON public.applications;
DROP POLICY IF EXISTS "Partners read rentals on own vehicles" ON public.rentals;
DROP POLICY IF EXISTS "Partners can view their payments" ON public.payments;
DROP POLICY IF EXISTS "Partners read expenses on their vehicles" ON public.vehicle_expenses;
DROP POLICY IF EXISTS "Partners read issues on own vehicles" ON public.issues;
DROP POLICY IF EXISTS "Partners read maintenance on own vehicles" ON public.maintenance_records;
DROP POLICY IF EXISTS "Partners view their visible documents" ON public.documents;
DROP POLICY IF EXISTS "Partners read their driver documents" ON storage.objects;

NOTIFY pgrst, 'reload schema';
