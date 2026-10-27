-- Payments write guard v1 inner DDL. Runner owns the transaction.
-- The money fields of a payment row change only through audited server code (service_role: the
-- staff status actions, Charge Card / Pay Now collection, the Stripe webhook) or approved SQL.
-- A signed-in user's own session (authenticated) and anon may not change them directly, whatever
-- RLS allows: a Manager can still edit notes, due date, method, type and links, and can still add
-- a charge, but only one that starts owed. No policy, grant or row changes.

CREATE FUNCTION private.payments_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $pwgfn$
BEGIN
 IF current_user OPERATOR(pg_catalog.<>) ALL (ARRAY['authenticated', 'anon']::pg_catalog.name[]) THEN
  RETURN NEW;
 END IF;
 IF TG_OP OPERATOR(pg_catalog.=) 'INSERT' THEN
  IF NEW.status IS NULL
  OR NOT (NEW.status OPERATOR(pg_catalog.=) ANY (ARRAY['upcoming', 'current', 'overdue', 'past_due', 'late', 'failed', 'unpaid', 'collections']::pg_catalog.text[]))
  OR NEW.amount IS NULL OR NEW.amount OPERATOR(pg_catalog.<) 0
  OR COALESCE(NEW.balance_due, 0) OPERATOR(pg_catalog.<) 0 OR COALESCE(NEW.balance_due, 0) OPERATOR(pg_catalog.>) NEW.amount
  OR COALESCE(NEW.late_fees, 0) OPERATOR(pg_catalog.<>) 0 OR NEW.late_fee_applied_through IS NOT NULL
  OR NEW.paid_date IS NOT NULL OR COALESCE(NEW.refunded_amount, 0) OPERATOR(pg_catalog.<>) 0 OR NEW.refunded_at IS NOT NULL
  OR NEW.stripe_payment_intent_id IS NOT NULL OR NEW.stripe_invoice_id IS NOT NULL OR NEW.stripe_subscription_id IS NOT NULL
  OR COALESCE(NEW.attempt_count, 0) OPERATOR(pg_catalog.<>) 0 OR NEW.last_attempt_at IS NOT NULL
  OR NEW.notified_status IS NOT NULL OR NEW.failure_reason IS NOT NULL
  THEN
   RAISE EXCEPTION 'payments_new_charge_must_start_owed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.status, NEW.amount, NEW.balance_due, NEW.late_fees, NEW.late_fee_applied_through, NEW.paid_date,
        NEW.refunded_amount, NEW.refunded_at, NEW.stripe_payment_intent_id, NEW.stripe_invoice_id, NEW.stripe_subscription_id,
        NEW.attempt_count, NEW.last_attempt_at, NEW.notified_status, NEW.failure_reason)
    IS DISTINCT FROM
    ROW(OLD.status, OLD.amount, OLD.balance_due, OLD.late_fees, OLD.late_fee_applied_through, OLD.paid_date,
        OLD.refunded_amount, OLD.refunded_at, OLD.stripe_payment_intent_id, OLD.stripe_invoice_id, OLD.stripe_subscription_id,
        OLD.attempt_count, OLD.last_attempt_at, OLD.notified_status, OLD.failure_reason) THEN
  RAISE EXCEPTION 'payments_money_fields_change_only_through_audited_server' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END $pwgfn$;
REVOKE ALL ON FUNCTION private.payments_write_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zz_payments_write_guard BEFORE INSERT OR UPDATE ON public.payments
 FOR EACH ROW EXECUTE FUNCTION private.payments_write_guard();
