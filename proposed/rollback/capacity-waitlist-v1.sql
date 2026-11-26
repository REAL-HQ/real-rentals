-- Rollback for supabase/migrations/20261126213000_capacity_waitlist.sql.
-- Not applied. Drops the notice queue and the additive columns.
-- Existing waitlist holds stay; only the source column is removed.
-- Does not install a frozen event list. It only removes vehicle_available
-- from the check that is already there, after deleting those rows.

DROP TABLE IF EXISTS public.waitlist_notice_jobs;

-- The guard trigger forbids deletes. Drop it only long enough to remove
-- capacity holds that have no staff user, then put the trigger back.
-- Manual holds have added_by and stay.
DROP TRIGGER IF EXISTS waitlist_holds_guard ON public.application_waitlist_holds;
DELETE FROM public.application_waitlist_holds WHERE added_by IS NULL;

ALTER TABLE public.application_waitlist_holds
  DROP CONSTRAINT IF EXISTS application_waitlist_holds_source_check;
ALTER TABLE public.application_waitlist_holds
  DROP CONSTRAINT IF EXISTS application_waitlist_holds_manual_actor_check;
ALTER TABLE public.application_waitlist_holds
  DROP CONSTRAINT IF EXISTS application_waitlist_holds_removed_pair_check;

ALTER TABLE public.application_waitlist_holds
  DROP COLUMN IF EXISTS source;

ALTER TABLE public.application_waitlist_holds
  ALTER COLUMN added_by SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'application_waitlist_holds_removed_pair_check'
       AND conrelid = 'public.application_waitlist_holds'::regclass
  ) THEN
    ALTER TABLE public.application_waitlist_holds
      ADD CONSTRAINT application_waitlist_holds_removed_pair_check
      CHECK ((removed_at IS NULL) = (removed_by IS NULL));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.waitlist_holds_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Waitlist history cannot be deleted'; END IF;
  IF OLD.removed_at IS NOT NULL THEN RAISE EXCEPTION 'A closed waitlist hold is immutable'; END IF;
  IF NEW.application_id <> OLD.application_id OR NEW.added_at <> OLD.added_at OR NEW.added_by <> OLD.added_by THEN
    RAISE EXCEPTION 'Only removal may be recorded on a waitlist hold';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER waitlist_holds_guard
  BEFORE UPDATE OR DELETE ON public.application_waitlist_holds
  FOR EACH ROW EXECUTE FUNCTION public.waitlist_holds_guard();

DELETE FROM public.fleet_webhook_deliveries WHERE event_type = 'vehicle_available';

DO $$
DECLARE
  cname text;
  expr text;
  rewritten text;
BEGIN
  SELECT c.conname, pg_get_constraintdef(c.oid)
    INTO cname, expr
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
   WHERE nsp.nspname = 'public'
     AND rel.relname = 'fleet_webhook_deliveries'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%vehicle_available%'
   LIMIT 1;
  IF cname IS NULL THEN
    RETURN;
  END IF;
  rewritten := replace(expr, '''vehicle_available''::text, ', '');
  rewritten := replace(rewritten, ', ''vehicle_available''::text', '');
  IF rewritten = expr THEN
    RAISE EXCEPTION 'could not remove vehicle_available from %', expr;
  END IF;
  EXECUTE format('ALTER TABLE public.fleet_webhook_deliveries DROP CONSTRAINT %I', cname);
  EXECUTE format(
    'ALTER TABLE public.fleet_webhook_deliveries ADD CONSTRAINT fleet_webhook_deliveries_event_type_check %s',
    rewritten
  );
END $$;

ALTER TABLE public.applications
  DROP COLUMN IF EXISTS approved_at;
