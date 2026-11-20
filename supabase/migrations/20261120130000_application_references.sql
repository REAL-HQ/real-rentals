-- Application references and emergency contact, included in blacklist matching.
--
-- Requested by Dolmar Nov 20 2026 (6:21 AM ET, via FLEET): add reference and
-- emergency-contact fields to the application, and treat it as a blacklist match when
-- an applicant lists a blacklisted person (by name or phone) as a reference or
-- emergency contact, or when their reference / emergency contact phone is a
-- blacklisted person's phone. Like every other match: flagged needs_staff
-- ("blacklist match: ..."), never auto-approved, never auto-declined; approval and
-- renting stay blocked until an Owner / Admin clears it.
--
-- All six fields are optional. Depends on 20261120040000_renter_blacklist.sql.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS reference_name text,
  ADD COLUMN IF NOT EXISTS reference_phone text,
  ADD COLUMN IF NOT EXISTS reference_relationship text,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship text;

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_contact_people_lengths;
ALTER TABLE public.applications ADD CONSTRAINT applications_contact_people_lengths CHECK (
  coalesce(length(reference_name), 0) <= 120 AND coalesce(length(reference_phone), 0) <= 40
  AND coalesce(length(reference_relationship), 0) <= 60
  AND coalesce(length(emergency_contact_name), 0) <= 120 AND coalesce(length(emergency_contact_phone), 0) <= 40
  AND coalesce(length(emergency_contact_relationship), 0) <= 60
) NOT VALID;

-- "Heather A. Bell Jr" -> "heather a bell". Needs a first and a last name.
CREATE OR REPLACE FUNCTION private.rr_norm_person_name(_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE toks text[]; i int;
BEGIN
  toks := array_remove(string_to_array(btrim(regexp_replace(lower(coalesce(_name, '')), '[^a-z ]+', ' ', 'g')), ' '), '');
  i := coalesce(array_length(toks, 1), 0);
  WHILE i > 0 AND toks[i] IN ('jr', 'sr', 'ii', 'iii', 'iv') LOOP i := i - 1; END LOOP;
  IF i < 2 THEN RETURN NULL; END IF;
  RETURN array_to_string(toks[1:i], ' ');
END $$;

-- The applicant's reference / emergency contact is a blacklisted person (name or phone).
CREATE OR REPLACE FUNCTION private.blacklist_reference_hits(_app uuid)
RETURNS TABLE (blacklist_id uuid, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH p AS (
    SELECT 'reference'::text AS who, private.rr_norm_phone(a.reference_phone) AS phone, private.rr_norm_person_name(a.reference_name) AS name
    FROM public.applications a WHERE a.id = _app
    UNION ALL
    SELECT 'emergency', private.rr_norm_phone(a.emergency_contact_phone), private.rr_norm_person_name(a.emergency_contact_name)
    FROM public.applications a WHERE a.id = _app
  )
  SELECT i.blacklist_id, p.who || '_phone'
  FROM p
  JOIN public.renter_blacklist_identifiers i ON i.kind = 'phone' AND i.value_norm = p.phone
  JOIN public.renter_blacklist b ON b.id = i.blacklist_id AND b.removed_at IS NULL
  WHERE p.phone IS NOT NULL
  UNION
  SELECT b.id, p.who || '_name'
  FROM p
  JOIN public.renter_blacklist b ON b.removed_at IS NULL AND private.rr_norm_person_name(b.full_name) = p.name
  WHERE p.name IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION private.blacklist_matches(_app uuid)
RETURNS TABLE (blacklist_id uuid, kinds text[], cleared boolean, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT h.blacklist_id, array_agg(DISTINCT h.kind ORDER BY h.kind),
         EXISTS (SELECT 1 FROM public.renter_blacklist_clearances c WHERE c.application_id = _app AND c.blacklist_id = h.blacklist_id),
         (SELECT b.full_name FROM public.renter_blacklist b WHERE b.id = h.blacklist_id)
  FROM (
    SELECT hh.blacklist_id, hh.kind
    FROM private.rr_application_identifiers(_app) a
    CROSS JOIN LATERAL private.blacklist_identifier_hits(a.kind, a.value_norm) hh
    UNION ALL
    SELECT r.blacklist_id, r.kind FROM private.blacklist_reference_hits(_app) r
  ) h
  WHERE NOT EXISTS (SELECT 1 FROM public.renter_blacklist b WHERE b.id = h.blacklist_id AND b.application_id = _app)
  GROUP BY h.blacklist_id
$$;

CREATE OR REPLACE FUNCTION private.blacklist_kind_labels(_kinds text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(CASE k WHEN 'phone' THEN 'Phone' WHEN 'email' THEN 'Email' WHEN 'license' THEN 'License Number'
    WHEN 'address' THEN 'Address' WHEN 'address_base' THEN 'Same Building' WHEN 'address_similar' THEN 'Similar Address'
    WHEN 'dob_last' THEN 'DOB + Last Name' WHEN 'card' THEN 'Saved Card' WHEN 'ip' THEN 'Signer IP'
    WHEN 'reference_phone' THEN 'Reference Phone' WHEN 'reference_name' THEN 'Reference Name'
    WHEN 'emergency_phone' THEN 'Emergency Contact Phone' WHEN 'emergency_name' THEN 'Emergency Contact Name'
    ELSE k END, ', ' ORDER BY k)
  FROM unnest(_kinds) k
$$;

-- Blacklisting someone re-checks everyone on file, now including references.
CREATE OR REPLACE FUNCTION private.renter_blacklist_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF NEW.application_id IS NOT NULL THEN
    INSERT INTO public.renter_blacklist_identifiers (blacklist_id, kind, value_norm)
    SELECT NEW.id, x.kind, x.value_norm FROM private.rr_application_identifiers(NEW.application_id) x
    ON CONFLICT DO NOTHING;
  END IF;
  FOR r IN
    SELECT DISTINCT a.id FROM public.applications a
    WHERE a.deleted_at IS NULL AND a.id IS DISTINCT FROM NEW.application_id
      AND coalesce(a.status, '') NOT IN ('declined', 'closed')
      AND EXISTS (SELECT 1 FROM private.blacklist_matches(a.id) m WHERE m.blacklist_id = NEW.id)
  LOOP
    PERFORM private.flag_blacklist_match(r.id);
  END LOOP;
  FOR r IN SELECT w.id, w.phone, w.email FROM public.waitlist w WHERE coalesce(w.status, '') NOT IN ('promoted', 'removed') LOOP
    PERFORM private.flag_blacklist_contact('waitlist', r.id, r.phone, r.email);
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION private.refresh_blacklist_identifiers(_app uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; n int; r record;
BEGIN
  FOR b IN SELECT id FROM public.renter_blacklist WHERE application_id = _app AND removed_at IS NULL LOOP
    INSERT INTO public.renter_blacklist_identifiers (blacklist_id, kind, value_norm)
    SELECT b.id, x.kind, x.value_norm FROM private.rr_application_identifiers(_app) x
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      FOR r IN
        SELECT a.id FROM public.applications a
        WHERE a.deleted_at IS NULL AND a.id <> _app AND coalesce(a.status, '') NOT IN ('declined', 'closed')
          AND EXISTS (SELECT 1 FROM private.blacklist_matches(a.id) m WHERE m.blacklist_id = b.id)
      LOOP
        PERFORM private.flag_blacklist_match(r.id);
      END LOOP;
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS applications_blacklist_match ON public.applications;
CREATE TRIGGER applications_blacklist_match
  AFTER INSERT OR UPDATE OF phone, email, license_number, address, zip, dob, full_name,
    card_brand, card_last4, card_exp_month, card_exp_year,
    reference_name, reference_phone, emergency_contact_name, emergency_contact_phone ON public.applications
  FOR EACH ROW EXECUTE FUNCTION private.applications_blacklist_match_trg();

REVOKE ALL ON FUNCTION private.blacklist_reference_hits(uuid), private.rr_norm_person_name(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.blacklist_reference_hits(uuid), private.rr_norm_person_name(text) TO service_role;

-- Rollback: re-run the function / trigger definitions from 20261120040000_renter_blacklist.sql,
-- then (optional; loses what applicants typed):
-- ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_contact_people_lengths,
--   DROP COLUMN IF EXISTS reference_name, DROP COLUMN IF EXISTS reference_phone, DROP COLUMN IF EXISTS reference_relationship,
--   DROP COLUMN IF EXISTS emergency_contact_name, DROP COLUMN IF EXISTS emergency_contact_phone,
--   DROP COLUMN IF EXISTS emergency_contact_relationship;
