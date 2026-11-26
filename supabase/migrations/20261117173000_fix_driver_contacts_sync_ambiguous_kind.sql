-- Fix: every INSERT into public.applications (and every phone/email UPDATE)
-- has failed since 20261116160000_driver_contacts.sql was applied with
--   ERROR 42702: column reference "kind" is ambiguous
-- because applications_sync_primary_contacts() declared a PL/pgSQL variable
-- named "kind", the same name as driver_contacts.kind, and compared them
-- unqualified. That broke the website application form (no new
-- applications since Mon Nov 16 ~4:52 PM ET), waitlist "Promote To
-- Applicant", staff phone/email edits, and making an extra contact primary.
--
-- Same behavior as before: the loop variable is renamed (contact_kind),
-- every column reference is table-qualified, and when the new phone/email
-- already exists as an extra contact the old primary is demoted before the
-- extra is promoted (driver_contacts_one_primary is not deferrable). No data
-- is changed; the trigger definition is untouched.
CREATE OR REPLACE FUNCTION public.applications_sync_primary_contacts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  norm text;
  existing_id uuid;
  contact_kind text;
  changed boolean;
BEGIN
  FOREACH contact_kind IN ARRAY ARRAY['phone', 'email'] LOOP
    IF contact_kind = 'phone' THEN
      norm := public.normalize_driver_phone(NEW.phone);
      changed := TG_OP = 'INSERT' OR NEW.phone IS DISTINCT FROM OLD.phone;
    ELSE
      norm := public.normalize_driver_email(NEW.email);
      changed := TG_OP = 'INSERT' OR NEW.email IS DISTINCT FROM OLD.email;
    END IF;
    IF NOT changed OR norm IS NULL THEN
      CONTINUE;
    END IF;

    existing_id := NULL;
    SELECT c.id INTO existing_id
      FROM public.driver_contacts c
     WHERE c.application_id = NEW.id AND c.kind = contact_kind AND c.value = norm
     LIMIT 1;

    IF existing_id IS NOT NULL THEN
      -- Demote the old primary first: driver_contacts_one_primary is a
      -- non-deferrable unique index, so promoting first would collide.
      UPDATE public.driver_contacts dc
         SET is_primary = false, updated_at = now()
       WHERE dc.application_id = NEW.id AND dc.kind = contact_kind
         AND dc.id IS DISTINCT FROM existing_id AND dc.is_primary IS TRUE;
      UPDATE public.driver_contacts dc
         SET is_primary = true, receives_messages = true, updated_at = now()
       WHERE dc.id = existing_id AND dc.is_primary IS NOT TRUE;
    ELSE
      UPDATE public.driver_contacts dc
         SET value = norm, receives_messages = true, updated_at = now()
       WHERE dc.application_id = NEW.id AND dc.kind = contact_kind AND dc.is_primary IS TRUE;
      IF NOT FOUND THEN
        INSERT INTO public.driver_contacts (application_id, kind, value, is_primary, receives_messages)
        VALUES (NEW.id, contact_kind, norm, true, true)
        ON CONFLICT (application_id, kind, value) DO UPDATE
          SET is_primary = true, receives_messages = true, updated_at = now();
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
