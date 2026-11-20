-- Managers may ADD a blacklist entry (Dolmar, Nov 20 2026). Removal (UPDATE),
-- voiding warnings and clearing matches stay Owner / Admin (private.is_owner()).
-- private.is_manager() is true for Owner (admin) and Manager (team), not Coordinators.
-- The server function also checks the tier (supabaseAdmin bypasses RLS).
DROP POLICY IF EXISTS "Owner adds to blacklist" ON public.renter_blacklist;
DROP POLICY IF EXISTS "Manager adds to blacklist" ON public.renter_blacklist;
CREATE POLICY "Manager adds to blacklist" ON public.renter_blacklist FOR INSERT TO authenticated WITH CHECK (private.is_manager());
