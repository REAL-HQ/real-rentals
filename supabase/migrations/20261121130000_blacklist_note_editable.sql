-- Blacklist note is editable (Dolmar, Nov 21 2026). Owner / Admin / Manager, through the
-- editBlacklistNote server function (service role; it checks the tier and writes the audit_log
-- row renter.blacklist_note_edited with the previous and new note). Only the note may change on
-- an active entry: reason, date, who added it and the identity fields stay locked, removal is
-- still the one other allowed change, and nothing is ever deleted.
-- RLS is unchanged: direct client UPDATE stays Owner-only (private.is_owner()).
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
     OR NEW.reason_code IS DISTINCT FROM OLD.reason_code
     OR NEW.blacklisted_on IS DISTINCT FROM OLD.blacklisted_on OR NEW.added_by IS DISTINCT FROM OLD.added_by
     OR NEW.added_by_label IS DISTINCT FROM OLD.added_by_label OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    RAISE EXCEPTION 'renter_blacklist_history: only the note and the removal (who, when, why) can change on an entry';
  END IF;
  IF NEW.note IS DISTINCT FROM OLD.note AND length(btrim(coalesce(NEW.note, ''))) < 5 THEN
    RAISE EXCEPTION 'renter_blacklist_history: a blacklist note is required';
  END IF;
  RETURN NEW;
END $$;

-- Rollback: re-run the guard from 20261120040000_renter_blacklist.sql (note locked again).
