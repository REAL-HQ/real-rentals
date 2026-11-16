-- PROPOSED, NOT APPLIED. Needs Dolmar's approval, after the code is published.
-- Pickup checklist (src/lib/pickup-handover*.ts, page /pickup/<reservation id>).
-- One completed checklist per reservation. Written only by the server
-- (service role); staff can read. Turning on auto-activation is a separate
-- file: proposed/pickup-auto-activate-on.sql.

CREATE TABLE IF NOT EXISTS public.pickup_handovers (
  rental_id uuid PRIMARY KEY REFERENCES public.rentals(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  odometer integer NOT NULL CHECK (odometer >= 0 AND odometer <= 2000000),
  fuel_level text NOT NULL CHECK (fuel_level IN ('E','1/8','1/4','3/8','1/2','5/8','3/4','7/8','F')),
  renter_signature_name text NOT NULL CHECK (length(btrim(renter_signature_name)) >= 3),
  renter_signed_at timestamptz NOT NULL,
  renter_signature_ip text,
  renter_signature_user_agent text,
  completed_by uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  activation_status text NOT NULL DEFAULT 'pending'
    CHECK (activation_status IN ('pending','not_activated','failed','activated')),
  activation_detail text,
  activated_rental_id uuid REFERENCES public.rentals(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pickup_handovers_application_idx ON public.pickup_handovers (application_id);
ALTER TABLE public.pickup_handovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pickup_handovers FROM anon, authenticated;
DROP POLICY IF EXISTS pickup_handovers_staff_read ON public.pickup_handovers;
CREATE POLICY pickup_handovers_staff_read ON public.pickup_handovers
  FOR SELECT TO authenticated USING (private.is_staff());
GRANT SELECT ON public.pickup_handovers TO authenticated;

-- Rollback: DROP TABLE IF EXISTS public.pickup_handovers;
