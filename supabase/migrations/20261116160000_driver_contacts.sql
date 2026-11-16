-- =============================================================================
-- Extra phones and emails on a driver's profile
--
-- applications.phone and applications.email stay the primary contact and stay
-- in sync when staff mark a different row primary. Extra contacts are opt-in
-- for outbound messages (receives_messages defaults to false). Staff only.
-- This migration is not applied by this PR; it ships as a file only.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.normalize_driver_phone(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  d text;
  trimmed text;
BEGIN
  trimmed := trim(coalesce(raw, ''));
  d := regexp_replace(trimmed, '\D', '', 'g');
  IF length(d) = 11 AND left(d, 1) = '1' THEN
    d := substring(d from 2);
  END IF;
  IF length(d) = 10 THEN
    RETURN '+1' || d;
  END IF;
  IF trimmed = '' THEN
    RETURN NULL;
  END IF;
  RETURN trimmed;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_driver_email(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text;
BEGIN
  v := lower(trim(coalesce(raw, '')));
  IF v = '' OR length(v) > 254 OR v !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RETURN NULL;
  END IF;
  RETURN v;
END;
$$;

CREATE TABLE IF NOT EXISTS public.driver_contacts (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('phone', 'email')),
  value text NOT NULL,
  label text CHECK (label IS NULL OR length(label) <= 40),
  is_primary boolean NOT NULL DEFAULT false,
  receives_messages boolean NOT NULL DEFAULT false,
  -- Set when this exact phone texted START, or backfilled from application
  -- SMS consent for the primary / consented number. Staff cannot set this.
  consented_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_contacts_value_present CHECK (length(trim(value)) > 0),
  CONSTRAINT driver_contacts_unique_value UNIQUE (application_id, kind, value)
);

COMMENT ON TABLE public.driver_contacts IS
  'Additional phones and emails on a driver profile. applications.phone/email remain the primary and stay in sync.';

COMMENT ON COLUMN public.driver_contacts.receives_messages IS
  'When true, automated renter emails/texts also go here. Defaults to false for extras. The primary always receives messages regardless.';

COMMENT ON COLUMN public.driver_contacts.consented_at IS
  'Phone only. Evidence that this exact number consented (START, or the application consent phone). Not a staff override.';

CREATE UNIQUE INDEX IF NOT EXISTS driver_contacts_one_primary
  ON public.driver_contacts (application_id, kind)
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS driver_contacts_value_idx
  ON public.driver_contacts (kind, value);

CREATE INDEX IF NOT EXISTS driver_contacts_application_idx
  ON public.driver_contacts (application_id);

-- Backfill primaries from the existing columns before triggers are installed.
INSERT INTO public.driver_contacts (application_id, kind, value, is_primary, receives_messages, consented_at)
SELECT a.id, 'phone', public.normalize_driver_phone(a.phone), true, true,
       CASE
         WHEN a.sms_consent IS TRUE
          AND a.sms_opt_out_at IS NULL
          AND (
            a.sms_consent_phone IS NULL
            OR public.normalize_driver_phone(a.sms_consent_phone) IS NULL
            OR public.normalize_driver_phone(a.sms_consent_phone) = public.normalize_driver_phone(a.phone)
          )
         THEN a.sms_consent_at
         ELSE NULL
       END
  FROM public.applications a
 WHERE a.deleted_at IS NULL
   AND public.normalize_driver_phone(a.phone) IS NOT NULL
ON CONFLICT (application_id, kind, value) DO NOTHING;

INSERT INTO public.driver_contacts (application_id, kind, value, is_primary, receives_messages)
SELECT a.id, 'email', public.normalize_driver_email(a.email), true, true
  FROM public.applications a
 WHERE a.deleted_at IS NULL
   AND public.normalize_driver_email(a.email) IS NOT NULL
ON CONFLICT (application_id, kind, value) DO NOTHING;

CREATE OR REPLACE FUNCTION public.driver_contacts_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.kind = 'phone' THEN
    NEW.value := public.normalize_driver_phone(NEW.value);
    IF NEW.value IS NULL THEN
      RAISE EXCEPTION 'Enter a valid US phone number';
    END IF;
  ELSE
    NEW.value := public.normalize_driver_email(NEW.value);
    IF NEW.value IS NULL THEN
      RAISE EXCEPTION 'Enter a valid email address';
    END IF;
    NEW.consented_at := NULL;
  END IF;
  IF NEW.label IS NOT NULL THEN
    NEW.label := nullif(trim(NEW.label), '');
    IF NEW.label IS NOT NULL AND length(NEW.label) > 40 THEN
      NEW.label := left(NEW.label, 40);
    END IF;
  END IF;
  IF NEW.is_primary THEN
    NEW.receives_messages := true;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_contacts_normalize ON public.driver_contacts;
CREATE TRIGGER driver_contacts_normalize
  BEFORE INSERT OR UPDATE ON public.driver_contacts
  FOR EACH ROW EXECUTE FUNCTION public.driver_contacts_normalize();

-- When a row is marked primary, demote the previous primary of that kind and
-- write the value onto applications.phone / applications.email.
CREATE OR REPLACE FUNCTION public.driver_contacts_apply_primary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_primary IS TRUE THEN
    UPDATE public.driver_contacts
       SET is_primary = false, updated_at = now()
     WHERE application_id = NEW.application_id
       AND kind = NEW.kind
       AND id IS DISTINCT FROM NEW.id
       AND is_primary IS TRUE;
    IF NEW.kind = 'phone' THEN
      UPDATE public.applications
         SET phone = NEW.value, updated_at = now()
       WHERE id = NEW.application_id
         AND phone IS DISTINCT FROM NEW.value;
    ELSE
      UPDATE public.applications
         SET email = NEW.value, updated_at = now()
       WHERE id = NEW.application_id
         AND email IS DISTINCT FROM NEW.value;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_contacts_apply_primary ON public.driver_contacts;
CREATE TRIGGER driver_contacts_apply_primary
  AFTER INSERT OR UPDATE OF is_primary, value ON public.driver_contacts
  FOR EACH ROW
  WHEN (NEW.is_primary IS TRUE)
  EXECUTE FUNCTION public.driver_contacts_apply_primary();

-- When applications.phone or email changes (staff typo fix, new applicant,
-- or a primary flip from the trigger above), keep the primary contact row
-- in sync. If the new value already exists as an extra, that row is promoted
-- and the previous primary is demoted (the old number is kept).
CREATE OR REPLACE FUNCTION public.applications_sync_primary_contacts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  norm text;
  existing_id uuid;
  kind text;
  changed boolean;
BEGIN
  FOREACH kind IN ARRAY ARRAY['phone', 'email'] LOOP
    IF kind = 'phone' THEN
      norm := public.normalize_driver_phone(NEW.phone);
      changed := TG_OP = 'INSERT' OR NEW.phone IS DISTINCT FROM OLD.phone;
    ELSE
      norm := public.normalize_driver_email(NEW.email);
      changed := TG_OP = 'INSERT' OR NEW.email IS DISTINCT FROM OLD.email;
    END IF;
    IF NOT changed OR norm IS NULL THEN
      CONTINUE;
    END IF;

    SELECT c.id INTO existing_id
      FROM public.driver_contacts c
     WHERE c.application_id = NEW.id AND c.kind = kind AND c.value = norm
     LIMIT 1;

    IF existing_id IS NOT NULL THEN
      UPDATE public.driver_contacts
         SET is_primary = true, receives_messages = true, updated_at = now()
       WHERE id = existing_id AND is_primary IS NOT TRUE;
      UPDATE public.driver_contacts
         SET is_primary = false, updated_at = now()
       WHERE application_id = NEW.id AND kind = kind
         AND id IS DISTINCT FROM existing_id AND is_primary IS TRUE;
    ELSE
      UPDATE public.driver_contacts
         SET value = norm, receives_messages = true, updated_at = now()
       WHERE application_id = NEW.id AND kind = kind AND is_primary IS TRUE;
      IF NOT FOUND THEN
        INSERT INTO public.driver_contacts (application_id, kind, value, is_primary, receives_messages)
        VALUES (NEW.id, kind, norm, true, true)
        ON CONFLICT (application_id, kind, value) DO UPDATE
          SET is_primary = true, receives_messages = true, updated_at = now();
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applications_sync_primary_contacts ON public.applications;
CREATE TRIGGER applications_sync_primary_contacts
  AFTER INSERT OR UPDATE OF phone, email ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.applications_sync_primary_contacts();

ALTER TABLE public.driver_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage driver contacts" ON public.driver_contacts;
CREATE POLICY "Staff manage driver contacts" ON public.driver_contacts
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

REVOKE ALL ON public.driver_contacts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_contacts TO service_role;
