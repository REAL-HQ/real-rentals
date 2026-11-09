-- Payments delete guard v1 rollback inner DDL. Runner owns the transaction. Removes exactly what v1 added.
DROP TRIGGER zz_payments_delete_guard ON public.payments;
DROP FUNCTION private.payments_delete_guard();
