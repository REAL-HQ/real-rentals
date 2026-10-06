ALTER FUNCTION public.guard_vehicle_ready_status() SECURITY DEFINER;
REVOKE EXECUTE ON FUNCTION public.guard_vehicle_ready_status() FROM PUBLIC, anon, authenticated;