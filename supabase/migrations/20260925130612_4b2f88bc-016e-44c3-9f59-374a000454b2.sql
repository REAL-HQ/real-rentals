ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS driver_signature_ip text,
  ADD COLUMN IF NOT EXISTS driver_signature_user_agent text,
  ADD COLUMN IF NOT EXISTS driver_notes text,
  ADD COLUMN IF NOT EXISTS signature_requested_at timestamptz;

COMMENT ON COLUMN public.inspections.driver_signature_name IS
  'Typed legal name the renter signed with. Present means they agreed to the
   recorded condition at handover.';
COMMENT ON COLUMN public.inspections.driver_notes IS
  'The renter''s own remarks at sign-off — kept apart from staff notes so a
   later dispute can tell who wrote what.';

DROP POLICY IF EXISTS "Drivers sign their own inspection" ON public.inspections;
CREATE POLICY "Drivers sign their own inspection" ON public.inspections
  FOR UPDATE TO authenticated
  USING (
    driver_signed_at IS NULL
    AND inspection_type = 'pre_delivery'
    AND status = 'passed'
    AND (driver_user_id = auth.uid() OR private.driver_rents_vehicle(vehicle_id))
  )
  WITH CHECK (
    driver_user_id = auth.uid() OR private.driver_rents_vehicle(vehicle_id)
  );

REVOKE UPDATE ON public.inspections FROM authenticated;
GRANT UPDATE (
  driver_user_id,
  driver_signature_name,
  driver_signed_at,
  driver_signature_ip,
  driver_signature_user_agent,
  driver_notes
) ON public.inspections TO authenticated;

REVOKE UPDATE ON public.inspection_items FROM authenticated;

CREATE INDEX IF NOT EXISTS inspections_awaiting_signature_idx
  ON public.inspections (vehicle_id)
  WHERE inspection_type = 'pre_delivery' AND status = 'passed' AND driver_signed_at IS NULL;