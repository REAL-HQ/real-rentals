-- Rollback for supabase/migrations/20261117030000_staff_schedules.sql
-- Run only with Dolmar's approval. Does not run from a bot.

DROP POLICY IF EXISTS "Owners manage staff schedule exceptions" ON public.staff_schedule_exceptions;
DROP POLICY IF EXISTS "Staff read staff schedule exceptions" ON public.staff_schedule_exceptions;
DROP POLICY IF EXISTS "Owners manage staff schedules" ON public.staff_schedules;
DROP POLICY IF EXISTS "Staff read staff schedules" ON public.staff_schedules;
DROP TABLE IF EXISTS public.staff_schedule_exceptions;
DROP TABLE IF EXISTS public.staff_schedules;
