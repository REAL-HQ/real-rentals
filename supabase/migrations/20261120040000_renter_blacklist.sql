-- Renter Blacklist, warnings (strikes) and blacklist matching on new applications.
-- DO NOT apply to production until Dolmar approves (requested Nov 19 2026, 10:50 PM ET).
--
-- 1. renter_blacklist            one row per blacklisting; removal is recorded on the row
--                                (who / when / why), never deleted, so history is kept.
--                                Re-blacklisting later is a new row. One active row per application.
-- 2. renter_blacklist_identifiers normalized phone / email / licence / address snapshot taken
--                                when the person is blacklisted (application + driver_contacts +
--                                driver_addresses). Service role only. Survives a later profile
--                                edit or deletion of the application.
-- 3. renter_strikes              two-strike warnings: Late Payment (2 within 60 days), Smoking,
--                                Returned Car Dirty. A two-strike blacklist reason is refused
--                                until the second live strike exists.
-- 4. renter_blacklist_clearances an Owner's "not the same person" decision for a match.
-- 5. Triggers (server-side guarantee, whatever path the app takes):
--      a. applications INSERT / identifier UPDATE -> if it matches an active blacklist entry,
--         open (or extend) a needs_staff row in fleet_review_decisions with reason
--         'matches blacklisted renter' and code 'blacklist_match'. Never approves anything.
--      b. applications status -> approved/active is refused for a blacklisted application or one
--         with an uncleared match (covers staff Approve, FLEET approve, the approval RPC and
--         activate_rental_tx).
--      c. rentals INSERT, or status change into reserved/active, is refused the same way
--         (covers Reserve, Resume From On Hold, Activate, the pickup checklist).
-- Normalizers mirror src/lib/blacklist.ts exactly (scripts/renter-blacklist-postgres.test.mjs).
-- RLS: staff read; only an Owner (private.is_owner) may insert or update. No DELETE grant.

-- ------------------------------------------------------------- normalizers
CREATE OR REPLACE FUNCTION private.rr_norm_phone(_v text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text := regexp_replace(coalesce(_v, ''), '\D', '', 'g');
BEGIN
  IF length(d) = 11 AND left(d, 1) = '1' THEN d := substr(d, 2); END IF;
  RETURN CASE WHEN length(d) >= 10 THEN d END;
END $$;

CREATE OR REPLACE FUNCTION private.rr_norm_email(_v text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE e text := lower(btrim(coalesce(_v, '')));
BEGIN
  RETURN CASE WHEN e ~ '^[^\s@]+@[^\s@]+$' THEN e END;
END $$;

CREATE OR REPLACE FUNCTION private.rr_norm_license(_v text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE l text := regexp_replace(upper(coalesce(_v, '')), '[^A-Z0-9]', '', 'g');
BEGIN
  RETURN CASE WHEN length(l) >= 4 THEN l END;
END $$;

CREATE OR REPLACE FUNCTION private.rr_last_zip5(_v text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce((
    SELECT left(m[1], 5) FROM (
      SELECT m, row_number() OVER () AS n
      FROM regexp_matches(coalesce(_v, ''), '\m(\d{5}(?:-\d{4})?)\M', 'g') AS m
    ) x ORDER BY n DESC LIMIT 1
  ), '')
$$;

CREATE OR REPLACE FUNCTION private.rr_norm_address(_address text, _zip text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  full_text text := coalesce(_address, '');
  s text;
  toks text[];
  t text;
  mapped text[] := '{}';
  street text;
  z text;
BEGIN
  s := lower(split_part(full_text, ',', 1));
  s := replace(s, '#', ' apt ');
  s := btrim(regexp_replace(s, '[^a-z0-9]+', ' ', 'g'));
  IF s = '' THEN RETURN NULL; END IF;
  toks := string_to_array(s, ' ');
  FOREACH t IN ARRAY toks LOOP
    mapped := mapped || CASE t
      WHEN 'street' THEN 'st' WHEN 'str' THEN 'st' WHEN 'avenue' THEN 'ave' WHEN 'av' THEN 'ave'
      WHEN 'road' THEN 'rd' WHEN 'drive' THEN 'dr' WHEN 'boulevard' THEN 'blvd' WHEN 'blv' THEN 'blvd'
      WHEN 'lane' THEN 'ln' WHEN 'court' THEN 'ct' WHEN 'circle' THEN 'cir' WHEN 'place' THEN 'pl'
      WHEN 'parkway' THEN 'pkwy' WHEN 'highway' THEN 'hwy' WHEN 'terrace' THEN 'ter' WHEN 'trail' THEN 'trl'
      WHEN 'square' THEN 'sq' WHEN 'north' THEN 'n' WHEN 'south' THEN 's' WHEN 'east' THEN 'e'
      WHEN 'west' THEN 'w' WHEN 'northeast' THEN 'ne' WHEN 'northwest' THEN 'nw' WHEN 'southeast' THEN 'se'
      WHEN 'southwest' THEN 'sw' WHEN 'apartment' THEN 'apt' WHEN 'unit' THEN 'apt' WHEN 'suite' THEN 'ste'
      WHEN 'number' THEN 'apt' WHEN 'no' THEN 'apt'
      ELSE t END;
  END LOOP;
  street := array_to_string(mapped, ' ');
  IF street !~ '^[0-9]' OR coalesce(array_length(mapped, 1), 0) < 2 THEN RETURN NULL; END IF;
  z := private.rr_last_zip5(_zip);
  IF z = '' AND position(',' in full_text) > 0 THEN
    z := private.rr_last_zip5(substr(full_text, position(',' in full_text) + 1));
  END IF;
  RETURN street || '|' || z;
END $$;

-- Every normalized identifier we hold for one application.
CREATE OR REPLACE FUNCTION private.rr_application_identifiers(_app uuid)
RETURNS TABLE (kind text, value_norm text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT x.kind, x.v FROM (
    SELECT 'phone'::text AS kind, private.rr_norm_phone(a.phone) AS v FROM public.applications a WHERE a.id = _app
    UNION ALL SELECT 'email', private.rr_norm_email(a.email) FROM public.applications a WHERE a.id = _app
    UNION ALL SELECT 'license', private.rr_norm_license(a.license_number) FROM public.applications a WHERE a.id = _app
    UNION ALL SELECT 'address', private.rr_norm_address(a.address, a.zip) FROM public.applications a WHERE a.id = _app
    UNION ALL SELECT 'phone', private.rr_norm_phone(c.value) FROM public.driver_contacts c WHERE c.application_id = _app AND c.kind = 'phone'
    UNION ALL SELECT 'email', private.rr_norm_email(c.value) FROM public.driver_contacts c WHERE c.application_id = _app AND c.kind = 'email'
    UNION ALL SELECT 'address', private.rr_norm_address(d.line1, d.zip) FROM public.driver_addresses d WHERE d.application_id = _app
  ) x WHERE x.v IS NOT NULL
$$;

-- ------------------------------------------------------------------ tables
CREATE TABLE IF NOT EXISTS public.renter_blacklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  full_name text,
  reason_code text NOT NULL CHECK (reason_code IN (
    'vehicle_repossessed', 'unpaid_balance', 'gps_tamper', 'unauthorized_driver', 'left_service_area',
    'application_fraud', 'chargeback', 'serious_damage_contraband', 'threats_crime',
    'late_payment_second_strike', 'smoking_second_strike', 'dirty_return_second_strike')),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 5 AND 2000),
  blacklisted_on date NOT NULL,
  added_by uuid,
  added_by_label text NOT NULL CHECK (length(btrim(added_by_label)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid,
  removed_by_label text,
  removal_reason text,
  CONSTRAINT renter_blacklist_removal_complete CHECK (
    (removed_at IS NULL AND removal_reason IS NULL AND removed_by_label IS NULL)
    OR (removed_at IS NOT NULL AND length(btrim(coalesce(removal_reason, ''))) >= 5
        AND length(btrim(coalesce(removed_by_label, ''))) > 0))
);
COMMENT ON TABLE public.renter_blacklist IS
  'Blacklisted renters. Never deleted: removal is recorded on the row. Owner-only writes. Refused approvals and rentals are enforced by triggers.';
CREATE UNIQUE INDEX IF NOT EXISTS renter_blacklist_one_active_per_application
  ON public.renter_blacklist (application_id) WHERE removed_at IS NULL AND application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS renter_blacklist_active_idx ON public.renter_blacklist (created_at DESC) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.renter_blacklist_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blacklist_id uuid NOT NULL REFERENCES public.renter_blacklist(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('phone', 'email', 'license', 'address')),
  value_norm text NOT NULL,
  UNIQUE (blacklist_id, kind, value_norm)
);
CREATE INDEX IF NOT EXISTS renter_blacklist_identifiers_lookup ON public.renter_blacklist_identifiers (kind, value_norm);

CREATE TABLE IF NOT EXISTS public.renter_strikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('late_payment', 'smoking', 'dirty_return')),
  occurred_on date NOT NULL,
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 5 AND 2000),
  added_by uuid,
  added_by_label text NOT NULL CHECK (length(btrim(added_by_label)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid,
  voided_by_label text,
  void_reason text,
  CONSTRAINT renter_strikes_void_complete CHECK (
    (voided_at IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND length(btrim(coalesce(void_reason, ''))) >= 5))
);
CREATE INDEX IF NOT EXISTS renter_strikes_application_idx ON public.renter_strikes (application_id, kind, occurred_on);

CREATE TABLE IF NOT EXISTS public.renter_blacklist_clearances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  blacklist_id uuid NOT NULL REFERENCES public.renter_blacklist(id) ON DELETE CASCADE,
  cleared_by uuid,
  cleared_by_label text NOT NULL CHECK (length(btrim(cleared_by_label)) > 0),
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, blacklist_id)
);

-- --------------------------------------------------------------------- RLS
ALTER TABLE public.renter_blacklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renter_blacklist_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renter_strikes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renter_blacklist_clearances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renter_blacklist, public.renter_blacklist_identifiers, public.renter_strikes,
  public.renter_blacklist_clearances FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.renter_blacklist, public.renter_strikes, public.renter_blacklist_clearances TO authenticated;
GRANT ALL ON public.renter_blacklist, public.renter_blacklist_identifiers, public.renter_strikes,
  public.renter_blacklist_clearances TO service_role;

DROP POLICY IF EXISTS "Staff read blacklist" ON public.renter_blacklist;
CREATE POLICY "Staff read blacklist" ON public.renter_blacklist FOR SELECT TO authenticated USING (private.is_staff());
DROP POLICY IF EXISTS "Owner adds to blacklist" ON public.renter_blacklist;
CREATE POLICY "Owner adds to blacklist" ON public.renter_blacklist FOR INSERT TO authenticated WITH CHECK (private.is_owner());
DROP POLICY IF EXISTS "Owner removes from blacklist" ON public.renter_blacklist;
CREATE POLICY "Owner removes from blacklist" ON public.renter_blacklist FOR UPDATE TO authenticated
  USING (private.is_owner()) WITH CHECK (private.is_owner());

DROP POLICY IF EXISTS "Staff read strikes" ON public.renter_strikes;
CREATE POLICY "Staff read strikes" ON public.renter_strikes FOR SELECT TO authenticated USING (private.is_staff());
DROP POLICY IF EXISTS "Staff log strikes" ON public.renter_strikes;
CREATE POLICY "Staff log strikes" ON public.renter_strikes FOR INSERT TO authenticated WITH CHECK (private.is_staff());
DROP POLICY IF EXISTS "Owner voids strikes" ON public.renter_strikes;
CREATE POLICY "Owner voids strikes" ON public.renter_strikes FOR UPDATE TO authenticated
  USING (private.is_owner()) WITH CHECK (private.is_owner());

DROP POLICY IF EXISTS "Staff read clearances" ON public.renter_blacklist_clearances;
CREATE POLICY "Staff read clearances" ON public.renter_blacklist_clearances FOR SELECT TO authenticated USING (private.is_staff());
DROP POLICY IF EXISTS "Owner clears matches" ON public.renter_blacklist_clearances;
CREATE POLICY "Owner clears matches" ON public.renter_blacklist_clearances FOR INSERT TO authenticated WITH CHECK (private.is_owner());
-- renter_blacklist_identifiers: no policy at all (service role and SECURITY DEFINER functions only).

-- ------------------------------------------------------------ history guard
-- Only the removal fields may change, once. Nothing is deleted.
CREATE OR REPLACE FUNCTION private.renter_blacklist_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'renter_blacklist_history: blacklist entries are never deleted; record a removal instead';
  END IF;
  IF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'renter_blacklist_history: this entry was already removed; add a new entry instead';
  END IF;
  IF (NEW.application_id IS DISTINCT FROM OLD.application_id AND NEW.application_id IS NOT NULL)
     OR NEW.reason_code IS DISTINCT FROM OLD.reason_code OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.blacklisted_on IS DISTINCT FROM OLD.blacklisted_on OR NEW.added_by IS DISTINCT FROM OLD.added_by
     OR NEW.added_by_label IS DISTINCT FROM OLD.added_by_label OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    RAISE EXCEPTION 'renter_blacklist_history: only the removal (who, when, why) can be recorded on an entry';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS renter_blacklist_guard ON public.renter_blacklist;
CREATE TRIGGER renter_blacklist_guard BEFORE UPDATE OR DELETE ON public.renter_blacklist
  FOR EACH ROW EXECUTE FUNCTION private.renter_blacklist_guard();

CREATE OR REPLACE FUNCTION private.renter_strikes_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'renter_strikes_history: strikes are never deleted; void it instead'; END IF;
  IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'renter_strikes_history: this strike is already voided'; END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.occurred_on IS DISTINCT FROM OLD.occurred_on OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.added_by IS DISTINCT FROM OLD.added_by OR NEW.added_by_label IS DISTINCT FROM OLD.added_by_label
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.application_id IS DISTINCT FROM OLD.application_id AND NEW.application_id IS NOT NULL) THEN
    RAISE EXCEPTION 'renter_strikes_history: only a void (who, when, why) can be recorded on a strike';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS renter_strikes_guard ON public.renter_strikes;
CREATE TRIGGER renter_strikes_guard BEFORE UPDATE OR DELETE ON public.renter_strikes
  FOR EACH ROW EXECUTE FUNCTION private.renter_strikes_guard();

-- ------------------------------------------------------------- two strikes
CREATE OR REPLACE FUNCTION private.renter_second_strike_reached(_app uuid, _kind text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _kind = 'late_payment' THEN EXISTS (
      SELECT 1 FROM public.renter_strikes a JOIN public.renter_strikes b
        ON b.application_id = a.application_id AND b.kind = a.kind AND b.id <> a.id
       AND b.occurred_on >= a.occurred_on AND b.occurred_on - a.occurred_on <= 60
      WHERE a.application_id = _app AND a.kind = _kind AND a.voided_at IS NULL AND b.voided_at IS NULL)
    ELSE (SELECT count(*) >= 2 FROM public.renter_strikes s
          WHERE s.application_id = _app AND s.kind = _kind AND s.voided_at IS NULL) END
$$;

-- ------------------------------------------------------------------ matching
CREATE OR REPLACE FUNCTION private.blacklist_matches(_app uuid)
RETURNS TABLE (blacklist_id uuid, kinds text[], cleared boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, array_agg(DISTINCT i.kind ORDER BY i.kind),
         EXISTS (SELECT 1 FROM public.renter_blacklist_clearances c WHERE c.application_id = _app AND c.blacklist_id = b.id)
  FROM private.rr_application_identifiers(_app) a
  JOIN public.renter_blacklist_identifiers i ON i.kind = a.kind AND i.value_norm = a.value_norm
  JOIN public.renter_blacklist b ON b.id = i.blacklist_id AND b.removed_at IS NULL
  WHERE b.application_id IS DISTINCT FROM _app
  GROUP BY b.id
$$;

CREATE OR REPLACE FUNCTION private.is_blacklisted_application(_app uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _app IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.renter_blacklist b WHERE b.application_id = _app AND b.removed_at IS NULL)
$$;

-- Open (or extend) a needs_staff flag when an application matches. Never approves.
CREATE OR REPLACE FUNCTION private.flag_blacklist_match(_app uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ids uuid[];
  kinds text[];
  open_id uuid;
  detail jsonb;
BEGIN
  IF _app IS NULL OR private.is_blacklisted_application(_app) THEN RETURN false; END IF;
  SELECT array_agg(m.blacklist_id ORDER BY m.blacklist_id),
         (SELECT array_agg(DISTINCT k ORDER BY k) FROM private.blacklist_matches(_app) mm, unnest(mm.kinds) k WHERE NOT mm.cleared)
    INTO ids, kinds
  FROM private.blacklist_matches(_app) m WHERE NOT m.cleared;
  IF ids IS NULL THEN RETURN false; END IF;
  IF to_regclass('public.fleet_review_decisions') IS NULL THEN RETURN true; END IF;
  detail := jsonb_build_object('blacklist_ids', to_jsonb(ids), 'matched', to_jsonb(kinds), 'at', now());
  EXECUTE $q$SELECT id FROM public.fleet_review_decisions
             WHERE application_id = $1 AND decision = 'needs_staff' AND resolved_at IS NULL LIMIT 1 FOR UPDATE$q$
    INTO open_id USING _app;
  IF open_id IS NULL THEN
    EXECUTE $q$INSERT INTO public.fleet_review_decisions (application_id, decision, reason, escalation_codes, assessment, decided_by)
               VALUES ($1, 'needs_staff', 'matches blacklisted renter', ARRAY['blacklist_match'],
                       jsonb_build_object('blacklist_match', $2::jsonb), 'Blacklist Check (automated)')$q$
      USING _app, detail;
  ELSE
    EXECUTE $q$UPDATE public.fleet_review_decisions
               SET escalation_codes = CASE WHEN 'blacklist_match' = ANY(escalation_codes) THEN escalation_codes
                                           ELSE array_append(escalation_codes, 'blacklist_match') END,
                   reason = CASE WHEN reason ILIKE '%matches blacklisted renter%' THEN reason
                                 ELSE left('matches blacklisted renter; ' || reason, 1000) END,
                   assessment = coalesce(assessment, '{}'::jsonb) || jsonb_build_object('blacklist_match', $2::jsonb)
               WHERE id = $1$q$
      USING open_id, detail;
  END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION private.applications_blacklist_match_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.deleted_at IS NULL THEN PERFORM private.flag_blacklist_match(NEW.id); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS applications_blacklist_match ON public.applications;
CREATE TRIGGER applications_blacklist_match
  AFTER INSERT OR UPDATE OF phone, email, license_number, address, zip ON public.applications
  FOR EACH ROW EXECUTE FUNCTION private.applications_blacklist_match_trg();

CREATE OR REPLACE FUNCTION private.contacts_blacklist_match_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM private.flag_blacklist_match(NEW.application_id);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS driver_contacts_blacklist_match ON public.driver_contacts;
CREATE TRIGGER driver_contacts_blacklist_match AFTER INSERT OR UPDATE OF value ON public.driver_contacts
  FOR EACH ROW EXECUTE FUNCTION private.contacts_blacklist_match_trg();
DROP TRIGGER IF EXISTS driver_addresses_blacklist_match ON public.driver_addresses;
CREATE TRIGGER driver_addresses_blacklist_match AFTER INSERT OR UPDATE OF line1, zip ON public.driver_addresses
  FOR EACH ROW EXECUTE FUNCTION private.contacts_blacklist_match_trg();

-- On blacklisting: refuse a two-strike reason without the second strike, snapshot the
-- identifiers, then flag every other live application that matches.
CREATE OR REPLACE FUNCTION private.renter_blacklist_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text;
BEGIN
  k := CASE NEW.reason_code WHEN 'late_payment_second_strike' THEN 'late_payment'
         WHEN 'smoking_second_strike' THEN 'smoking' WHEN 'dirty_return_second_strike' THEN 'dirty_return' END;
  IF k IS NOT NULL AND NOT private.renter_second_strike_reached(NEW.application_id, k) THEN
    RAISE EXCEPTION 'blacklist_needs_second_strike: log a second % strike first', k;
  END IF;
  IF NEW.full_name IS NULL AND NEW.application_id IS NOT NULL THEN
    SELECT a.full_name INTO NEW.full_name FROM public.applications a WHERE a.id = NEW.application_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS renter_blacklist_before_insert ON public.renter_blacklist;
CREATE TRIGGER renter_blacklist_before_insert BEFORE INSERT ON public.renter_blacklist
  FOR EACH ROW EXECUTE FUNCTION private.renter_blacklist_before_insert();

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
      AND EXISTS (SELECT 1 FROM private.rr_application_identifiers(a.id) x
                  JOIN public.renter_blacklist_identifiers i ON i.blacklist_id = NEW.id AND i.kind = x.kind AND i.value_norm = x.value_norm)
  LOOP
    PERFORM private.flag_blacklist_match(r.id);
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS renter_blacklist_after_insert ON public.renter_blacklist;
CREATE TRIGGER renter_blacklist_after_insert AFTER INSERT ON public.renter_blacklist
  FOR EACH ROW EXECUTE FUNCTION private.renter_blacklist_after_insert();

-- ------------------------------------------------------------------- blocks
CREATE OR REPLACE FUNCTION private.blacklist_block_reason(_app uuid, _driver uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN private.is_blacklisted_application(_app) THEN 'renter_blacklisted'
    WHEN _driver IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.renter_blacklist b JOIN public.applications a ON a.id = b.application_id
      WHERE b.removed_at IS NULL AND a.user_id = _driver) THEN 'renter_blacklisted'
    WHEN _app IS NOT NULL AND EXISTS (SELECT 1 FROM private.blacklist_matches(_app) m WHERE NOT m.cleared)
      THEN 'renter_blacklist_match_uncleared'
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION private.applications_blacklist_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE why text;
BEGIN
  IF NEW.status IN ('approved', 'active') AND OLD.status IS DISTINCT FROM NEW.status THEN
    why := private.blacklist_block_reason(NEW.id, NULL);
    IF why IS NOT NULL THEN
      RAISE EXCEPTION '%: application % cannot become %', why, NEW.id, NEW.status USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS applications_blacklist_guard ON public.applications;
CREATE TRIGGER applications_blacklist_guard BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION private.applications_blacklist_guard();

CREATE OR REPLACE FUNCTION private.rentals_blacklist_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE why text;
BEGIN
  IF NEW.status IN ('reserved', 'active') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    why := private.blacklist_block_reason(NEW.application_id, NEW.driver_id);
    IF why IS NOT NULL THEN
      RAISE EXCEPTION '%: no new rental, reservation or activation (rental %)', why, NEW.id USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rentals_blacklist_guard ON public.rentals;
CREATE TRIGGER rentals_blacklist_guard BEFORE INSERT OR UPDATE OF status ON public.rentals
  FOR EACH ROW EXECUTE FUNCTION private.rentals_blacklist_guard();

-- The app's pre-check (friendly message before it tries). Service role only.
CREATE OR REPLACE FUNCTION public.renter_blacklist_check(_application_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'blacklisted', private.is_blacklisted_application(_application_id),
    'block', private.blacklist_block_reason(_application_id,
               (SELECT a.user_id FROM public.applications a WHERE a.id = _application_id)),
    'matches', coalesce((SELECT jsonb_agg(jsonb_build_object('blacklist_id', m.blacklist_id, 'kinds', to_jsonb(m.kinds), 'cleared', m.cleared))
                         FROM private.blacklist_matches(_application_id) m), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.renter_blacklist_check(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renter_blacklist_check(uuid) TO service_role;

REVOKE ALL ON FUNCTION private.flag_blacklist_match(uuid), private.blacklist_matches(uuid),
  private.rr_application_identifiers(uuid), private.blacklist_block_reason(uuid, uuid),
  private.is_blacklisted_application(uuid), private.renter_second_strike_reached(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.flag_blacklist_match(uuid), private.blacklist_matches(uuid),
  private.rr_application_identifiers(uuid), private.blacklist_block_reason(uuid, uuid),
  private.is_blacklisted_application(uuid), private.renter_second_strike_reached(uuid, text) TO service_role;

-- Rollback (history is lost; export renter_blacklist first):
-- DROP TRIGGER IF EXISTS rentals_blacklist_guard ON public.rentals;
-- DROP TRIGGER IF EXISTS applications_blacklist_guard ON public.applications;
-- DROP TRIGGER IF EXISTS applications_blacklist_match ON public.applications;
-- DROP TRIGGER IF EXISTS driver_contacts_blacklist_match ON public.driver_contacts;
-- DROP TRIGGER IF EXISTS driver_addresses_blacklist_match ON public.driver_addresses;
-- DROP FUNCTION IF EXISTS public.renter_blacklist_check(uuid);
-- DROP TABLE IF EXISTS public.renter_blacklist_clearances, public.renter_strikes,
--   public.renter_blacklist_identifiers, public.renter_blacklist;
