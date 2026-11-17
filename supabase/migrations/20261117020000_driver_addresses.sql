-- =============================================================================
-- Extra addresses on a driver's profile (Dolmar, t359u)
--
-- applications.address/city/state/zip stay the primary address and stay in
-- sync when staff mark a different row primary. A Florida license address
-- that differs from the application address is saved as a second row labeled
-- "License address" and never overwrites the primary or a staff-entered
-- value. This migration is not applied by this PR; it ships as a file only.
-- Rollback: proposed/driver-addresses-rollback.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION public.normalize_driver_state(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text;
  names constant jsonb := '{
    "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA",
    "colorado":"CO","connecticut":"CT","delaware":"DE","district of columbia":"DC","florida":"FL",
    "georgia":"GA","hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA",
    "kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD",
    "massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS","missouri":"MO",
    "montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ",
    "new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH",
    "oklahoma":"OK","oregon":"OR","pennsylvania":"PA","puerto rico":"PR","rhode island":"RI",
    "south carolina":"SC","south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT",
    "vermont":"VT","virginia":"VA","washington":"WA","west virginia":"WV","wisconsin":"WI",
    "wyoming":"WY"
  }'::jsonb;
  codes constant text[] := ARRAY[
    'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
    'NY','NC','ND','OH','OK','OR','PA','PR','RI','SC','SD','TN','TX','UT','VT','VA',
    'WA','WV','WI','WY'
  ];
BEGIN
  v := upper(trim(coalesce(raw, '')));
  IF v = '' THEN
    RETURN NULL;
  END IF;
  IF v = ANY (codes) THEN
    RETURN v;
  END IF;
  v := names ->> lower(trim(raw));
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_driver_zip(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  d text;
BEGIN
  d := regexp_replace(coalesce(raw, ''), '\D', '', 'g');
  IF length(d) = 9 THEN
    RETURN left(d, 5) || '-' || right(d, 4);
  END IF;
  IF length(d) = 5 THEN
    RETURN d;
  END IF;
  IF trim(coalesce(raw, '')) = '' THEN
    RETURN NULL;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS public.driver_addresses (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  line1 text NOT NULL DEFAULT '',
  line2 text,
  city text,
  state text,
  zip text,
  label text CHECK (label IS NULL OR length(label) <= 40),
  source text NOT NULL DEFAULT 'staff' CHECK (source IN ('application', 'license_reading', 'staff')),
  is_primary boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_addresses_some_part CHECK (
    length(trim(coalesce(line1, ''))) > 0
    OR length(trim(coalesce(line2, ''))) > 0
    OR length(trim(coalesce(city, ''))) > 0
    OR length(trim(coalesce(state, ''))) > 0
    OR length(trim(coalesce(zip, ''))) > 0
  )
);

COMMENT ON TABLE public.driver_addresses IS
  'Additional addresses on a driver profile. applications.address/city/state/zip remain the primary and stay in sync.';

COMMENT ON COLUMN public.driver_addresses.source IS
  'Where the row came from. license_reading rows may be updated by a later automatic read; staff and application rows are never overwritten by a reading.';

CREATE UNIQUE INDEX IF NOT EXISTS driver_addresses_one_primary
  ON public.driver_addresses (application_id)
  WHERE is_primary;

CREATE UNIQUE INDEX IF NOT EXISTS driver_addresses_unique_normalized
  ON public.driver_addresses (
    application_id,
    lower(regexp_replace(btrim(coalesce(line1, '')), '\s+', ' ', 'g')),
    lower(regexp_replace(btrim(coalesce(city, '')), '\s+', ' ', 'g')),
    coalesce(state, ''),
    coalesce(zip, '')
  );

CREATE INDEX IF NOT EXISTS driver_addresses_application_idx
  ON public.driver_addresses (application_id);

-- Backfill primaries from the existing columns before triggers are installed.
INSERT INTO public.driver_addresses (application_id, line1, city, state, zip, label, source, is_primary)
SELECT a.id,
       coalesce(nullif(trim(a.address), ''), ''),
       nullif(trim(a.city), ''),
       public.normalize_driver_state(a.state),
       public.normalize_driver_zip(a.zip),
       'Application address',
       'application',
       true
  FROM public.applications a
 WHERE a.deleted_at IS NULL
   AND (
     length(trim(coalesce(a.address, ''))) > 0
     OR length(trim(coalesce(a.city, ''))) > 0
     OR length(trim(coalesce(a.state, ''))) > 0
     OR length(trim(coalesce(a.zip, ''))) > 0
   )
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.driver_addresses_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.line1 := btrim(regexp_replace(coalesce(NEW.line1, ''), '\s+', ' ', 'g'));
  NEW.line2 := nullif(btrim(regexp_replace(coalesce(NEW.line2, ''), '\s+', ' ', 'g')), '');
  NEW.city := nullif(btrim(regexp_replace(coalesce(NEW.city, ''), '\s+', ' ', 'g')), '');
  NEW.state := public.normalize_driver_state(NEW.state);
  NEW.zip := public.normalize_driver_zip(NEW.zip);
  IF NEW.label IS NOT NULL THEN
    NEW.label := nullif(trim(NEW.label), '');
    IF NEW.label IS NOT NULL AND length(NEW.label) > 40 THEN
      NEW.label := left(NEW.label, 40);
    END IF;
  END IF;
  IF NEW.source IS NULL OR NEW.source NOT IN ('application', 'license_reading', 'staff') THEN
    NEW.source := 'staff';
  END IF;
  IF length(coalesce(NEW.line1, '')) = 0
     AND NEW.line2 IS NULL
     AND NEW.city IS NULL
     AND NEW.state IS NULL
     AND NEW.zip IS NULL THEN
    RAISE EXCEPTION 'Enter an address';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_addresses_normalize ON public.driver_addresses;
CREATE TRIGGER driver_addresses_normalize
  BEFORE INSERT OR UPDATE ON public.driver_addresses
  FOR EACH ROW EXECUTE FUNCTION public.driver_addresses_normalize();

-- When a row is marked primary, demote the previous primary and write the
-- parts onto applications.address / city / state / zip.
CREATE OR REPLACE FUNCTION public.driver_addresses_apply_primary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_primary IS TRUE THEN
    UPDATE public.driver_addresses
       SET is_primary = false, updated_at = now()
     WHERE application_id = NEW.application_id
       AND id IS DISTINCT FROM NEW.id
       AND is_primary IS TRUE;
    UPDATE public.applications
       SET address = nullif(NEW.line1, ''),
           city = NEW.city,
           state = NEW.state,
           zip = NEW.zip,
           updated_at = now()
     WHERE id = NEW.application_id
       AND (
         address IS DISTINCT FROM nullif(NEW.line1, '')
         OR city IS DISTINCT FROM NEW.city
         OR state IS DISTINCT FROM NEW.state
         OR zip IS DISTINCT FROM NEW.zip
       );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_addresses_apply_primary ON public.driver_addresses;
CREATE TRIGGER driver_addresses_apply_primary
  AFTER INSERT OR UPDATE OF is_primary, line1, line2, city, state, zip ON public.driver_addresses
  FOR EACH ROW
  WHEN (NEW.is_primary IS TRUE)
  EXECUTE FUNCTION public.driver_addresses_apply_primary();

-- When applications address fields change, keep the primary address row in
-- sync. If the new value already exists as an extra, that row is promoted
-- and the previous primary is demoted (the old address is kept).
CREATE OR REPLACE FUNCTION public.applications_sync_primary_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  norm_line text;
  norm_city text;
  norm_state text;
  norm_zip text;
  existing_id uuid;
  changed boolean;
BEGIN
  changed := TG_OP = 'INSERT'
    OR NEW.address IS DISTINCT FROM OLD.address
    OR NEW.city IS DISTINCT FROM OLD.city
    OR NEW.state IS DISTINCT FROM OLD.state
    OR NEW.zip IS DISTINCT FROM OLD.zip;
  IF NOT changed THEN
    RETURN NEW;
  END IF;

  norm_line := btrim(regexp_replace(coalesce(NEW.address, ''), '\s+', ' ', 'g'));
  norm_city := nullif(btrim(regexp_replace(coalesce(NEW.city, ''), '\s+', ' ', 'g')), '');
  norm_state := public.normalize_driver_state(NEW.state);
  norm_zip := public.normalize_driver_zip(NEW.zip);

  IF length(coalesce(norm_line, '')) = 0 AND norm_city IS NULL AND norm_state IS NULL AND norm_zip IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT r.id INTO existing_id
    FROM public.driver_addresses r
   WHERE r.application_id = NEW.id
     AND lower(regexp_replace(btrim(coalesce(r.line1, '')), '\s+', ' ', 'g')) = lower(coalesce(norm_line, ''))
     AND lower(coalesce(r.city, '')) = lower(coalesce(norm_city, ''))
     AND coalesce(r.state, '') = coalesce(norm_state, '')
     AND coalesce(r.zip, '') = coalesce(norm_zip, '')
   LIMIT 1;

  IF existing_id IS NOT NULL THEN
    UPDATE public.driver_addresses
       SET is_primary = true, updated_at = now()
     WHERE id = existing_id AND is_primary IS NOT TRUE;
    UPDATE public.driver_addresses
       SET is_primary = false, updated_at = now()
     WHERE application_id = NEW.id
       AND id IS DISTINCT FROM existing_id
       AND is_primary IS TRUE;
  ELSE
    UPDATE public.driver_addresses
       SET line1 = coalesce(norm_line, ''),
           city = norm_city,
           state = norm_state,
           zip = norm_zip,
           updated_at = now()
     WHERE application_id = NEW.id AND is_primary IS TRUE;
    IF NOT FOUND THEN
      INSERT INTO public.driver_addresses (application_id, line1, city, state, zip, label, source, is_primary)
      VALUES (NEW.id, coalesce(norm_line, ''), norm_city, norm_state, norm_zip, 'Application address', 'application', true);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applications_sync_primary_address ON public.applications;
CREATE TRIGGER applications_sync_primary_address
  AFTER INSERT OR UPDATE OF address, city, state, zip ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.applications_sync_primary_address();

ALTER TABLE public.driver_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage driver addresses" ON public.driver_addresses;
CREATE POLICY "Staff manage driver addresses" ON public.driver_addresses
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

REVOKE ALL ON public.driver_addresses FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_addresses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_addresses TO service_role;

-- Optional address fields on a license reading. Used to save a second
-- "License address" row; never written onto the primary application address.
ALTER TABLE public.fleet_license_readings
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_city text,
  ADD COLUMN IF NOT EXISTS address_state text,
  ADD COLUMN IF NOT EXISTS address_zip text;
