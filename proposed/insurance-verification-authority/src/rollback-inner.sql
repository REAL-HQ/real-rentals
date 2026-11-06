-- Insurance verification authority v1 rollback inner DDL. Runner owns the transaction.
-- Removes exactly the objects v1 created. Stored screening values and audit rows stay.
DROP FUNCTION public.set_insurance_verification(uuid, boolean, text);
DROP TRIGGER zz_insurance_decision_guard ON public.driver_screenings;
DROP FUNCTION private.insurance_decision_guard();
