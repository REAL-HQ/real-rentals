-- Step C1 deposit correction: applying a held deposit is a non-cash settlement.
ALTER TABLE public.financial_transactions ADD COLUMN deposit_source_id uuid REFERENCES public.financial_transactions(id);
CREATE INDEX fin_txn_deposit_src_idx ON public.financial_transactions (deposit_source_id) WHERE deposit_source_id IS NOT NULL;
COMMENT ON COLUMN public.financial_transactions.deposit_source_id IS 'For deposit_applied/deposit_returned: the posted deposit_received row whose liability this reduces.';

ALTER TABLE public.financial_transactions DROP CONSTRAINT financial_transactions_basis_check;
ALTER TABLE public.financial_transactions ADD CONSTRAINT financial_transactions_basis_check CHECK (basis IN ('accrual','cash','both','none'));
ALTER TABLE public.financial_transactions DROP CONSTRAINT basis_matches_type;
ALTER TABLE public.financial_transactions ADD CONSTRAINT basis_matches_type CHECK (basis = CASE
    WHEN txn_type IN ('obligation','invoice') THEN 'accrual'
    WHEN txn_type IN ('expense','capital_expenditure') THEN 'both'
    WHEN txn_type = 'deposit_applied' THEN 'none' ELSE 'cash' END);
ALTER TABLE public.financial_transactions DROP CONSTRAINT posted_dates;
ALTER TABLE public.financial_transactions ADD CONSTRAINT posted_dates CHECK (status NOT IN ('posted','reversed','corrected') OR (posted_at IS NOT NULL AND posted_by IS NOT NULL
    AND (basis NOT IN ('accrual','both') OR recognition_date IS NOT NULL) AND (basis NOT IN ('cash','both') OR cash_date IS NOT NULL)));
ALTER TABLE public.financial_transactions ADD CONSTRAINT deposit_direction CHECK (
  (txn_type NOT IN ('deposit_received','deposit_applied') OR direction = 'in' OR reverses_id IS NOT NULL) AND
  (txn_type <> 'deposit_returned' OR direction = 'out' OR reverses_id IS NOT NULL));

CREATE OR REPLACE FUNCTION public.fin__basis(_type text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _type IN ('obligation','invoice') THEN 'accrual'
              WHEN _type IN ('expense','capital_expenditure') THEN 'both'
              WHEN _type = 'deposit_applied' THEN 'none' ELSE 'cash' END $$;

-- Deposit balance guard: applications + refunds can never exceed the posted deposit received.
CREATE OR REPLACE FUNCTION public.fin_deposit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE src public.financial_transactions; v_used numeric;
BEGIN
  IF NEW.txn_type NOT IN ('deposit_applied','deposit_returned') OR NEW.reverses_id IS NOT NULL
     OR NEW.status IN ('discarded','reversed','corrected') THEN RETURN NEW; END IF;
  IF NEW.deposit_source_id IS NULL THEN RAISE EXCEPTION 'deposit_source_required'; END IF;
  SELECT * INTO src FROM public.financial_transactions WHERE id = NEW.deposit_source_id FOR UPDATE;
  IF src.id IS NULL OR src.txn_type <> 'deposit_received' OR src.reverses_id IS NOT NULL THEN RAISE EXCEPTION 'deposit_source_invalid'; END IF;
  IF src.status <> 'posted' THEN RAISE EXCEPTION 'deposit_source_not_posted'; END IF;
  IF src.sensitivity <> NEW.sensitivity THEN RAISE EXCEPTION 'deposit_sensitivity_mismatch'; END IF;
  SELECT coalesce(sum(amount),0) INTO v_used FROM public.financial_transactions
   WHERE deposit_source_id = src.id AND id <> NEW.id AND reverses_id IS NULL
     AND txn_type IN ('deposit_applied','deposit_returned') AND status IN ('proposed','confirmed','posted');
  IF v_used + NEW.amount > src.amount THEN
    RAISE EXCEPTION 'deposit_over_applied: % available', src.amount - v_used;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fin_deposit_guard BEFORE INSERT OR UPDATE ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fin_deposit_guard();
REVOKE ALL ON FUNCTION public.fin_deposit_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fin__insert(_p jsonb, _idem text, _status text, _reverses uuid, _corrects uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_type text := _p->>'txn_type'; v_posted boolean := _status = 'posted'; v_b text := public.fin__basis(_p->>'txn_type');
BEGIN
  INSERT INTO public.financial_transactions(
    txn_type, basis, direction, category, status, sensitivity, amount, interest_amount,
    document_date, service_date, due_date, recognition_date, cash_date,
    vendor_id, payee_raw, reference_raw, reference_norm, payment_method, memo,
    vehicle_hint_id, rental_id, payment_id, expense_id, reverses_id, corrects_id, deposit_source_id,
    source_type, idempotency_key, created_by, posted_by, posted_at, confirmed_by, confirmed_at)
  VALUES (
    v_type, v_b, _p->>'direction', _p->>'category', _status,
    coalesce(_p->>'sensitivity','standard'), (_p->>'amount')::numeric, (_p->>'interest_amount')::numeric,
    (_p->>'document_date')::date, (_p->>'service_date')::date, (_p->>'due_date')::date,
    CASE WHEN v_b IN ('accrual','both') THEN (_p->>'recognition_date')::date END,
    CASE WHEN v_b IN ('cash','both') THEN (_p->>'cash_date')::date END,
    (_p->>'vendor_id')::uuid, _p->>'payee_raw', _p->>'reference_raw', _p->>'reference_norm', _p->>'payment_method', _p->>'memo',
    (_p->>'vehicle_hint_id')::uuid, (_p->>'rental_id')::uuid, (_p->>'payment_id')::uuid, (_p->>'expense_id')::uuid,
    _reverses, _corrects, (_p->>'deposit_source_id')::uuid, coalesce(_p->>'source_type','manual'), _idem, auth.uid(),
    CASE WHEN v_posted THEN auth.uid() END, CASE WHEN v_posted THEN now() END,
    CASE WHEN v_posted THEN auth.uid() END, CASE WHEN v_posted THEN now() END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.fin_post(_id uuid, _recognition date, _cash date) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.financial_transactions;
BEGIN
  SELECT * INTO r FROM public.financial_transactions WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public.fin__require(r.sensitivity);
  IF r.status = 'posted' THEN RETURN 'already_posted'; END IF;
  IF r.status <> 'confirmed' THEN RAISE EXCEPTION 'fin_invalid_transition: % -> posted (confirm first)', r.status; END IF;
  PERFORM set_config('app.fin_tx','on',true);
  UPDATE public.financial_transactions SET status='posted', posted_by=auth.uid(), posted_at=now(),
    recognition_date = CASE WHEN basis IN ('accrual','both') THEN coalesce(_recognition, recognition_date) END,
    cash_date = CASE WHEN basis IN ('cash','both') THEN coalesce(_cash, cash_date) END
  WHERE id=_id;
  PERFORM set_config('app.fin_tx','off',true);
  PERFORM public.fin__log(_id, 'posted', 'confirmed', 'posted', NULL,
    jsonb_build_object('recognition_date',_recognition,'cash_date',_cash), NULL);
  RETURN 'posted';
END $$;

-- A deposit application can settle a driver charge (receivable), like a payment.
CREATE OR REPLACE FUNCTION public.fin_settle(_obligation uuid, _payment uuid, _amount numeric, _idem text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.financial_transactions; p public.financial_transactions; v_id uuid; v_o numeric; v_p numeric;
BEGIN
  SELECT id INTO v_id FROM public.financial_settlements WHERE idempotency_key = _idem;
  IF FOUND THEN RETURN v_id; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  PERFORM 1 FROM public.financial_transactions WHERE id IN (_obligation, _payment) ORDER BY id FOR UPDATE;
  SELECT * INTO o FROM public.financial_transactions WHERE id = _obligation;
  SELECT * INTO p FROM public.financial_transactions WHERE id = _payment;
  IF o.id IS NULL OR p.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public.fin__require(o.sensitivity); PERFORM public.fin__require(p.sensitivity);
  IF o.status <> 'posted' OR p.status <> 'posted' THEN RAISE EXCEPTION 'settle_requires_posted'; END IF;
  IF o.txn_type NOT IN ('obligation','invoice') THEN RAISE EXCEPTION 'settle_target_not_invoice'; END IF;
  IF p.txn_type NOT IN ('payment','financing_payment','deposit_applied') OR p.reverses_id IS NOT NULL THEN RAISE EXCEPTION 'settle_source_not_payment'; END IF;
  IF o.direction <> p.direction THEN RAISE EXCEPTION 'settle_direction_mismatch'; END IF;
  SELECT coalesce(sum(amount),0) INTO v_o FROM public.financial_settlements WHERE obligation_id = _obligation AND status='active';
  SELECT coalesce(sum(amount),0) INTO v_p FROM public.financial_settlements WHERE payment_txn_id = _payment AND status='active';
  IF v_o + _amount > o.amount THEN RAISE EXCEPTION 'over_settled_invoice: % remaining', o.amount - v_o; END IF;
  IF v_p + _amount > p.amount THEN RAISE EXCEPTION 'over_settled_payment: % remaining', p.amount - v_p; END IF;
  INSERT INTO public.financial_settlements(obligation_id, payment_txn_id, amount, idempotency_key, created_by)
  VALUES (_obligation, _payment, _amount, _idem, auth.uid()) RETURNING id INTO v_id;
  PERFORM public.fin__log(_obligation, 'settled', NULL, NULL, NULL, jsonb_build_object('settlement_id', v_id, 'payment_id', _payment, 'amount', _amount), NULL);
  RETURN v_id;
END $$;