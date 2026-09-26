-- =============================================================================
-- Vehicles as the canonical record for a physical car — Phase 1
--
-- Extends the existing vehicles table rather than introducing a parallel one.
-- Everything a vehicle already touches stays where it is and is aggregated by
-- the profile: documents (with expires_at / is_current / superseded_by),
-- maintenance_records, maintenance_schedules, inspections, condition_media,
-- rentals, vehicle_expenses, vehicle_pl() and audit_log. None of that is
-- duplicated here.
--
-- Additive and idempotent throughout: every column is ADD COLUMN IF NOT
-- EXISTS, every index and policy is guarded. No column is dropped, no data is
-- rewritten, and nothing existing changes meaning.
-- =============================================================================

-- ----------------------------------------------------------- 1. identity

ALTER TABLE public.vehicles
  -- Human-facing fleet ID (RR-001). Distinct from the uuid primary key, which
  -- nobody can read down a phone line to a tow driver.
  ADD COLUMN IF NOT EXISTS unit_number text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_reason text;

-- Case-insensitive and only over live values, so archiving a car does not
-- block reusing nothing and two units cannot differ by casing alone.
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_unit_number_unique_idx
  ON public.vehicles (upper(unit_number))
  WHERE unit_number IS NOT NULL;

COMMENT ON COLUMN public.vehicles.unit_number IS
  'Operator-facing fleet ID such as RR-001. Unique case-insensitively.';
COMMENT ON COLUMN public.vehicles.archived_at IS
  'Set when a vehicle leaves the fleet. Never delete a vehicle with history —
   rentals, documents, inspections, expenses and audit entries must survive.';

/**
 * Suggest the next free unit number for a prefix.
 *
 * Reads the highest existing numeric suffix rather than counting rows, so
 * archived and deleted units do not cause a collision. Returns a suggestion
 * only: the unique index above is what actually guarantees uniqueness, since
 * two operators can call this at the same moment.
 */
CREATE OR REPLACE FUNCTION public.next_unit_number(_prefix text DEFAULT 'RR')
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _prefix || '-' || lpad((
    COALESCE(
      max(
        NULLIF(regexp_replace(upper(unit_number), '^' || upper(_prefix) || '-', ''), '')::int
      ),
      0
    ) + 1
  )::text, 3, '0')
  FROM public.vehicles
  WHERE unit_number ~* ('^' || _prefix || '-[0-9]+$')
$$;

REVOKE ALL ON FUNCTION public.next_unit_number(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_unit_number(text) TO authenticated, service_role;

-- ---------------------------------------------------------- 2. ownership
--
-- The money-bearing columns here are readable only where the vehicles table
-- already allows it. Vehicles are staff-readable and manager-writable, so
-- purchase price and payoff are visible to a Coordinator through this table.
-- Phase 2 moves the financing detail behind a manager-only view; it is called
-- out rather than left implied.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS ownership_type text
    CHECK (ownership_type IS NULL OR ownership_type IN ('owned','financed','leased','partner')),
  ADD COLUMN IF NOT EXISTS legal_owner text,
  ADD COLUMN IF NOT EXISTS seller_dealer text,
  ADD COLUMN IF NOT EXISTS loan_reference text,
  ADD COLUMN IF NOT EXISTS payoff_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS monthly_payment numeric(10,2),
  ADD COLUMN IF NOT EXISTS loan_maturity_date date;

-- ------------------------------------------------- 3. DMV and insurance gaps

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS insurance_coverage text,
  ADD COLUMN IF NOT EXISTS insurance_agent_name text,
  ADD COLUMN IF NOT EXISTS insurance_agent_phone text,
  ADD COLUMN IF NOT EXISTS insurance_agent_email text,
  ADD COLUMN IF NOT EXISTS insurance_status text;

-- -------------------------------------------------------- 4. GPS/telematics
--
-- Provider-neutral on purpose: a provider name plus the identifiers every
-- tracker has, and last-known readings the app can store when a future
-- adapter reports them. No provider-specific column, no invented location.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS gps_serial text,
  ADD COLUMN IF NOT EXISTS gps_imei text,
  ADD COLUMN IF NOT EXISTS gps_sim text,
  ADD COLUMN IF NOT EXISTS gps_status text
    CHECK (gps_status IS NULL OR gps_status IN ('active','inactive','fault','removed','not_installed')),
  ADD COLUMN IF NOT EXISTS gps_last_ping_at timestamptz,
  -- {lat, lng, accuracy_m, address} as reported. jsonb so a future adapter can
  -- carry provider extras without another migration.
  ADD COLUMN IF NOT EXISTS gps_last_location jsonb,
  ADD COLUMN IF NOT EXISTS gps_odometer integer,
  ADD COLUMN IF NOT EXISTS gps_battery text,
  ADD COLUMN IF NOT EXISTS gps_geofence_status text,
  ADD COLUMN IF NOT EXISTS gps_install_notes text,
  ADD COLUMN IF NOT EXISTS gps_tracking_url text;

COMMENT ON COLUMN public.vehicles.gps_last_location IS
  'Last position as reported by a provider adapter. Never populated by the app
   itself — an empty value means nothing has reported, not that the car is
   stationary.';

-- -------------------------------------------------------------- 5. keys

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS spare_key boolean,
  ADD COLUMN IF NOT EXISTS key_type text,
  ADD COLUMN IF NOT EXISTS key_tag text,
  ADD COLUMN IF NOT EXISTS key_location text,
  ADD COLUMN IF NOT EXISTS key_notes text;

-- ------------------------------------------------------- 6. body type widened
--
-- Was constrained to sedan/suv/xl, which cannot describe a real fleet and
-- would reject a truck or minivan outright. Widening a CHECK accepts
-- everything the old one did, so no existing row can be invalidated.

ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_body_type_check;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_body_type_check
  CHECK (body_type IS NULL OR body_type IN (
    'sedan','suv','xl','truck','van','minivan','coupe','hatchback','wagon','convertible','other'
  ));

-- ------------------------------------------------------------- 7. photos
--
-- Three asset classes that must never be confused:
--
--   original      what the camera saw. Permanent, never modified.
--   ai_enhanced   a derivative for listings. Always points at its original.
--   inspection    condition evidence — lives in condition_media, NOT here,
--                 and is deliberately out of reach of any enhancement path.
--
-- vehicles.photos (text[]) stays as it is and keeps feeding the public site;
-- this table is the richer record, and Phase 3 reconciles the two.

CREATE TABLE IF NOT EXISTS public.vehicle_media (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('original','ai_enhanced')),
  storage_bucket text NOT NULL DEFAULT 'vehicle-photos',
  storage_path text NOT NULL,
  file_name text,
  mime_type text,
  size_bytes bigint,
  -- An enhanced image must always be traceable to the frame it came from.
  derived_from_id uuid REFERENCES public.vehicle_media(id) ON DELETE SET NULL,
  enhancement_mode text
    CHECK (enhancement_mode IS NULL OR enhancement_mode IN ('clean_background','studio','outdoor','dealer_listing')),
  enhancement_provider text,
  is_primary boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  caption text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- An enhanced image without an original is unattributable, and an original
-- must never carry enhancement metadata.
ALTER TABLE public.vehicle_media DROP CONSTRAINT IF EXISTS vehicle_media_derivation_check;
ALTER TABLE public.vehicle_media ADD CONSTRAINT vehicle_media_derivation_check
  CHECK (
    (kind = 'ai_enhanced' AND derived_from_id IS NOT NULL AND enhancement_mode IS NOT NULL)
    OR
    (kind = 'original' AND derived_from_id IS NULL AND enhancement_mode IS NULL)
  );

CREATE INDEX IF NOT EXISTS vehicle_media_vehicle_idx ON public.vehicle_media (vehicle_id, kind, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_media_one_primary_idx
  ON public.vehicle_media (vehicle_id) WHERE is_primary;

COMMENT ON TABLE public.vehicle_media IS
  'Vehicle photography. Originals are permanent and never altered; enhanced
   images are separate rows pointing at the original they came from.
   Inspection evidence is NOT stored here — it stays in condition_media, out
   of reach of any enhancement path.';

ALTER TABLE public.vehicle_media ENABLE ROW LEVEL SECURITY;

-- Photography is operational, not financial: a Coordinator preparing listings
-- is doing their job.
DROP POLICY IF EXISTS "Staff manage vehicle media" ON public.vehicle_media;
CREATE POLICY "Staff manage vehicle media" ON public.vehicle_media
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS "Partners read media on their vehicles" ON public.vehicle_media;
CREATE POLICY "Partners read media on their vehicles" ON public.vehicle_media
  FOR SELECT TO authenticated USING (private.partner_owns_vehicle(vehicle_id));

-- Spelled out rather than inherited from Supabase's default privileges; a
-- missing grant under a correct policy is how applicant uploads broke for two
-- months and how the audit log lost a layer.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_media TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_media TO service_role;

-- ------------------------------------------- 8. duplicate identity safeguards
--
-- VIN and plate already have case-insensitive partial unique indexes from the
-- fleet-ops migration. Asserted here rather than assumed, because bulk import
-- in Phase 3 depends on them to reject duplicates.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='vehicles_vin_unique_idx') THEN
    CREATE UNIQUE INDEX vehicles_vin_unique_idx ON public.vehicles (upper(vin)) WHERE vin IS NOT NULL;
    RAISE NOTICE 'Recreated vehicles_vin_unique_idx.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='vehicles_plate_unique_idx') THEN
    CREATE UNIQUE INDEX vehicles_plate_unique_idx ON public.vehicles (upper(license_plate)) WHERE license_plate IS NOT NULL;
    RAISE NOTICE 'Recreated vehicles_plate_unique_idx.';
  END IF;
END $$;

-- Finding a car by the last four of the VIN is how people actually search.
CREATE INDEX IF NOT EXISTS vehicles_vin_last4_idx ON public.vehicles (right(upper(vin), 4)) WHERE vin IS NOT NULL;
