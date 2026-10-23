-- Removes public.agreement_mileage_allowance(public.agreements).
-- Installing supabase/migrations/20261021120000_agreement_mileage_allowance.sql
-- creates that read-only function. This file drops it and does not change agreements.
-- This is not a migration. Do not copy it into supabase/migrations.
-- Do not run it against a hosted database until the owner approves the undo.

DROP FUNCTION IF EXISTS public.agreement_mileage_allowance(public.agreements);
