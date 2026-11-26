-- Additional drivers. NOT APPLIED. Do not run this against a hosted database
-- until Dolmar approves it.
--
-- A row is the person the primary renter asked to share the car. Screening,
-- signing, the reservation fee, and the insurance endorsement stay in that
-- order. This table does not approve them, sign anything, or charge Stripe.
--
-- Reads: Managers and Owners (private.is_manager), or the primary renter on
-- their own application or rental. Coordinators and the public get no rows.
-- Writes are service-role only, from staff or token-checked server functions.

CREATE TABLE IF NOT EXISTS public.rental_additional_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  dob date,
  license_number text,
  license_state text,
  license_expiration date,
  license_photo_path text,
  relationship text,
  screening_status text NOT NULL DEFAULT 'pending',
  approved_at timestamptz,
  insurance_added_at timestamptz,
  signed_at timestamptz,
  removed_at timestamptz,
  sms_consent boolean NOT NULL DEFAULT false,
  stripe_subscription_item_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_additional_drivers_anchor_chk CHECK (application_id IS NOT NULL OR rental_id IS NOT NULL),
  CONSTRAINT rental_additional_drivers_status_chk CHECK (screening_status IN ('pending', 'approved', 'declined', 'removed'))
);

CREATE INDEX IF NOT EXISTS rental_additional_drivers_application_idx ON public.rental_additional_drivers (application_id);
CREATE INDEX IF NOT EXISTS rental_additional_drivers_rental_idx ON public.rental_additional_drivers (rental_id);

DROP TRIGGER IF EXISTS rental_additional_drivers_set_updated_at ON public.rental_additional_drivers;
CREATE TRIGGER rental_additional_drivers_set_updated_at
  BEFORE UPDATE ON public.rental_additional_drivers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Same identifier match the primary renter hits. A match refuses the row.
CREATE OR REPLACE FUNCTION public.guard_additional_driver_blacklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  phone text := private.rr_norm_phone(NEW.phone);
  email text := private.rr_norm_email(NEW.email);
  lic text := private.rr_norm_license(NEW.license_number);
  doblast text := private.rr_norm_dob_last(NEW.dob::text, NEW.name);
  today date := (now() AT TIME ZONE 'America/New_York')::date;
  years int;
BEGIN
  IF NEW.removed_at IS NOT NULL OR NEW.screening_status = 'removed' THEN
    RETURN NEW;
  END IF;
  IF NEW.dob IS NOT NULL THEN
    years := date_part('year', age(today, NEW.dob))::int;
    IF years < 23 THEN
      RAISE EXCEPTION 'additional_driver_under_age' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.renter_blacklist_identifiers i
    JOIN public.renter_blacklist b ON b.id = i.blacklist_id AND b.removed_at IS NULL
    WHERE (phone IS NOT NULL AND i.kind = 'phone' AND i.value_norm = phone)
       OR (email IS NOT NULL AND i.kind = 'email' AND i.value_norm = email)
       OR (lic IS NOT NULL AND i.kind = 'license' AND i.value_norm = lic)
       OR (doblast IS NOT NULL AND i.kind = 'dob_last' AND i.value_norm = doblast)
  ) THEN
    RAISE EXCEPTION 'additional_driver_blacklisted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rental_additional_drivers_blacklist ON public.rental_additional_drivers;
CREATE TRIGGER rental_additional_drivers_blacklist
  BEFORE INSERT OR UPDATE ON public.rental_additional_drivers
  FOR EACH ROW EXECUTE FUNCTION public.guard_additional_driver_blacklist();

ALTER TABLE public.rental_additional_drivers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rental_additional_drivers FROM PUBLIC, anon;
GRANT SELECT ON public.rental_additional_drivers TO authenticated;
GRANT ALL ON public.rental_additional_drivers TO service_role;

DROP POLICY IF EXISTS "Managers read additional drivers" ON public.rental_additional_drivers;
CREATE POLICY "Managers read additional drivers"
  ON public.rental_additional_drivers
  FOR SELECT TO authenticated
  USING (private.is_manager());

DROP POLICY IF EXISTS "Renter reads own additional drivers" ON public.rental_additional_drivers;
CREATE POLICY "Renter reads own additional drivers"
  ON public.rental_additional_drivers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = rental_additional_drivers.application_id AND a.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.rentals r
      JOIN public.applications a ON a.id = r.application_id
      WHERE r.id = rental_additional_drivers.rental_id AND a.user_id = auth.uid()
    )
  );
