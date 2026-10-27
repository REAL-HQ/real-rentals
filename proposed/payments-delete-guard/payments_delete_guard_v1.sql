-- PROPOSED ONLY. Not a migration and not installed. Payments delete guard v1.
-- Payment rows are financial history (AGENTS.md: a payments row is a charge written before
-- collection; revenue = net_collected; refunds only via apply_payment_refund). Today the RLS
-- policy "Managers manage payments" (ALL) lets any Manager delete one, and no trigger stops it.
-- This trigger refuses DELETE on public.payments from every API role (authenticated, anon,
-- service_role). Correct a charge entered in error by setting status 'void' with a reason.
-- Untouched: every policy and grant, every row, the status check, both ledgers.
-- Foreign keys into payments' parents are ON DELETE SET NULL (an UPDATE), so no cascade deletes
-- payments; nothing in the app deletes payments except the removed Delete action.

CREATE FUNCTION private.payments_delete_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $pdgfn$
BEGIN
 IF current_user OPERATOR(pg_catalog.=) ANY (ARRAY['authenticated', 'anon', 'service_role']::pg_catalog.name[]) THEN
  RAISE EXCEPTION 'payments_are_financial_history_void_instead' USING ERRCODE = '42501';
 END IF;
 RETURN OLD;
END $pdgfn$;
REVOKE ALL ON FUNCTION private.payments_delete_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zz_payments_delete_guard BEFORE DELETE ON public.payments
 FOR EACH ROW EXECUTE FUNCTION private.payments_delete_guard();
