-- STEP C1: canonical financial transaction foundation (additive only)

CREATE TABLE public.financial_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_type text NOT NULL CHECK (txn_type IN ('obligation','invoice','expense','payment','refund',
    'deposit_received','deposit_returned','deposit_applied','capital_expenditure','financing_draw','financing_payment')),
  basis text NOT NULL CHECK (basis IN ('accrual','cash','both')),
  direction text NOT NULL CHECK (direction IN ('out','in')),
  category text NOT NULL CHECK (length(category) BETWEEN 1 AND 60),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','posted','reversed','corrected','discarded')),
  sensitivity text NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('standard','owner_only')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  interest_amount numeric(12,2) CHECK (interest_amount >= 0 AND interest_amount <= amount),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  document_date date, service_date date, due_date date,
  recognition_date date,
  cash_date date,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  payee_raw text, reference_raw text, reference_norm text, payment_method text, memo text,
  vehicle_hint_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  expense_id uuid REFERENCES public.vehicle_expenses(id) ON DELETE SET NULL,
  reverses_id uuid UNIQUE REFERENCES public.financial_transactions(id),
  corrects_id uuid UNIQUE REFERENCES public.financial_transactions(id),
  source_type text NOT NULL CHECK (source_type IN ('manual','fleet_inbox','service','expense','toll','deposit','stripe')),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  created_by uuid NOT NULL, confirmed_by uuid, confirmed_at timestamptz,
  posted_by uuid, posted_at timestamptz, closed_by uuid, closed_at timestamptz, close_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT basis_matches_type CHECK (basis = CASE
    WHEN txn_type IN ('obligation','invoice') THEN 'accrual'
    WHEN txn_type IN ('expense','capital_expenditure') THEN 'both' ELSE 'cash' END),
  CONSTRAINT posted_dates CHECK (status NOT IN ('posted','reversed','corrected') OR (posted_at IS NOT NULL AND posted_by IS NOT NULL
    AND (basis = 'cash' OR recognition_date IS NOT NULL) AND (basis = 'accrual' OR cash_date IS NOT NULL))),
  CONSTRAINT owner_only_categories CHECK ((category NOT IN ('acquisition','financing','lien','payoff')
    AND txn_type NOT IN ('financing_draw','financing_payment')) OR sensitivity = 'owner_only'),
  CONSTRAINT closing_reason CHECK (status NOT IN ('reversed','corrected','discarded') OR close_reason IS NOT NULL)
);
CREATE INDEX fin_txn_accrual_idx ON public.financial_transactions (recognition_date) WHERE status = 'posted' AND basis <> 'cash';
CREATE INDEX fin_txn_cash_idx    ON public.financial_transactions (cash_date) WHERE status = 'posted' AND basis <> 'accrual';
CREATE INDEX fin_txn_vehicle_idx ON public.financial_transactions (vehicle_hint_id, status);
CREATE INDEX fin_txn_dup_idx     ON public.financial_transactions (vendor_id, amount, document_date);
CREATE INDEX fin_txn_ref_idx     ON public.financial_transactions (reference_norm) WHERE reference_norm IS NOT NULL;
CREATE INDEX fin_txn_status_idx  ON public.financial_transactions (status, txn_type);

CREATE TABLE public.financial_transaction_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES public.financial_transactions(id),
  event text NOT NULL, from_status text, to_status text,
  actor uuid, before jsonb, after jsonb, reason text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX fin_evt_txn_idx ON public.financial_transaction_events (transaction_id, created_at);

CREATE TABLE public.financial_transaction_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.financial_transactions(id),
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  import_item_id uuid REFERENCES public.fleet_import_items(id) ON DELETE SET NULL,
  service_transaction_id uuid REFERENCES public.fleet_service_transactions(id) ON DELETE SET NULL,
  page int, raw_text text, field text, confidence text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (document_id IS NOT NULL OR import_item_id IS NOT NULL OR service_transaction_id IS NOT NULL));
CREATE INDEX fin_evd_txn_idx ON public.financial_transaction_evidence (transaction_id);
CREATE INDEX fin_evd_doc_idx ON public.financial_transaction_evidence (document_id);

CREATE TABLE public.financial_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.financial_transactions(id),
  payment_txn_id uuid NOT NULL REFERENCES public.financial_transactions(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reversed')),
  idempotency_key text NOT NULL UNIQUE,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  reversed_by uuid, reversed_at timestamptz, reverse_reason text,
  CHECK (obligation_id <> payment_txn_id),
  CHECK (status = 'active' OR reverse_reason IS NOT NULL));
CREATE UNIQUE INDEX fin_settle_pair_idx ON public.financial_settlements (obligation_id, payment_txn_id) WHERE status = 'active';
CREATE INDEX fin_settle_pay_idx ON public.financial_settlements (payment_txn_id);

GRANT SELECT ON public.financial_transactions, public.financial_transaction_events,
  public.financial_transaction_evidence, public.financial_settlements TO authenticated;
GRANT ALL ON public.financial_transactions, public.financial_transaction_events,
  public.financial_transaction_evidence, public.financial_settlements TO service_role;

ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transaction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transaction_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance staff read visible transactions" ON public.financial_transactions FOR SELECT TO authenticated
  USING ((sensitivity = 'standard' AND private.is_manager()) OR private.is_owner());
CREATE POLICY "Read events of visible transactions" ON public.financial_transaction_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.financial_transactions t WHERE t.id = transaction_id));
CREATE POLICY "Read evidence of visible transactions" ON public.financial_transaction_evidence FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.financial_transactions t WHERE t.id = transaction_id));
CREATE POLICY "Read settlements of visible transactions" ON public.financial_settlements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.financial_transactions t WHERE t.id = obligation_id)
     AND EXISTS (SELECT 1 FROM public.financial_transactions t WHERE t.id = payment_txn_id));

CREATE OR REPLACE FUNCTION public.fin_txn_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE locked text[] := ARRAY['status','closed_by','closed_at','close_reason','updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'fin_immutable: financial transactions are never deleted'; END IF;
  IF current_setting('app.fin_tx', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'fin_immutable: change financial transactions only through the ledger functions';
  END IF;
  IF NEW.id <> OLD.id OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'fin_immutable: identity fields cannot change';
  END IF;
  IF OLD.status IN ('reversed','corrected','discarded') THEN RAISE EXCEPTION 'fin_immutable: closed transactions cannot change'; END IF;
  IF OLD.status = 'posted' THEN
    IF NEW.status NOT IN ('reversed','corrected') OR (to_jsonb(NEW) - locked) <> (to_jsonb(OLD) - locked) THEN
      RAISE EXCEPTION 'fin_immutable: posted transactions can only be reversed or corrected';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (OLD.status = 'proposed' AND NEW.status IN ('confirmed','discarded')) OR
      (OLD.status = 'confirmed' AND NEW.status IN ('posted','discarded','proposed'))) THEN
    RAISE EXCEPTION 'fin_invalid_transition: % -> %', OLD.status, NEW.status;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER fin_txn_guard BEFORE UPDATE OR DELETE ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fin_txn_guard();

CREATE OR REPLACE FUNCTION public.fin_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'fin_immutable: % is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER fin_evt_append_only BEFORE UPDATE OR DELETE ON public.financial_transaction_events
  FOR EACH ROW EXECUTE FUNCTION public.fin_append_only();
CREATE TRIGGER fin_evd_append_only BEFORE UPDATE OR DELETE ON public.financial_transaction_evidence
  FOR EACH ROW EXECUTE FUNCTION public.fin_append_only();

CREATE OR REPLACE FUNCTION public.fin_settlement_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'fin_immutable: settlements are never deleted'; END IF;
  IF OLD.status <> 'active' OR NEW.status <> 'reversed'
     OR (to_jsonb(NEW) - ARRAY['status','reversed_by','reversed_at','reverse_reason']) <> (to_jsonb(OLD) - ARRAY['status','reversed_by','reversed_at','reverse_reason']) THEN
    RAISE EXCEPTION 'fin_immutable: a settlement can only be reversed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fin_settlement_guard BEFORE UPDATE OR DELETE ON public.financial_settlements
  FOR EACH ROW EXECUTE FUNCTION public.fin_settlement_guard();

CREATE OR REPLACE FUNCTION public.fin__require(_sensitivity text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _sensitivity = 'owner_only' AND NOT private.is_owner() THEN RAISE EXCEPTION 'forbidden'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fin__log(_id uuid, _event text, _from text, _to text, _before jsonb, _after jsonb, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.financial_transaction_events(transaction_id, event, from_status, to_status, actor, before, after, reason)
  VALUES (_id, _event, _from, _to, auth.uid(), _before, _after, _reason);
  INSERT INTO public.audit_log(actor_user_id, action, entity_type, entity_id, summary, metadata)
  VALUES (auth.uid(), 'finance.' || _event, 'financial_transaction', _id::text,
          coalesce(_from, '-') || ' -> ' || coalesce(_to, '-'), jsonb_build_object('reason', _reason));
END $$;

CREATE OR REPLACE FUNCTION public.fin__basis(_type text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _type IN ('obligation','invoice') THEN 'accrual'
              WHEN _type IN ('expense','capital_expenditure') THEN 'both' ELSE 'cash' END $$;

CREATE OR REPLACE FUNCTION public.fin__insert(_p jsonb, _idem text, _status text, _reverses uuid, _corrects uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_type text := _p->>'txn_type'; v_posted boolean := _status = 'posted';
BEGIN
  INSERT INTO public.financial_transactions(
    txn_type, basis, direction, category, status, sensitivity, amount, interest_amount,
    document_date, service_date, due_date, recognition_date, cash_date,
    vendor_id, payee_raw, reference_raw, reference_norm, payment_method, memo,
    vehicle_hint_id, rental_id, payment_id, expense_id, reverses_id, corrects_id,
    source_type, idempotency_key, created_by, posted_by, posted_at, confirmed_by, confirmed_at)
  VALUES (
    v_type, public.fin__basis(v_type), _p->>'direction', _p->>'category', _status,
    coalesce(_p->>'sensitivity','standard'), (_p->>'amount')::numeric, (_p->>'interest_amount')::numeric,
    (_p->>'document_date')::date, (_p->>'service_date')::date, (_p->>'due_date')::date,
    CASE WHEN public.fin__basis(v_type) <> 'cash' THEN (_p->>'recognition_date')::date END,
    CASE WHEN public.fin__basis(v_type) <> 'accrual' THEN (_p->>'cash_date')::date END,
    (_p->>'vendor_id')::uuid, _p->>'payee_raw', _p->>'reference_raw', _p->>'reference_norm', _p->>'payment_method', _p->>'memo',
    (_p->>'vehicle_hint_id')::uuid, (_p->>'rental_id')::uuid, (_p->>'payment_id')::uuid, (_p->>'expense_id')::uuid,
    _reverses, _corrects, coalesce(_p->>'source_type','manual'), _idem, auth.uid(),
    CASE WHEN v_posted THEN auth.uid() END, CASE WHEN v_posted THEN now() END,
    CASE WHEN v_posted THEN auth.uid() END, CASE WHEN v_posted THEN now() END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.fin_propose(_p jsonb, _idem text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_sens text;
BEGIN
  PERFORM public.fin__require(coalesce(_p->>'sensitivity','standard'));
  SELECT id, sensitivity INTO v_id, v_sens FROM public.financial_transactions WHERE idempotency_key = _idem;
  IF FOUND THEN PERFORM public.fin__require(v_sens); RETURN v_id; END IF;
  v_id := public.fin__insert(_p, _idem, 'proposed', NULL, NULL);
  PERFORM public.fin__log(v_id, 'proposed', NULL, 'proposed', NULL, _p, NULL);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.fin_confirm(_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.financial_transactions;
BEGIN
  SELECT * INTO r FROM public.financial_transactions WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public.fin__require(r.sensitivity);
  IF r.status = 'confirmed' THEN RETURN 'already_confirmed'; END IF;
  IF r.status <> 'proposed' THEN RAISE EXCEPTION 'fin_invalid_transition: % -> confirmed', r.status; END IF;
  PERFORM set_config('app.fin_tx','on',true);
  UPDATE public.financial_transactions SET status='confirmed', confirmed_by=auth.uid(), confirmed_at=now() WHERE id=_id;
  PERFORM set_config('app.fin_tx','off',true);
  PERFORM public.fin__log(_id, 'confirmed', 'proposed', 'confirmed', NULL, NULL, NULL);
  RETURN 'confirmed';
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
    recognition_date = CASE WHEN basis <> 'cash' THEN coalesce(_recognition, recognition_date) END,
    cash_date = CASE WHEN basis <> 'accrual' THEN coalesce(_cash, cash_date) END
  WHERE id=_id;
  PERFORM set_config('app.fin_tx','off',true);
  PERFORM public.fin__log(_id, 'posted', 'confirmed', 'posted', NULL,
    jsonb_build_object('recognition_date',_recognition,'cash_date',_cash), NULL);
  RETURN 'posted';
END $$;

CREATE OR REPLACE FUNCTION public.fin_discard(_id uuid, _reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.financial_transactions;
BEGIN
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO r FROM public.financial_transactions WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public.fin__require(r.sensitivity);
  IF r.status = 'discarded' THEN RETURN 'already_discarded'; END IF;
  IF r.status NOT IN ('proposed','confirmed') THEN RAISE EXCEPTION 'fin_invalid_transition: posted rows must be reversed'; END IF;
  PERFORM set_config('app.fin_tx','on',true);
  UPDATE public.financial_transactions SET status='discarded', closed_by=auth.uid(), closed_at=now(), close_reason=_reason WHERE id=_id;
  PERFORM set_config('app.fin_tx','off',true);
  PERFORM public.fin__log(_id, 'discarded', r.status, 'discarded', NULL, NULL, _reason);
  RETURN 'discarded';
END $$;

CREATE OR REPLACE FUNCTION public.fin__reverse(_id uuid, _reason text, _idem text, _final text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.financial_transactions; v_mirror uuid; v_p jsonb;
BEGIN
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT id INTO v_mirror FROM public.financial_transactions WHERE idempotency_key = _idem;
  IF FOUND THEN RETURN v_mirror; END IF;
  SELECT * INTO r FROM public.financial_transactions WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public.fin__require(r.sensitivity);
  IF r.status <> 'posted' OR r.reverses_id IS NOT NULL THEN RAISE EXCEPTION 'fin_invalid_transition: only an original posted transaction can be reversed'; END IF;
  v_p := (to_jsonb(r) - ARRAY['id','status','idempotency_key','reverses_id','corrects_id'])
    || jsonb_build_object('direction', CASE WHEN r.direction = 'out' THEN 'in' ELSE 'out' END,
         'recognition_date', current_date, 'cash_date', current_date,
         'memo', 'Reversal: ' || _reason);
  v_mirror := public.fin__insert(v_p, _idem, 'posted', _id, NULL);
  PERFORM set_config('app.fin_tx','on',true);
  UPDATE public.financial_transactions SET status=_final, closed_by=auth.uid(), closed_at=now(), close_reason=_reason WHERE id=_id;
  PERFORM set_config('app.fin_tx','off',true);
  UPDATE public.financial_settlements SET status='reversed', reversed_by=auth.uid(), reversed_at=now(),
    reverse_reason='Transaction reversed: ' || _reason
  WHERE status='active' AND (obligation_id=_id OR payment_txn_id=_id);
  PERFORM public.fin__log(_id, _final, 'posted', _final, NULL, jsonb_build_object('reversal_id', v_mirror), _reason);
  PERFORM public.fin__log(v_mirror, 'reversal_created', NULL, 'posted', NULL, jsonb_build_object('reverses_id', _id), _reason);
  RETURN v_mirror;
END $$;

CREATE OR REPLACE FUNCTION public.fin_reverse(_id uuid, _reason text, _idem text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT public.fin__reverse(_id, _reason, _idem, 'reversed') $$;

CREATE OR REPLACE FUNCTION public.fin_correct(_id uuid, _p jsonb, _reason text, _idem text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new uuid;
BEGIN
  SELECT id INTO v_new FROM public.financial_transactions WHERE idempotency_key = _idem;
  IF FOUND THEN RETURN v_new; END IF;
  PERFORM public.fin__require(coalesce(_p->>'sensitivity','standard'));
  PERFORM public.fin__reverse(_id, _reason, _idem || ':reversal', 'corrected');
  v_new := public.fin__insert(_p, _idem, 'posted', NULL, _id);
  PERFORM public.fin__log(v_new, 'correction_created', NULL, 'posted', NULL, jsonb_build_object('corrects_id', _id), _reason);
  RETURN v_new;
END $$;

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
  IF p.txn_type NOT IN ('payment','financing_payment') OR p.reverses_id IS NOT NULL THEN RAISE EXCEPTION 'settle_source_not_payment'; END IF;
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

CREATE OR REPLACE FUNCTION public.fin_unsettle(_settlement uuid, _reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.financial_settlements; v_sens text;
BEGIN
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO s FROM public.financial_settlements WHERE id = _settlement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  FOR v_sens IN SELECT sensitivity FROM public.financial_transactions WHERE id IN (s.obligation_id, s.payment_txn_id) LOOP
    PERFORM public.fin__require(v_sens);
  END LOOP;
  IF s.status <> 'active' THEN RETURN 'already_reversed'; END IF;
  UPDATE public.financial_settlements SET status='reversed', reversed_by=auth.uid(), reversed_at=now(), reverse_reason=_reason WHERE id=_settlement;
  PERFORM public.fin__log(s.obligation_id, 'unsettled', NULL, NULL, NULL, jsonb_build_object('settlement_id', _settlement), _reason);
  RETURN 'reversed';
END $$;

CREATE OR REPLACE FUNCTION public.fin_add_evidence(_id uuid, _e jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sens text; v_id uuid;
BEGIN
  SELECT sensitivity INTO v_sens FROM public.financial_transactions WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public.fin__require(v_sens);
  INSERT INTO public.financial_transaction_evidence(transaction_id, document_id, import_item_id, service_transaction_id, page, raw_text, field, confidence, created_by)
  VALUES (_id, (_e->>'document_id')::uuid, (_e->>'import_item_id')::uuid, (_e->>'service_transaction_id')::uuid,
          (_e->>'page')::int, _e->>'raw_text', _e->>'field', _e->>'confidence', auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.fin__log(_id, 'evidence_added', NULL, NULL, NULL, _e, NULL);
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.fin__require(text), public.fin__log(uuid,text,text,text,jsonb,jsonb,text),
  public.fin__insert(jsonb,text,text,uuid,uuid), public.fin__reverse(uuid,text,text,text),
  public.fin_txn_guard(), public.fin_append_only(), public.fin_settlement_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fin_propose(jsonb,text), public.fin_confirm(uuid), public.fin_post(uuid,date,date),
  public.fin_discard(uuid,text), public.fin_reverse(uuid,text,text), public.fin_correct(uuid,jsonb,text,text),
  public.fin_settle(uuid,uuid,numeric,text), public.fin_unsettle(uuid,text), public.fin_add_evidence(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_propose(jsonb,text), public.fin_confirm(uuid), public.fin_post(uuid,date,date),
  public.fin_discard(uuid,text), public.fin_reverse(uuid,text,text), public.fin_correct(uuid,jsonb,text,text),
  public.fin_settle(uuid,uuid,numeric,text), public.fin_unsettle(uuid,text), public.fin_add_evidence(uuid,jsonb) TO authenticated, service_role;

COMMENT ON TABLE public.financial_transactions IS 'Canonical ledger (Step C1). Writes only via fin_* functions; posted rows immutable; accrual = basis<>cash by recognition_date, cash = basis<>accrual by cash_date.';