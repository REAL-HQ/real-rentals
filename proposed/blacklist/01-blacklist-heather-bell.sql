-- PROPOSED DATA FIX. DO NOT RUN until Dolmar approves AND migration
-- 20261120040000_renter_blacklist.sql is applied.
--
-- Blacklists Heather Bell (driver/application 36973513…, car CZ07DA / RR-006):
--   reason  Vehicle Repossessed For Non-Payment Or Refusal To Return (vehicle_repossessed)
--   date    2026-11-19
--   by      Owner (Dolmar Cross)
-- Also appends the same note to her profile Notes (applications.notes), skipped if an
-- identical note is already there (a separate data fix may add it tonight).
-- Refuses (and changes nothing) unless exactly one live application matches.
-- Safe to re-run: an existing active blacklist entry is left alone.
--
-- Side effects of the migration's triggers when this inserts:
--   * her phone/email/licence/address are snapshotted into renter_blacklist_identifiers;
--   * every OTHER live application (not declined/closed/deleted) sharing any of them gets a
--     needs_staff flag 'blacklist match: ...' (an Owner clears it if it is not her);
--   * matching waitlist signups / website leads are recorded too (same building, similar
--     address, DOB + last name, card and signer IP for applications);
--   * approval, reservation and activation are refused for her from then on;
--   * automated texts/emails to her stop; staff can still text/email/call her manually.
--   Ending / closing her current rental is NOT blocked and is a separate step.

BEGIN;

DO $$
DECLARE
  app_id uuid;
  n int;
  owner_id uuid;
  note_text constant text := 'Blacklisted Nov 19, 2026: rent unpaid 2+ days ($350), ignored multiple contacts, kill switch bypassed/drove while disabled, vehicle CZ07DA repossessed Nov 19 with spare key; main key not returned ($150 replacement). Never signed a rental agreement.';
  -- The blacklist record's own note adds the balance (Dolmar Nov 20 2026); profile Notes keep the exact text above.
  record_note constant text := note_text || ' $600 unpaid incl. $150 key.';
BEGIN
  -- 36973513 is her rental id (RR-006); the blacklist is on the application behind it.
  SELECT count(DISTINCT a.id), min(a.id::text)::uuid INTO n, app_id
  FROM public.rentals r JOIN public.applications a ON a.id = r.application_id
  WHERE r.id::text LIKE '36973513%' AND a.deleted_at IS NULL AND a.full_name ILIKE '%heather%' AND a.full_name ILIKE '%bell%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one live Heather Bell application behind rental 36973513…, found %', n;
  END IF;

  -- The Owner account (role admin). Prefer Dolmar's login; otherwise the earliest Owner.
  SELECT ur.user_id INTO owner_id
  FROM public.user_roles ur LEFT JOIN auth.users u ON u.id = ur.user_id
  WHERE ur.role::text = 'admin'
  ORDER BY (lower(coalesce(u.email, '')) IN ('dolmarcross@gmail.com', 'dolmar@drivereal.com')) DESC, ur.created_at NULLS LAST
  LIMIT 1;

  IF NOT EXISTS (SELECT 1 FROM public.renter_blacklist b WHERE b.application_id = app_id AND b.removed_at IS NULL) THEN
    INSERT INTO public.renter_blacklist (application_id, reason_code, note, blacklisted_on, added_by, added_by_label)
    VALUES (app_id, 'vehicle_repossessed', record_note, DATE '2026-11-19', owner_id, 'Dolmar Cross (Owner)');

    INSERT INTO public.audit_log (actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata)
    VALUES (owner_id, 'owner', 'renter.blacklisted', 'application', app_id::text,
            'Blacklisted Heather Bell (Vehicle Repossessed For Non-Payment Or Refusal To Return)',
            jsonb_build_object('reason', 'vehicle_repossessed', 'blacklisted_on', '2026-11-19', 'source', 'proposed/blacklist/01-blacklist-heather-bell.sql'));
  END IF;

  -- Profile Notes: append unless the identical note is already present.
  UPDATE public.applications
  SET notes = CASE WHEN coalesce(btrim(notes), '') = '' THEN note_text
                   ELSE rtrim(notes) || E'\n\n' || note_text END
  WHERE id = app_id AND position(note_text IN coalesce(notes, '')) = 0;
END $$;

-- Check before COMMIT:
SELECT b.id, b.application_id, b.full_name, b.reason_code, b.blacklisted_on, b.added_by_label,
       (SELECT count(*) FROM public.renter_blacklist_identifiers i WHERE i.blacklist_id = b.id) AS identifiers
FROM public.renter_blacklist b
WHERE b.application_id IN (SELECT r.application_id FROM public.rentals r WHERE r.id::text LIKE '36973513%') AND b.removed_at IS NULL;

COMMIT;

-- Rollback (records a removal; entries are never deleted):
-- UPDATE public.renter_blacklist SET removed_at = now(), removed_by_label = 'Dolmar Cross (Owner)',
--   removal_reason = 'Entered in error'
--   WHERE application_id IN (SELECT application_id FROM public.rentals WHERE id::text LIKE '36973513%') AND removed_at IS NULL;
