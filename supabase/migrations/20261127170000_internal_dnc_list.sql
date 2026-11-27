-- Internal DNC (Do Not Contact) List.
-- Requested by Dolmar Nov 27 2026 (11:11 AM ET). DO NOT apply to production until Dolmar approves.
--
-- public.dnc_list   one row per "Move To DNC". Removal is recorded on the row (who / when / why);
--                   rows are never deleted, so the history stays. Moving the same person back
--                   later is a new row. At most one active row per application and per waitlist row.
--                   phones / emails hold the person's normalized phone numbers and emails taken
--                   when they were added (application + driver_contacts, or the waitlist row), so a
--                   later lead, waitlist signup or message to the same number/email is recognised.
-- public.dnc_suppressed(application, phone, email)
--                   the server-side check sendSms / sendEmail use before an automated send.
--
-- This is NOT the STOP opt-out list (public.sms_opt_outs) and NOT the Renter Blacklist; neither
-- is touched. Inbound texts, calls and email are never blocked.
--
-- Access: RLS enabled AND forced. anon gets nothing. authenticated gets only column-level
-- SELECT on the display columns (never phones / emails), and only staff pass the policy.
-- Every write goes through the server (service role) after a role check, and is audited.
-- Normalizers mirror src/lib/dnc.ts (scripts/dnc-list-postgres.test.ts).

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.dnc_norm_phone(_v text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text := regexp_replace(coalesce(_v, ''), '\D', '', 'g');
BEGIN
  IF length(d) = 11 AND left(d, 1) = '1' THEN d := substr(d, 2); END IF;
  RETURN CASE WHEN length(d) >= 10 THEN d END;
END $$;

CREATE OR REPLACE FUNCTION private.dnc_norm_email(_v text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE e text := lower(btrim(coalesce(_v, '')));
BEGIN
  RETURN CASE WHEN e ~ '^[^\s@]+@[^\s@]+$' THEN e END;
END $$;

CREATE TABLE IF NOT EXISTS public.dnc_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  waitlist_id uuid REFERENCES public.waitlist(id) ON DELETE SET NULL,
  person_type text NOT NULL CHECK (person_type IN ('lead', 'applicant', 'driver', 'renter')),
  full_name text,
  phones text[] NOT NULL DEFAULT '{}',
  emails text[] NOT NULL DEFAULT '{}',
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  added_by uuid,
  added_by_label text NOT NULL CHECK (length(btrim(added_by_label)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid,
  removed_by_label text,
  removal_reason text,
  CONSTRAINT dnc_list_has_person CHECK (
    application_id IS NOT NULL OR waitlist_id IS NOT NULL
    OR cardinality(phones) > 0 OR cardinality(emails) > 0),
  CONSTRAINT dnc_list_removal_complete CHECK (
    (removed_at IS NULL AND removed_by_label IS NULL AND removal_reason IS NULL)
    OR (removed_at IS NOT NULL AND length(btrim(coalesce(removed_by_label, ''))) > 0
        AND length(btrim(coalesce(removal_reason, ''))) >= 3))
);
COMMENT ON TABLE public.dnc_list IS
  'Internal Do Not Contact list. Never deleted: removal is recorded on the row. Server-only writes (role checked + audited). Automated SMS/email skip active rows via public.dnc_suppressed.';

CREATE UNIQUE INDEX IF NOT EXISTS dnc_list_one_active_per_application
  ON public.dnc_list (application_id) WHERE removed_at IS NULL AND application_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS dnc_list_one_active_per_waitlist
  ON public.dnc_list (waitlist_id) WHERE removed_at IS NULL AND waitlist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dnc_list_active_idx ON public.dnc_list (created_at DESC) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS dnc_list_phones_idx ON public.dnc_list USING gin (phones);
CREATE INDEX IF NOT EXISTS dnc_list_emails_idx ON public.dnc_list USING gin (emails);

-- Rows are history: no deletes, and once removed a row is final.
CREATE OR REPLACE FUNCTION private.dnc_list_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DNC entries are never deleted; record a removal instead' USING ERRCODE = '42501';
  END IF;
  -- Who / why / when it was added never changes.
  IF NEW.id <> OLD.id OR NEW.reason <> OLD.reason OR NEW.added_by_label <> OLD.added_by_label
     OR NEW.created_at <> OLD.created_at OR NEW.added_by IS DISTINCT FROM OLD.added_by
     OR NEW.person_type <> OLD.person_type
     -- the person links may only be cleared (ON DELETE SET NULL), never re-pointed
     OR (NEW.application_id IS NOT NULL AND NEW.application_id IS DISTINCT FROM OLD.application_id)
     OR (NEW.waitlist_id IS NOT NULL AND NEW.waitlist_id IS DISTINCT FROM OLD.waitlist_id) THEN
    RAISE EXCEPTION 'Only the removal fields of a DNC entry can change' USING ERRCODE = '42501';
  END IF;
  -- A removed entry is final (a later re-add is a new row); only the SET NULL above may touch it.
  IF OLD.removed_at IS NOT NULL AND (
       NEW.removed_at IS DISTINCT FROM OLD.removed_at OR NEW.removed_by IS DISTINCT FROM OLD.removed_by
       OR NEW.removed_by_label IS DISTINCT FROM OLD.removed_by_label
       OR NEW.removal_reason IS DISTINCT FROM OLD.removal_reason
       OR NEW.phones IS DISTINCT FROM OLD.phones OR NEW.emails IS DISTINCT FROM OLD.emails
       OR NEW.full_name IS DISTINCT FROM OLD.full_name) THEN
    RAISE EXCEPTION 'This DNC entry was already removed; add a new entry instead' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dnc_list_guard_update ON public.dnc_list;
CREATE TRIGGER dnc_list_guard_update BEFORE UPDATE ON public.dnc_list
  FOR EACH ROW EXECUTE FUNCTION private.dnc_list_guard();
DROP TRIGGER IF EXISTS dnc_list_guard_delete ON public.dnc_list;
CREATE TRIGGER dnc_list_guard_delete BEFORE DELETE ON public.dnc_list
  FOR EACH ROW EXECUTE FUNCTION private.dnc_list_guard();

-- ------------------------------------------------------------------ access
ALTER TABLE public.dnc_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dnc_list FORCE ROW LEVEL SECURITY;
-- Table-level revoke first: a column-level REVOKE does nothing after a table-level grant.
REVOKE ALL ON public.dnc_list FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, application_id, waitlist_id, person_type, full_name, reason, added_by_label, created_at,
  removed_at, removed_by_label, removal_reason) ON public.dnc_list TO authenticated;
GRANT ALL ON public.dnc_list TO service_role;

DROP POLICY IF EXISTS "Staff read DNC list" ON public.dnc_list;
CREATE POLICY "Staff read DNC list" ON public.dnc_list FOR SELECT TO authenticated USING (private.is_staff());
-- Supabase's service_role has BYPASSRLS; this explicit policy keeps the server path working
-- even where it does not (local harnesses), and FORCE keeps the table owner under RLS.
DROP POLICY IF EXISTS "Server manages DNC list" ON public.dnc_list;
CREATE POLICY "Server manages DNC list" ON public.dnc_list FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------- automated sends
CREATE OR REPLACE FUNCTION public.dnc_suppressed(_application_id uuid, _phone text, _email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dnc_list d
    WHERE d.removed_at IS NULL
      AND ((_application_id IS NOT NULL AND d.application_id = _application_id)
        OR (private.dnc_norm_phone(_phone) IS NOT NULL AND private.dnc_norm_phone(_phone) = ANY (d.phones))
        OR (private.dnc_norm_email(_email) IS NOT NULL AND private.dnc_norm_email(_email) = ANY (d.emails))))
$$;
REVOKE ALL ON FUNCTION public.dnc_suppressed(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dnc_suppressed(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION private.dnc_list_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.dnc_norm_phone(text), private.dnc_norm_email(text) TO service_role;

-- Rollback (history is lost; export public.dnc_list first):
-- DROP FUNCTION IF EXISTS public.dnc_suppressed(uuid, text, text);
-- DROP TABLE IF EXISTS public.dnc_list;
-- DROP FUNCTION IF EXISTS private.dnc_list_guard(), private.dnc_norm_phone(text), private.dnc_norm_email(text);
