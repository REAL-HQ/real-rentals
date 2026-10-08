-- Rolled-back regression test for the 48-hour expiry in scripts/phase-c-manual-payments.proposed.sql.
-- Installs the proposal INSIDE this block and ends with RAISE EXCEPTION, so schema, functions and
-- fixtures are always rolled back. Regenerate after editing the proposal (proposal text is embedded).
DO $t$
DECLARE
  own uuid := '15604112-1a62-4907-a92c-09045ee70ca6';
  mgr uuid := '194cec09-2d93-42d0-a5a7-04e8c931d7de';
  a uuid; ch uuid; old uuid; p2 uuid; n int; s text; fin0 bigint; aud0 bigint;
  PROCEDURE_ok boolean; out text := '';
BEGIN
  EXECUTE $ddl$-- PROPOSED — NOT APPLIED. Phase C manual payments, stage 1 (additive only).
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
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','reversed','expired')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '48 hours',
  expired_at timestamptz,
  extended_count int NOT NULL DEFAULT 0,
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
  WHERE method <> 'cash' AND reference_norm IS NOT NULL AND status IN ('pending','verified','expired');
-- expired keeps its reference claimed: reconcile the original, never re-enter it.
CREATE INDEX payment_collections_expiry_idx ON public.payment_collections(expires_at) WHERE status = 'pending';

-- Immutability. Allowed transitions:
--   pending→verified|rejected|expired, verified→reversed,
--   expired→pending (Owner extend / Manager+ reconcile), pending→pending (deadline extension only).
-- Core details never change; expires_at may only move forward.
CREATE FUNCTION public.payment_collections_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payment records cannot be deleted'; END IF;
  IF NOT ((OLD.status='pending' AND NEW.status IN ('verified','rejected','expired'))
       OR (OLD.status='verified' AND NEW.status='reversed')
       OR (OLD.status='expired' AND NEW.status='pending')
       OR (OLD.status='pending' AND NEW.status='pending' AND NEW.expires_at > OLD.expires_at)) THEN
    RAISE EXCEPTION 'Payment record is %, it cannot change', OLD.status;
  END IF;
  IF (NEW.payment_id, NEW.method, NEW.amount, NEW.received_on, NEW.reference_raw, NEW.receipt_document_id,
      NEW.cash_recipient, NEW.notes, NEW.recorded_by, NEW.recorded_at, NEW.purpose, NEW.idempotency_key)
     IS DISTINCT FROM
     (OLD.payment_id, OLD.method, OLD.amount, OLD.received_on, OLD.reference_raw, OLD.receipt_document_id,
      OLD.cash_recipient, OLD.notes, OLD.recorded_by, OLD.recorded_at, OLD.purpose, OLD.idempotency_key) THEN
    RAISE EXCEPTION 'Payment details are permanent; reverse and record a new payment';
  END IF;
  IF NEW.expires_at < OLD.expires_at THEN RAISE EXCEPTION 'A deadline can only be extended'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_collections_guard BEFORE UPDATE OR DELETE ON public.payment_collections
  FOR EACH ROW EXECUTE FUNCTION public.payment_collections_guard();

CREATE FUNCTION public.collection__audit(_id uuid, _action text, _summary text, _meta jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_log(actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata)
  VALUES (auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' WHEN private.is_owner() THEN 'owner' WHEN private.is_manager() THEN 'manager' ELSE 'coordinator' END,
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
  SELECT coalesce(sum(amount),0) INTO v_pending FROM public.payment_collections WHERE payment_id = c.id AND status = 'pending' AND expires_at > now();
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
  IF r.expires_at <= now() THEN RAISE EXCEPTION 'This pending payment has expired; reconcile it first'; END IF;
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
  -- Atomic recheck under the charge lock: balance minus OTHER live reservations.
  IF r.amount > v_open - (SELECT coalesce(sum(amount),0) FROM public.payment_collections
       WHERE payment_id = c.id AND id <> r.id AND status = 'pending' AND expires_at > now()) THEN
    RAISE EXCEPTION 'Amount is more than the remaining balance (%)', v_open; END IF;
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

-- ===== 48-hour expiry (repaired: audit via collection__audit -> real audit_log columns;
-- transitions allowed by payment_collections_guard) =====

-- Background sweep; scheduler calls it with no user session. Moves no money, posts nothing, no Stripe.
CREATE FUNCTION public.collection_expire_due() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT id, expires_at FROM public.payment_collections
           WHERE status = 'pending' AND expires_at <= now() FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.payment_collections SET status = 'expired', expired_at = now() WHERE id = r.id;
    PERFORM public.collection__audit(r.id, 'payment_expired', 'Expired — 48-hour verification deadline passed (review needed)',
      jsonb_build_object('deadline', r.expires_at));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Owner: extend a pending deadline (or reopen an expired one) with a reason.
CREATE FUNCTION public.collection_extend(_id uuid, _reason text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.payment_collections%ROWTYPE; c public.payments%ROWTYPE; v timestamptz := now() + interval '48 hours';
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_owner() THEN RAISE EXCEPTION 'Only the Owner can extend a deadline' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO r FROM public.payment_collections WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment record not found'; END IF;
  IF r.status NOT IN ('pending','expired') THEN RAISE EXCEPTION 'Payment record is %', r.status; END IF;
  IF r.status = 'expired' THEN
    SELECT * INTO c FROM public.payments WHERE id = r.payment_id FOR UPDATE;
    IF r.amount > coalesce(c.balance_due, c.amount) - (SELECT coalesce(sum(amount),0) FROM public.payment_collections
         WHERE payment_id = c.id AND id <> r.id AND status = 'pending' AND expires_at > now()) THEN
      RAISE EXCEPTION 'Amount is more than the remaining balance'; END IF;
  END IF;
  UPDATE public.payment_collections SET status = 'pending', expires_at = greatest(v, r.expires_at + interval '1 second'),
    expired_at = NULL, extended_count = extended_count + 1 WHERE id = _id;
  PERFORM public.collection__audit(_id, 'payment_deadline_extended', 'Verification deadline extended 48 hours',
    jsonb_build_object('reason', btrim(_reason), 'previous_deadline', r.expires_at, 'previous_status', r.status));
  RETURN v;
END $$;

-- Manager/Owner: reconcile an expired entry back to verification (same row; never a new payment).
CREATE FUNCTION public.collection_reconcile(_id uuid, _reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.payment_collections%ROWTYPE; c public.payments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_manager() THEN RAISE EXCEPTION 'Only a Manager or Owner can reconcile' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO r FROM public.payment_collections WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment record not found'; END IF;
  IF r.status <> 'expired' THEN RAISE EXCEPTION 'Only expired payments can be reconciled'; END IF;
  SELECT * INTO c FROM public.payments WHERE id = r.payment_id FOR UPDATE;
  IF c.status IN ('paid','refunded','waived','void') THEN RAISE EXCEPTION 'This charge is already %', c.status; END IF;
  IF r.amount > coalesce(c.balance_due, c.amount) - (SELECT coalesce(sum(amount),0) FROM public.payment_collections
       WHERE payment_id = c.id AND id <> r.id AND status = 'pending' AND expires_at > now()) THEN
    RAISE EXCEPTION 'Amount is more than the remaining balance'; END IF;
  UPDATE public.payment_collections SET status = 'pending', expires_at = now() + interval '48 hours', expired_at = NULL WHERE id = _id;
  PERFORM public.collection__audit(_id, 'payment_reconciled', 'Expired payment returned to verification', jsonb_build_object('reason', btrim(_reason)));
  RETURN 'pending';
END $$;

-- Duplicate cash guard: a matching expired cash entry must be reconciled, not re-entered.
CREATE FUNCTION public.payment_collections_cash_dupe() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.method = 'cash' AND EXISTS (SELECT 1 FROM public.payment_collections
       WHERE payment_id = NEW.payment_id AND method = 'cash' AND status = 'expired'
         AND amount = NEW.amount AND received_on = NEW.received_on) THEN
    RAISE EXCEPTION 'A matching expired cash entry exists — reconcile it instead'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_collections_cash_dupe BEFORE INSERT ON public.payment_collections
  FOR EACH ROW EXECUTE FUNCTION public.payment_collections_cash_dupe();

REVOKE ALL ON FUNCTION public.collection_expire_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collection_expire_due() TO service_role;
REVOKE ALL ON FUNCTION public.collection_extend(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.collection_reconcile(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collection_extend(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collection_reconcile(uuid,text) TO authenticated;

-- Scheduler (runs with nobody online), enabled with the migration:
-- SELECT cron.schedule('manual-payments-expiry', '*/5 * * * *', $c$SELECT public.collection_expire_due()$c$);
$ddl$;
  SELECT count(*) INTO fin0 FROM financial_transactions;
  INSERT INTO applications(full_name,email,phone,status) VALUES ('Zz Exp','zz-exp@invalid.example','0','approved') RETURNING id INTO a;
  INSERT INTO payments(driver_id,amount,balance_due,status,type,due_date) VALUES (a,350,350,'unpaid','rent',current_date) RETURNING id INTO ch;
  -- A pending entry whose 48h deadline has already passed (recorded by Owner).
  INSERT INTO payment_collections(payment_id,driver_id,purpose,method,amount,received_on,reference_raw,status,recorded_by,recorded_at,expires_at,idempotency_key)
  VALUES (ch,a,'rent','zelle',200,current_date,'ZX-1','pending',own,now()-interval '49 hours',now()-interval '1 hour','t-old') RETURNING id INTO old;
  SELECT count(*) INTO aud0 FROM audit_log WHERE entity_id = old::text;

  -- 1. Stale pending no longer reserves, even before the sweep runs.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',mgr,'role','authenticated')::text, true); EXECUTE 'SET LOCAL ROLE authenticated';
  p2 := collection_record(ch,'venmo',300,current_date,'VN-9',NULL,NULL,NULL,'t-p2');
  EXECUTE 'RESET ROLE';
  out := out || 'PASS 1 stale reservation released (300 recorded against 350)' || chr(10);

  -- 2. Background sweep with no user session.
  PERFORM set_config('request.jwt.claims', '', true);
  n := collection_expire_due();
  SELECT status INTO s FROM payment_collections WHERE id = old;
  IF n <> 1 OR s <> 'expired' THEN RAISE EXCEPTION 'FAIL 2 sweep n=% s=%', n, s; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE entity_id = old::text AND action='payment_expired' AND actor_role='system' AND summary <> '') THEN
    RAISE EXCEPTION 'FAIL 2 audit row'; END IF;
  out := out || 'PASS 2 sweep expired 1 row with system audit entry (no session)' || chr(10);

  -- 3. Duplicate reference against an expired entry is refused.
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub',mgr,'role','authenticated')::text, true); EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM collection_record(ch,'zelle',20,current_date,'zx 1',NULL,NULL,NULL,'t-dup');
    RAISE EXCEPTION 'FAIL 3 duplicate accepted';
  EXCEPTION WHEN unique_violation THEN out := out || 'PASS 3 duplicate reference refused' || chr(10);
  END;
  EXECUTE 'RESET ROLE';

  -- 4. Reconcile rechecks availability (300 live pending + 200 > 350).
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub',mgr,'role','authenticated')::text, true); EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM collection_reconcile(old,'Found in statement');
    RAISE EXCEPTION 'FAIL 4 over-allocation reconciled';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Amount is more%' THEN RAISE; END IF;
    out := out || 'PASS 4 reconcile refused over-allocation' || chr(10);
  END;
  EXECUTE 'RESET ROLE';

  -- 5. Reject the other, reconcile succeeds on the SAME row, Manager verifies Owner's entry.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',own,'role','authenticated')::text, true); EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM collection_reject(p2,'Not received');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',mgr,'role','authenticated')::text, true); EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM collection_reconcile(old,'Found in Zelle statement');
  PERFORM collection_verify(old,true,'Zelle statement line 10-08',NULL);
  EXECUTE 'RESET ROLE';
  IF (SELECT balance_due FROM payments WHERE id=ch) <> 150 THEN RAISE EXCEPTION 'FAIL 5 balance'; END IF;
  IF (SELECT count(*) FROM payment_collections WHERE payment_id=ch) <> 2 THEN RAISE EXCEPTION 'FAIL 5 extra rows'; END IF;
  out := out || 'PASS 5 reconcile reused row; verified; balance 350 -> 150; no new payment rows' || chr(10);

  -- 6. History immutable.
  BEGIN UPDATE payment_collections SET amount = 1 WHERE id = old; RAISE EXCEPTION 'FAIL 6 edit';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM payment_collections WHERE id = old; RAISE EXCEPTION 'FAIL 6 delete';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN UPDATE payment_collections SET status='pending' WHERE id = old; RAISE EXCEPTION 'FAIL 6 unverify';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM audit_log WHERE entity_id = old::text) - aud0 < 3 THEN RAISE EXCEPTION 'FAIL 6 audit trail'; END IF;
  out := out || 'PASS 6 edits/deletes/backward transitions refused; audit trail expired->reconciled->verified' || chr(10);

  -- 7. Verify refuses an expired pending row; Owner-only extend.
  INSERT INTO payment_collections(payment_id,driver_id,purpose,method,amount,received_on,reference_raw,status,recorded_by,expires_at,idempotency_key)
  VALUES (ch,a,'rent','check',10,current_date,'CK-5','pending',own,now()-interval '1 minute','t-late') RETURNING id INTO p2;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub',mgr,'role','authenticated')::text, true); EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM collection_verify(p2,true,'x',NULL); RAISE EXCEPTION 'FAIL 7 verified expired';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN PERFORM collection_extend(p2,'x'); RAISE EXCEPTION 'FAIL 7 manager extended';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',own,'role','authenticated')::text, true); EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM collection_extend(p2,'Driver mailed check');
  EXECUTE 'RESET ROLE';
  IF (SELECT expires_at FROM payment_collections WHERE id=p2) < now() + interval '47 hours' THEN RAISE EXCEPTION 'FAIL 7 extend'; END IF;
  out := out || 'PASS 7 expired verify refused; Manager extend refused; Owner extend +48h' || chr(10);

  -- 8. No ledger side effects; sweep not callable by app users.
  IF (SELECT count(*) FROM financial_transactions) <> fin0 THEN RAISE EXCEPTION 'FAIL 8 ledger'; END IF;
  IF has_function_privilege('authenticated','public.collection_expire_due()','EXECUTE') THEN RAISE EXCEPTION 'FAIL 8 grant'; END IF;
  out := out || 'PASS 8 no ledger rows; sweep restricted to the scheduler' || chr(10);
  RAISE EXCEPTION 'ROLLED BACK — %', out;
END $t$;
