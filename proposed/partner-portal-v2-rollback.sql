-- Rollback for supabase/migrations/20261117070000_partner_portal_v2.sql.
-- Restores the pre-v2 partner policies exactly as they were in production on
-- Nov 17 2026 and removes the v2 objects. Column drops lose intake data, so
-- they are commented out; run them only if nothing was submitted on v2.
DROP FUNCTION IF EXISTS public.approve_partner_submission(uuid, uuid, numeric, numeric, boolean);
DROP TABLE IF EXISTS public.partner_notice_sends;
DROP POLICY IF EXISTS "Partners read own partner documents" ON storage.objects;
DROP POLICY IF EXISTS "Managers manage partner documents" ON storage.objects;
DROP POLICY IF EXISTS "Partners read own partner row" ON public.partners;

CREATE POLICY "Partners can view their assigned drivers" ON public.applications FOR SELECT TO authenticated
  USING ((vehicle_id IS NOT NULL) AND private.partner_owns_vehicle(vehicle_id));
CREATE POLICY "Partners read rentals on own vehicles" ON public.rentals FOR SELECT TO authenticated
  USING (private.partner_owns_vehicle(vehicle_id));
CREATE POLICY "Partners can view their payments" ON public.payments FOR SELECT TO authenticated
  USING ((vehicle_id IS NOT NULL) AND private.partner_owns_vehicle(vehicle_id));
CREATE POLICY "Partners read expenses on their vehicles" ON public.vehicle_expenses FOR SELECT TO authenticated
  USING (private.partner_owns_vehicle(vehicle_id));
CREATE POLICY "Partners read issues on own vehicles" ON public.issues FOR SELECT TO authenticated
  USING ((vehicle_id IS NOT NULL) AND private.partner_owns_vehicle(vehicle_id));
CREATE POLICY "Partners read maintenance on own vehicles" ON public.maintenance_records FOR SELECT TO authenticated
  USING (private.partner_owns_vehicle(vehicle_id));
CREATE POLICY "Partners view their visible documents" ON public.documents FOR SELECT TO authenticated
  USING (('partner'::text = ANY (visibility)) AND (partner_id IS NOT NULL) AND private.is_partner_owner(partner_id));
CREATE POLICY "Partners read their driver documents" ON storage.objects FOR SELECT TO authenticated
  USING ((bucket_id = ANY (ARRAY['rental-agreements'::text, 'license-uploads'::text])) AND (EXISTS (SELECT 1 FROM documents d
    WHERE d.storage_bucket = objects.bucket_id AND d.storage_path = objects.name AND 'partner'::text = ANY (d.visibility)
      AND d.partner_id IS NOT NULL AND private.is_partner_owner(d.partner_id))));

-- Optional, destructive (intake data):
-- ALTER TABLE public.fleet_owner_submissions DROP COLUMN business_name, ... ;
-- ALTER TABLE public.partners DROP COLUMN stripe_connect_account_id, ... ;
NOTIFY pgrst, 'reload schema';
