-- LOCAL PROPOSAL ONLY. Not a migration. Do not apply this to any database.
--
-- The live ledger is public.vehicle_expenses (see
-- supabase/migrations/20260925161000_vehicle_expenses.sql). A completed
-- service already inserts one linked expense for the net paid. Applying a
-- second ledger without retiring that write would count the same cost twice.
-- This table is the entry store for the dark screen, and it stays unread
-- until a reviewed change applies it and points entry at it alone.
--
-- Managers only. private.is_manager() includes Owner. No partner policy.
-- Receipt bytes stay in the existing private receipts bucket. This file
-- does not add a bucket or a storage policy.

CREATE TABLE public.vehicle_expense_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  category text NOT NULL CHECK (category IN ('maintenance', 'insurance', 'registration', 'tolls', 'cleaning', 'other')),
  incurred_on date NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  vendor_name text NOT NULL CHECK (length(btrim(vendor_name)) > 0),
  receipt_path text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vehicle_expense_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.vehicle_expense_entries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vehicle_expense_entries TO authenticated;

CREATE POLICY "Managers manage vehicle expense entries"
  ON public.vehicle_expense_entries
  FOR ALL TO authenticated
  USING (private.is_manager())
  WITH CHECK (private.is_manager());
