-- PROPOSED — NOT APPLIED. Phase C manual payment recording.
-- Requires separate Owner approval before it runs against the shared database.

CREATE TABLE public.payment_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id),
  rental_id uuid REFERENCES public.rentals(id),
  driver_id uuid REFERENCES public.applications(id),
  method text NOT NULL CHECK (method IN ('cash_app','venmo','zelle','cash','bank_transfer','check','money_order','other')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  received_on date NOT NULL,
  reference_raw text,
  reference_norm text GENERATED ALWAYS AS (nullif(regexp_replace(lower(coalesce(reference_raw,'')),'[^a-z0-9]','','g'),'')) STORED,
  receipt_document_id uuid REFERENCES public.documents(id),
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','reversed')),
  recorded_by uuid NOT NULL,
  verified_by uuid,
  verified_at timestamptz,
  rejection_reason text,
  reverse_reason text,
  ledger_txn_id uuid REFERENCES public.financial_transactions(id),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (method = 'cash' OR receipt_document_id IS NOT NULL),
  CHECK (method <> 'cash' OR coalesce(btrim(notes),'') <> '')
);

GRANT SELECT ON public.payment_collections TO authenticated;
GRANT ALL ON public.payment_collections TO service_role;
ALTER TABLE public.payment_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read collections" ON public.payment_collections FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'team') OR public.has_role(auth.uid(),'coordinator'));

CREATE INDEX payment_collections_payment_idx ON public.payment_collections(payment_id, status);
CREATE INDEX payment_collections_driver_idx ON public.payment_collections(driver_id, received_on);
CREATE INDEX payment_collections_queue_idx ON public.payment_collections(status, created_at);
CREATE UNIQUE INDEX payment_collections_reference_uniq ON public.payment_collections(method, reference_norm)
  WHERE method <> 'cash' AND reference_norm IS NOT NULL AND status <> 'rejected';

-- Immutable once decided: only pending→verified/rejected and verified→reversed via the functions.
CREATE FUNCTION public.payment_collections_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payment records cannot be deleted'; END IF;
  IF NOT ((OLD.status='pending' AND NEW.status IN ('verified','rejected'))
       OR (OLD.status='verified' AND NEW.status='reversed')) THEN
    RAISE EXCEPTION 'Payment record % is %, it cannot change', OLD.id, OLD.status;
  END IF;
  IF (NEW.amount, NEW.method, NEW.payment_id, NEW.received_on, NEW.recorded_by) IS DISTINCT FROM
     (OLD.amount, OLD.method, OLD.payment_id, OLD.received_on, OLD.recorded_by) THEN
    RAISE EXCEPTION 'Payment details are immutable; reverse and record a new payment';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_collections_guard BEFORE UPDATE OR DELETE ON public.payment_collections
  FOR EACH ROW EXECUTE FUNCTION public.payment_collections_guard();

-- collection_record / collection_verify / collection_reject / collection_reverse (SECURITY DEFINER):
--  * role re-check (admin/team; coordinator record-only), Manager self-verify refused
--  * SELECT ... FOR UPDATE on payments; refuse amount > open balance, refuse Stripe-collected balance
--  * verify: balance_due -= amount, net_collected += amount, status 'paid' only at 0, paid_date
--  * deposit charges: rentals.deposit held, never revenue
--  * audit_log row on every transition; no rental/application status writes
-- Bodies are finalized and exercised in scripts/manual-payments.test.sql (rolled back) before approval.

-- Close browser writes to charges (server paths use service role).
REVOKE UPDATE, DELETE ON public.payments FROM authenticated;
