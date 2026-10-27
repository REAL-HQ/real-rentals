-- PROPOSED ONLY. Rollback of payments delete guard v1: removes exactly what v1 added.
DROP TRIGGER zz_payments_delete_guard ON public.payments;
DROP FUNCTION private.payments_delete_guard();
