-- Keep an explicit next service due when staff or FLEET set one.
--
-- maintenance_schedule_roll_next used to overwrite next_due_on and
-- next_due_miles on every insert and update whenever last service and an
-- interval were both present. Mark Done (it changes last service and does
-- not send a next due) still rolls forward. A next due sent on the same
-- statement is kept, including a mileage or date that is not last + interval.
-- A notes-only update no longer recomputes the due date.
--
-- Not applied to production by the change that added this file.
-- Apply on the hosted database only after review, with no seed rows:
--   supabase db push
-- or paste this file into the Supabase SQL editor.
-- Until it is applied, a monthly inspection that sets last_done_on stores
-- next_due_on as last_done_on plus interval_days (30 for a new Monthly
-- Inspection). An oil next due with no last service is stored as sent
-- either way, because the old trigger only fills next due when last service
-- is present.

CREATE OR REPLACE FUNCTION public.maintenance_schedule_roll_next()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  rolled_on date;
  rolled_miles integer;
BEGIN
  IF NEW.interval_days IS NOT NULL AND NEW.last_done_on IS NOT NULL THEN
    rolled_on := (NEW.last_done_on + (NEW.interval_days || ' days')::interval)::date;
  END IF;
  IF NEW.interval_miles IS NOT NULL AND NEW.last_done_miles IS NOT NULL THEN
    rolled_miles := NEW.last_done_miles + NEW.interval_miles;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.next_due_on IS NULL THEN
      NEW.next_due_on := rolled_on;
    END IF;
    IF NEW.next_due_miles IS NULL THEN
      NEW.next_due_miles := rolled_miles;
    END IF;
    RETURN NEW;
  END IF;

  -- The writer left next due alone: roll it when last service or the interval changed.
  IF NEW.next_due_on IS NOT DISTINCT FROM OLD.next_due_on THEN
    IF NEW.last_done_on IS DISTINCT FROM OLD.last_done_on
       OR NEW.interval_days IS DISTINCT FROM OLD.interval_days
       OR NEW.next_due_on IS NULL THEN
      NEW.next_due_on := rolled_on;
    END IF;
  END IF;
  IF NEW.next_due_miles IS NOT DISTINCT FROM OLD.next_due_miles THEN
    IF NEW.last_done_miles IS DISTINCT FROM OLD.last_done_miles
       OR NEW.interval_miles IS DISTINCT FROM OLD.interval_miles
       OR NEW.next_due_miles IS NULL THEN
      NEW.next_due_miles := rolled_miles;
    END IF;
  END IF;
  RETURN NEW;
END $$;
