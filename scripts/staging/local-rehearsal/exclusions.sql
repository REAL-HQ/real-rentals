-- Objects declared by repo files but ABSENT in production (read-only investigation 2026-10-31). Removed so the
-- local baseline matches production. Never introduced on staging.
DROP POLICY IF EXISTS "Staff manage automation workflows" ON public.automation_workflows;
DROP POLICY IF EXISTS "Staff manage automation steps" ON public.automation_steps;
DROP POLICY IF EXISTS "Staff manage vehicle doc objects" ON storage.objects;
DROP POLICY IF EXISTS "Staff manage toll charges" ON public.toll_charges;
DROP POLICY IF EXISTS "Staff manage incidents" ON public.incidents;
DROP POLICY IF EXISTS "Staff manage deposit deductions" ON public.deposit_deductions;
DROP POLICY IF EXISTS "Scoped upload license photos" ON storage.objects;
DROP POLICY IF EXISTS "Scoped upload profile screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Staff manage vehicle media" ON public.vehicle_media;
DROP POLICY IF EXISTS "Managers manage vehicle finance" ON public.vehicle_finance;
ALTER TABLE public.vehicles DROP COLUMN IF EXISTS lienholder, DROP COLUMN IF EXISTS purchase_date, DROP COLUMN IF EXISTS purchase_price, DROP COLUMN IF EXISTS ownership_type;
