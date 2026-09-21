-- =============================================================================
-- Renter sign-off on the checkout inspection
--
-- Condition photos and a completed checklist establish what the car looked
-- like at handover, but only from our side. If a renter never agreed to that
-- record, a damage dispute is still our word against theirs.
--
-- The signature columns (driver_signature_name, driver_signed_at) already
-- exist; this adds the evidentiary context that makes a typed signature worth
-- something, matching what the agreements table already captures.
-- =============================================================================

ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS driver_signature_ip text,
  ADD COLUMN IF NOT EXISTS driver_signature_user_agent text,
  -- Free-text the renter adds when signing: "scratch on rear bumper already
  -- there". Recorded separately from staff notes so it is unambiguous who
  -- said it.
  ADD COLUMN IF NOT EXISTS driver_notes text,
  -- Set when we asked them to sign, so a nudge can tell how long it has sat.
  ADD COLUMN IF NOT EXISTS signature_requested_at timestamptz;

COMMENT ON COLUMN public.inspections.driver_signature_name IS
  'Typed legal name the renter signed with. Present means they agreed to the
   recorded condition at handover.';
COMMENT ON COLUMN public.inspections.driver_notes IS
  'The renter''s own remarks at sign-off — kept apart from staff notes so a
   later dispute can tell who wrote what.';

-- A renter must be able to record their signature on their own inspection,
-- but nothing else about it.
--
-- RLS alone cannot express that: a policy gates which ROWS may be updated,
-- not which COLUMNS, and WITH CHECK cannot compare against the pre-update
-- row. With only the policy below, a renter could call PostgREST directly and
-- rewrite the odometer or any other field on their own unsigned inspection —
-- the exact record the signature is meant to make trustworthy.
--
-- Column-level privileges are what actually constrain it. Every staff write
-- to this table goes through the service role (startInspection,
-- updateInspection, setInspectionItem, completeInspection all use
-- supabaseAdmin), and the service role bypasses column grants, so narrowing
-- `authenticated` costs the back office nothing.
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

-- Narrow what `authenticated` may write to: the signature fields and nothing
-- else. Combined with the policy above, a renter may sign their own passed
-- checkout inspection and can change nothing about what it records.
REVOKE UPDATE ON public.inspections FROM authenticated;
GRANT UPDATE (
  driver_user_id,
  driver_signature_name,
  driver_signed_at,
  driver_signature_ip,
  driver_signature_user_agent,
  driver_notes
) ON public.inspections TO authenticated;

-- Checklist results are never writable by a renter at all; they have no
-- UPDATE policy on inspection_items, and no grant either.
REVOKE UPDATE ON public.inspection_items FROM authenticated;

-- Finding the inspection a renter still owes a signature on.
CREATE INDEX IF NOT EXISTS inspections_awaiting_signature_idx
  ON public.inspections (vehicle_id)
  WHERE inspection_type = 'pre_delivery' AND status = 'passed' AND driver_signed_at IS NULL;
