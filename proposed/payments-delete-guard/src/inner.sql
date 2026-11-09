-- Payments delete guard v1 inner DDL. Runner owns the transaction.
-- Payment rows are financial history. A row trigger refuses DELETE on public.payments from every API
-- role (authenticated, anon, service_role); a charge entered in error is voided (status 'void' with a
-- reason) instead. The database owner (approved SQL, migrations) is unaffected. No policy, grant or row changes.

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
