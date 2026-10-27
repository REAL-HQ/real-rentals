-- Payments write guard v1 inner DDL. Runner owns the transaction.
-- A payment row changes only through audited server code (service_role: the staff status actions,
-- Charge Card / Pay Now collection, the Stripe webhook, the crons) or approved SQL. A signed-in
-- user's own session (authenticated) and anon may, whatever RLS allows, only:
--   * edit notes and payment_method on an existing row (an allowlist: every other column, present
--     or added later, is frozen, including amounts, balances, statuses, dates, links and type);
--   * add a charge that starts owed: an open status, no paid date, refund, Stripe link or attempt
--     state, and a balance no larger than the amount; any column outside the add-a-charge set
--     must be empty or zero.
-- No policy, grant or row changes.

CREATE FUNCTION private.payments_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $pwgfn$
DECLARE
 editable pg_catalog.text[] := ARRAY['notes', 'payment_method', 'updated_at', 'net_collected'];
 insertable pg_catalog.text[] := ARRAY['id', 'created_at', 'updated_at', 'net_collected', 'driver_id', 'vehicle_id', 'rental_id',
   'type', 'reason', 'amount', 'balance_due', 'due_date', 'status', 'payment_method', 'notes'];
BEGIN
 IF current_user OPERATOR(pg_catalog.<>) ALL (ARRAY['authenticated', 'anon']::pg_catalog.name[]) THEN
  RETURN NEW;
 END IF;
 IF TG_OP OPERATOR(pg_catalog.=) 'INSERT' THEN
  IF NEW.status IS NULL
  OR NOT (NEW.status OPERATOR(pg_catalog.=) ANY (ARRAY['upcoming', 'current', 'overdue', 'past_due', 'late', 'failed', 'unpaid', 'collections']::pg_catalog.text[]))
  OR NEW.amount IS NULL OR NEW.amount OPERATOR(pg_catalog.<) 0
  OR COALESCE(NEW.balance_due, 0) OPERATOR(pg_catalog.<) 0 OR COALESCE(NEW.balance_due, 0) OPERATOR(pg_catalog.>) NEW.amount
  OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(pg_catalog.to_jsonb(NEW) OPERATOR(pg_catalog.-) insertable) e
              WHERE e.value OPERATOR(pg_catalog.<>) ALL (ARRAY['null', '0']::pg_catalog.jsonb[]))
  THEN
   RAISE EXCEPTION 'payments_new_charge_must_start_owed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
 END IF;
 IF (pg_catalog.to_jsonb(NEW) OPERATOR(pg_catalog.-) editable) IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) OPERATOR(pg_catalog.-) editable) THEN
  RAISE EXCEPTION 'payments_change_only_through_audited_server' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END $pwgfn$;
REVOKE ALL ON FUNCTION private.payments_write_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zz_payments_write_guard BEFORE INSERT OR UPDATE ON public.payments
 FOR EACH ROW EXECUTE FUNCTION private.payments_write_guard();
