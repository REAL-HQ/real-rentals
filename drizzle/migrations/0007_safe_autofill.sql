CREATE TABLE public.vehicle_autofill_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  field text NOT NULL,
  previous_value text,
  new_value text NOT NULL,
  document_id uuid,
  page integer,
  proposal_id uuid,
  batch_id uuid,
  doc_class text,
  evidence_raw text,
  confidence text NOT NULL,
  actor text NOT NULL DEFAULT 'safe-autofill',
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  undone_by uuid,
  undo_result text,
  UNIQUE (proposal_id, field)
);
CREATE INDEX vehicle_autofill_events_vehicle_idx ON public.vehicle_autofill_events (vehicle_id, created_at DESC);
CREATE INDEX vehicle_autofill_events_batch_idx ON public.vehicle_autofill_events (batch_id);
CREATE INDEX vehicle_autofill_events_created_idx ON public.vehicle_autofill_events (created_at);
GRANT SELECT ON public.vehicle_autofill_events TO authenticated;
GRANT ALL ON public.vehicle_autofill_events TO service_role;
ALTER TABLE public.vehicle_autofill_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read autofill history" ON public.vehicle_autofill_events FOR SELECT TO authenticated USING (private.is_owner());
CREATE INDEX IF NOT EXISTS vehicles_vin_upper_idx ON public.vehicles (upper(vin));