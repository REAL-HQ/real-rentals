-- Activation insurance setting v1 rollback inner DDL. Runner owns the transaction.
-- Removes exactly the objects v1 created. The trigger goes first so the setting row can be removed.
DROP FUNCTION public.activate_rental_checked_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid, boolean);
DROP FUNCTION public.set_rental_activation_insurance_exception(boolean);
DROP TRIGGER rental_activation_setting_guard ON public.app_settings;
DROP FUNCTION private.rental_activation_setting_guard();
DROP POLICY rental_activation_setting_no_client_insert ON public.app_settings;
DROP POLICY rental_activation_setting_no_client_update ON public.app_settings;
DROP POLICY rental_activation_setting_no_client_delete ON public.app_settings;
DELETE FROM public.app_settings WHERE key = 'rental_activation';
