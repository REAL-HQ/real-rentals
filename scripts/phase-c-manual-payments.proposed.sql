-- PROPOSED — NOT APPLIED. Phase C manual payments, stage 1 (additive only).
-- Stage 1 adds the records table and controlled functions. It does NOT remove existing
-- charge editing, so the live site keeps working unchanged.
-- Stage 2 (separate approval, after the new screens are published and verified):
--   REVOKE UPDATE, DELETE ON public.payments FROM authenticated;  + matching policy change.

CREATE TABLE public.payment_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id),
  rental_id uuid REFERENCES public.rentals(id),
  driver_id uuid REFERENCES public.applications(id),
  purpose text NOT NULL,
  method text NOT NULL CHECK (method IN ('cash_app','venmo','zelle','cash','bank_transfer','check','money_order','other')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  received_on date NOT NULL,
  reference_raw text,
  reference_norm text GENERATED ALWAYS AS (nullif(regexp_replace(lower(coalesce(reference_raw,'')),'[^a-z0-9]','','g'),'')) STORED,
  receipt_document_id uuid REFERENCES public.documents(id),
  cash_recipient text,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','reversed')),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  verification_note text,
  self_verify_exception_reason text,
  rejection_reason text,
  reversed_by uuid,
  reversed_at timestamptz,
  reverse_reason text,
  ledger_txn_id uuid REFERENCES public.financial_transactions(id),
  idempotency_key text NOT NULL UNIQUE
);
COMMENT ON TABLE public.payment_collections IS 'Money received outside Stripe against one payments charge. Writes only via collection_* functions.';

REVOKE ALL ON public.payment_collections FROM PUBLIC, anon, authenticated;  -- override platform default privileges
GRANT SELECT ON public.payment_collections TO authenticated;
GRANT ALL ON public.payment_collections TO service_role;
ALTER TABLE public.payment_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read payment records" ON public.payment_collections
  FOR SELECT TO authenticated USING (private.is_staff());

CREATE INDEX payment_collections_payment_idx ON public.payment_collections(payment_id, status);
CREATE INDEX payment_collections_driver_idx ON public.payment_collections(driver_id, received_on DESC);
CREATE INDEX payment_collections_queue_idx ON public.payment_collections(status, recorded_at);
CREATE UNIQUE INDEX payment_collections_reference_uniq ON public.payment_collections(method, reference_norm)
  WHERE method <> 'cash' AND reference_norm IS NOT NULL AND status IN ('pending','verified');

-- Immutability: only pending→verified/rejected and verified→reversed; core details never change.
CREATE FUNCTION public.payment_collections_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payment records cannot be deleted'; END IF;
  IF NOT ((OLD.status='pending' AND NEW.status IN ('verified','rejected'))
       OR (OLD.status='verified' AND NEW.status='reversed')) THEN
    RAISE EXCEPTION 'Payment record is %, it cannot change', OLD.status;
  END IF;
  IF (NEW.payment_id, NEW.method, NEW.amount, NEW.received_on, NEW.reference_raw, NEW.receipt_document_id,
      NEW.cash_recipient, NEW.notes, NEW.recorded_by, NEW.recorded_at, NEW.purpose, NEW.idempotency_key)
     IS DISTINCT FROM
     (OLD.payment_id, OLD.method, OLD.amount, OLD.received_on, OLD.reference_raw, OLD.receipt_document_id,
      OLD.cash_recipient, OLD.notes, OLD.recorded_by, OLD.recorded_at, OLD.purpose, OLD.idempotency_key) THEN
    RAISE EXCEPTION 'Payment details are permanent; reverse and record a new payment';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_collections_guard BEFORE UPDATE OR DELETE ON public.payment_collections
  FOR EACH ROW EXECUTE FUNCTION public.payment_collections_guard();

CREATE FUNCTION public.collection__audit(_id uuid, _action text, _summary text, _meta jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_log(actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata)
  VALUES (auth.uid(), CASE WHEN private.is_owner() THEN 'owner' WHEN private.is_manager() THEN 'manager' ELSE 'coordinator' END,
          _action, 'payment_collection', _id::text, _summary, _meta);
$$;

-- RECORD: Owner, Manager or Coordinator. Always Pending; never touches balances, Stripe or rentals.
CREATE FUNCTION public.collection_record(_payment_id uuid, _method text, _amount numeric, _received_on date,
  _reference text, _receipt_document_id uuid, _cash_recipient text, _notes text, _idem text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.payments%ROWTYPE; v_id uuid; v_open numeric; v_pending numeric; v_ref text;
BEGIN
  IF auth.uid() IS NULL OR NOT (private.is_manager() OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'coordinator')) THEN
    RAISE EXCEPTION 'Not allowed to record payments' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(_idem),'') = '' THEN RAISE EXCEPTION 'Missing submission key'; END IF;
  SELECT id INTO v_id FROM public.payment_collections WHERE idempotency_key = _idem;
  IF FOUND THEN RETURN v_id; END IF;  -- repeated submission

  v_ref := nullif(btrim(coalesce(_reference,'')),'');
  -- Evidence by method
  IF _method IN ('cash_app','venmo','zelle','bank_transfer','money_order') AND _receipt_document_id IS NULL AND v_ref IS NULL THEN
    RAISE EXCEPTION 'Add a receipt or a transaction reference'; END IF;
  IF _method = 'check' AND _receipt_document_id IS NULL THEN
    RAISE EXCEPTION 'Add a check image or deposit confirmation'; END IF;
  IF _method = 'cash' AND (coalesce(btrim(_notes),'') = '' OR coalesce(btrim(_cash_recipient),'') = '') THEN
    RAISE EXCEPTION 'Cash needs a written note and who received it'; END IF;
  IF _method = 'other' AND (_receipt_document_id IS NULL OR coalesce(btrim(_notes),'') = '') THEN
    RAISE EXCEPTION 'Other needs supporting evidence and an explanation'; END IF;
  IF _received_on > current_date THEN RAISE EXCEPTION 'Date received cannot be in the future'; END IF;

  SELECT * INTO c FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Charge not found'; END IF;
  IF c.status IN ('paid','refunded','waived','void') THEN RAISE EXCEPTION 'This charge is already %', c.status; END IF;
  IF c.stripe_payment_intent_id IS NOT NULL AND c.status = 'pending' THEN
    RAISE EXCEPTION 'A card payment is in progress for this charge'; END IF;
  IF _receipt_document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.documents WHERE id = _receipt_document_id) THEN
    RAISE EXCEPTION 'Receipt not found'; END IF;

  v_open := coalesce(c.balance_due, c.amount);
  SELECT coalesce(sum(amount),0) INTO v_pending FROM public.payment_collections WHERE payment_id = c.id AND status = 'pending';
  IF round(_amount,2) > v_open - v_pending THEN
    RAISE EXCEPTION 'Amount is more than the remaining balance (% open, % already pending)', v_open, v_pending; END IF;

  INSERT INTO public.payment_collections(payment_id, rental_id, driver_id, purpose, method, amount, received_on,
    reference_raw, receipt_document_id, cash_recipient, notes, recorded_by, idempotency_key)
  VALUES (c.id, c.rental_id, c.driver_id, c.type, _method, round(_amount,2), _received_on,
    v_ref, _receipt_document_id, nullif(btrim(_cash_recipient),''), nullif(btrim(_notes),''), auth.uid(), _idem)
  RETURNING id INTO v_id;
  PERFORM public.collection__audit(v_id, 'payment_recorded', 'Recorded ' || _method || ' payment of $' || round(_amount,2),
    jsonb_build_object('payment_id', c.id, 'amount', round(_amount,2), 'method', _method, 'received_on', _received_on));
  RETURN v_id;
END $$;

-- VERIFY: Manager/Owner, never the recorder (Owner exception only with reason + evidence, logged).
-- Cash needs an Owner. Verifier must confirm funds were actually received.
CREATE FUNCTION public.collection_verify(_id uuid, _funds_confirmed boolean, _note text, _self_exception_reason text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.payment_collections%ROWTYPE; c public.payments%ROWTYPE; v_open numeric; v_new numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_manager() THEN
    RAISE EXCEPTION 'Only a Manager or Owner can verify payments' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.payment_collections WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment record not found'; END IF;
  IF r.status = 'verified' THEN RETURN 'already_verified'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Payment record is %', r.status; END IF;
  IF NOT coalesce(_funds_confirmed,false) OR coalesce(btrim(_note),'') = '' THEN
    RAISE EXCEPTION 'Confirm the money arrived and say how you checked (a screenshot alone is not proof)'; END IF;
  IF r.method = 'cash' AND NOT private.is_owner() THEN RAISE EXCEPTION 'Cash payments need Owner verification' USING ERRCODE = '42501'; END IF;
  IF r.recorded_by = auth.uid() THEN
    IF NOT private.is_owner() THEN RAISE EXCEPTION 'Another Manager or the Owner must verify a payment you recorded' USING ERRCODE = '42501'; END IF;
    IF coalesce(btrim(_self_exception_reason),'') = '' OR (r.receipt_document_id IS NULL AND r.reference_raw IS NULL AND r.method <> 'cash') THEN
      RAISE EXCEPTION 'Verifying your own entry needs a written exception reason and supporting evidence'; END IF;
  ELSIF _self_exception_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Exception reason is only for verifying your own entry'; END IF;

  SELECT * INTO c FROM public.payments WHERE id = r.payment_id FOR UPDATE;
  IF c.status IN ('paid','refunded','waived','void') THEN RAISE EXCEPTION 'This charge is already %', c.status; END IF;
  v_open := coalesce(c.balance_due, c.amount);
  IF r.amount > v_open THEN RAISE EXCEPTION 'Amount is more than the remaining balance (%)', v_open; END IF;
  v_new := round(v_open - r.amount, 2);

  UPDATE public.payments SET
    balance_due = v_new,
    status = CASE WHEN v_new = 0 THEN 'paid' ELSE status END,
    paid_date = CASE WHEN v_new = 0 THEN r.received_on ELSE paid_date END,
    payment_method = CASE WHEN v_new = 0 THEN r.method ELSE payment_method END
  WHERE id = c.id;

  UPDATE public.payment_collections SET status = 'verified', decided_by = auth.uid(), decided_at = now(),
    verification_note = btrim(_note), self_verify_exception_reason = nullif(btrim(coalesce(_self_exception_reason,'')),'')
  WHERE id = _id;
  PERFORM public.collection__audit(_id,
    CASE WHEN r.recorded_by = auth.uid() THEN 'payment_verified_self_exception' ELSE 'payment_verified' END,
    'Verified $' || r.amount || ' ' || r.method || ' payment',
    jsonb_build_object('payment_id', c.id, 'amount', r.amount, 'balance_before', v_open, 'balance_after', v_new,
      'self_exception_reason', _self_exception_reason));
  RETURN 'verified';
END $$;

-- REJECT: Manager/Owner, reason required. Balance never changes.
CREATE FUNCTION public.collection_reject(_id uuid, _reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.payment_collections%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_manager() THEN
    RAISE EXCEPTION 'Only a Manager or Owner can reject payments' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO r FROM public.payment_collections WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment record not found'; END IF;
  IF r.status = 'rejected' THEN RETURN 'already_rejected'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Payment record is %', r.status; END IF;
  UPDATE public.payment_collections SET status = 'rejected', decided_by = auth.uid(), decided_at = now(),
    rejection_reason = btrim(_reason) WHERE id = _id;
  PERFORM public.collection__audit(_id, 'payment_rejected', 'Rejected $' || r.amount || ' ' || r.method || ' payment',
    jsonb_build_object('payment_id', r.payment_id, 'reason', btrim(_reason)));
  RETURN 'rejected';
END $$;

-- REVERSE: Manager/Owner, reason required. Restores the charge balance; record stays in history.
CREATE FUNCTION public.collection_reverse(_id uuid, _reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.payment_collections%ROWTYPE; c public.payments%ROWTYPE; v_bal numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_manager() THEN
    RAISE EXCEPTION 'Only a Manager or Owner can reverse payments' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO r FROM public.payment_collections WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment record not found'; END IF;
  IF r.status = 'reversed' THEN RETURN 'already_reversed'; END IF;
  IF r.status <> 'verified' THEN RAISE EXCEPTION 'Only verified payments can be reversed'; END IF;
  IF r.method = 'cash' AND NOT private.is_owner() THEN RAISE EXCEPTION 'Cash reversals need the Owner' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.payments WHERE id = r.payment_id FOR UPDATE;
  IF c.status IN ('refunded','void') THEN RAISE EXCEPTION 'This charge is %; resolve that first', c.status; END IF;
  v_bal := round(coalesce(c.balance_due, 0) + r.amount, 2);
  IF v_bal > c.amount + coalesce(c.late_fees,0) THEN RAISE EXCEPTION 'Reversal would exceed the charge total'; END IF;
  UPDATE public.payments SET
    balance_due = v_bal,
    status = CASE WHEN status = 'paid' THEN CASE WHEN due_date IS NOT NULL AND due_date < current_date THEN 'past_due' ELSE 'unpaid' END ELSE status END,
    paid_date = CASE WHEN status = 'paid' THEN NULL ELSE paid_date END
  WHERE id = c.id;
  UPDATE public.payment_collections SET status = 'reversed', reversed_by = auth.uid(), reversed_at = now(),
    reverse_reason = btrim(_reason) WHERE id = _id;
  PERFORM public.collection__audit(_id, 'payment_reversed', 'Reversed $' || r.amount || ' ' || r.method || ' payment',
    jsonb_build_object('payment_id', c.id, 'amount', r.amount, 'balance_after', v_bal, 'reason', btrim(_reason)));
  RETURN 'reversed';
END $$;

REVOKE ALL ON FUNCTION public.collection__audit(uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collection_record(uuid,text,numeric,date,text,uuid,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.collection_verify(uuid,boolean,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.collection_reject(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.collection_reverse(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collection_record(uuid,text,numeric,date,text,uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collection_verify(uuid,boolean,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collection_reject(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collection_reverse(uuid,text) TO authenticated;
