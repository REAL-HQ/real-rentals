-- PROPOSED ONLY. Runner owns transaction and journal/receipt. Never auto-discovered.
-- Requires existing rentals/payments/refunds and apply_payment_refund; no ledger replacement.
CREATE TABLE public.stripe_rental_links (
 environment text NOT NULL CHECK(environment IN ('sandbox','live')),
 subscription_id text NOT NULL, rental_id uuid NOT NULL REFERENCES public.rentals(id),
 customer_id text NOT NULL, linked_by uuid NOT NULL REFERENCES auth.users(id),
 provider_canceled boolean NOT NULL DEFAULT false, linked_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL CHECK(length(reason) BETWEEN 8 AND 500),
 PRIMARY KEY(environment,subscription_id)
);
CREATE TABLE public.stripe_operations (
 rental_id uuid PRIMARY KEY REFERENCES public.rentals(id), environment text NOT NULL CHECK(environment IN ('sandbox','live')),
 operation_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 state text NOT NULL CHECK(state IN ('pending','created','failed','review')),
 parameters jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 cancellation_state text CHECK(cancellation_state IN ('requested','failed','confirmed','unknown')),
 cancellation_attempted_at timestamptz, error_code text
);
CREATE TABLE public.stripe_event_receipts (
 environment text NOT NULL CHECK(environment IN ('sandbox','live')), event_id text NOT NULL,
 object_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('subscription','invoice','payment')),
 state text NOT NULL DEFAULT 'unmatched' CHECK(state IN ('unmatched','review','processed')),
 reason text, snapshot jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,event_id)
);
ALTER TABLE public.payments ADD COLUMN stripe_verified_at timestamptz;
ALTER TABLE public.payments ADD COLUMN stripe_collection_reference text;
ALTER TABLE public.payments ADD COLUMN stripe_environment text CHECK(stripe_environment IN ('sandbox','live'));
-- Reuse existing unique subscription, invoice and PI indexes. Assert before installing.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='rentals' AND indexdef LIKE 'CREATE UNIQUE INDEX%stripe_subscription_id%')
 OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='payments' AND indexdef LIKE 'CREATE UNIQUE INDEX%stripe_invoice_id%')
 THEN RAISE EXCEPTION 'Missing existing Stripe uniqueness constraints'; END IF;
END $$;
ALTER TABLE public.stripe_rental_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_event_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_rental_links,public.stripe_operations,public.stripe_event_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.stripe_rental_links,public.stripe_operations,public.stripe_event_receipts TO authenticated;
GRANT ALL ON public.stripe_rental_links,public.stripe_operations,public.stripe_event_receipts TO service_role;
CREATE POLICY stripe_links_manager ON public.stripe_rental_links FOR SELECT TO authenticated USING (private.is_manager());
CREATE POLICY stripe_ops_manager ON public.stripe_operations FOR SELECT TO authenticated USING (private.is_manager());
CREATE POLICY stripe_receipts_manager ON public.stripe_event_receipts FOR SELECT TO authenticated USING (private.is_manager());

CREATE FUNCTION public.stripe_assert_manager(_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF _actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text IN ('admin','team')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.stripe_assert_manager(uuid) FROM PUBLIC,anon,authenticated;

-- Verification can only be written by the owner of the definer ingestion function.
CREATE FUNCTION public.stripe_guard_verification() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (NEW.stripe_verified_at IS NOT NULL OR NEW.stripe_environment IS NOT NULL OR (TG_OP='UPDATE' AND OLD.stripe_verified_at IS NOT NULL)) AND current_user <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.stripe_ingest(text,text,jsonb)'::regprocedure)) THEN
  IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Provider verification is server owned';
  ELSIF NEW.stripe_verified_at IS DISTINCT FROM OLD.stripe_verified_at OR NEW.stripe_environment IS DISTINCT FROM OLD.stripe_environment OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.stripe_invoice_id IS DISTINCT FROM OLD.stripe_invoice_id OR NEW.stripe_collection_reference IS DISTINCT FROM OLD.stripe_collection_reference OR NEW.type IS DISTINCT FROM OLD.type OR NEW.driver_id IS DISTINCT FROM OLD.driver_id OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id OR NEW.status IS DISTINCT FROM OLD.status OR NEW.refunded_amount IS DISTINCT FROM OLD.refunded_amount OR NEW.paid_date IS DISTINCT FROM OLD.paid_date OR NEW.balance_due IS DISTINCT FROM OLD.balance_due OR NEW.rental_id IS DISTINCT FROM OLD.rental_id OR NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id THEN RAISE EXCEPTION 'Verified payment is protected'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.stripe_link(_env text,_sub text,_customer text,_rental uuid,_actor uuid,_reason text,_confirmed_customer text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.rentals; l public.stripe_rental_links;
BEGIN
 PERFORM public.stripe_assert_manager(_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended(_env||':'||_sub,0));
 SELECT * INTO r FROM public.rentals WHERE id=_rental FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rental missing'; END IF;
 IF r.stripe_customer_id IS DISTINCT FROM _customer AND _confirmed_customer IS DISTINCT FROM _customer THEN RAISE EXCEPTION 'Explicit external customer confirmation required'; END IF;
 SELECT * INTO l FROM public.stripe_rental_links WHERE environment=_env AND subscription_id=_sub;
 IF FOUND THEN
  IF l.rental_id<>_rental OR l.customer_id<>_customer THEN RAISE EXCEPTION 'Subscription already linked elsewhere'; END IF;
  RETURN;
 END IF;
 IF r.stripe_subscription_id IS NOT NULL AND r.stripe_subscription_id<>_sub THEN RAISE EXCEPTION 'Rental already has another subscription'; END IF;
 INSERT INTO public.stripe_rental_links(environment,subscription_id,rental_id,customer_id,linked_by,reason) VALUES(_env,_sub,_rental,_customer,_actor,_reason);
 UPDATE public.rentals SET stripe_subscription_id=_sub WHERE id=_rental;
END $$;

CREATE FUNCTION public.stripe_claim_creation(_rental uuid,_env text,_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.rentals; o public.stripe_operations;
BEGIN
 PERFORM public.stripe_assert_manager(_actor);
 SELECT * INTO r FROM public.rentals WHERE id=_rental FOR UPDATE;
 IF NOT FOUND OR r.stripe_subscription_id IS NOT NULL THEN RAISE EXCEPTION 'Rental unavailable or already subscribed'; END IF;
 SELECT * INTO o FROM public.stripe_operations WHERE rental_id=_rental FOR UPDATE;
 IF FOUND THEN
  IF o.environment<>_env OR o.created_at<now()-interval '23 hours' OR o.state NOT IN ('pending','failed') THEN RAISE EXCEPTION 'Creation requires staff reconciliation; no new provider request'; END IF;
  RETURN to_jsonb(o);
 END IF;
 IF r.stripe_customer_id IS NULL OR r.stripe_payment_method_id IS NULL OR r.weekly_rate<=0 THEN RAISE EXCEPTION 'Missing verified billing configuration'; END IF;
 INSERT INTO public.stripe_operations(rental_id,environment,state,parameters) VALUES(_rental,_env,'pending',jsonb_build_object(
 'customer',r.stripe_customer_id,'payment_method',r.stripe_payment_method_id,'cents',round(r.weekly_rate*100)::bigint)) RETURNING * INTO o;
 RETURN to_jsonb(o);
END $$;
CREATE FUNCTION public.stripe_finish_creation(_rental uuid,_op uuid,_sub text,_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.stripe_operations;
BEGIN
 PERFORM 1 FROM public.rentals WHERE id=_rental FOR UPDATE;
 SELECT * INTO o FROM public.stripe_operations WHERE rental_id=_rental AND operation_id=_op FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation mismatch'; END IF;
 PERFORM public.stripe_link(o.environment,_sub,o.parameters->>'customer',_rental,_actor,'Application subscription creation');
 UPDATE public.stripe_operations SET state='created',error_code=NULL WHERE rental_id=_rental;
 UPDATE public.rentals SET autopay_active=true WHERE id=_rental;
END $$;
-- Each request and terminal outcome is an immutable event, not a mutable audit row.
CREATE TABLE public.stripe_cancellation_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 attempt_id uuid NOT NULL, retry_of uuid,
 operation_id uuid NOT NULL REFERENCES public.stripe_operations(operation_id),
 rental_id uuid NOT NULL REFERENCES public.rentals(id),
 environment text NOT NULL CHECK(environment IN ('sandbox','live')),
 subscription_id text NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 requested_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 outcome text NOT NULL CHECK(outcome IN ('requested','confirmed','failed','unknown')),
 evidence text CHECK(evidence IN ('provider_canceled','provider_rejected','provider_unverified')),
 error_code text CHECK(error_code IN ('provider_rejected','provider_unverified')),
 UNIQUE(attempt_id,outcome)
);
CREATE INDEX stripe_cancellation_history_operation ON public.stripe_cancellation_history(operation_id,id DESC);
ALTER TABLE public.stripe_cancellation_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_cancellation_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.stripe_cancellation_history TO authenticated,service_role;
CREATE POLICY stripe_cancel_history_manager ON public.stripe_cancellation_history FOR SELECT TO authenticated USING(private.is_manager());
CREATE FUNCTION public.stripe_history_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Cancellation history is append only'; END $$;
CREATE TRIGGER stripe_history_no_changes BEFORE UPDATE OR DELETE ON public.stripe_cancellation_history FOR EACH ROW EXECUTE FUNCTION public.stripe_history_immutable();
CREATE TRIGGER stripe_history_no_truncate BEFORE TRUNCATE ON public.stripe_cancellation_history FOR EACH STATEMENT EXECUTE FUNCTION public.stripe_history_immutable();
REVOKE ALL ON FUNCTION public.stripe_history_immutable() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.stripe_cancel_state(_rental uuid,_env text,_sub text,_state text,_actor uuid,
 _attempt uuid DEFAULT NULL,_evidence text DEFAULT NULL,_error text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.rentals; o public.stripe_operations; h public.stripe_cancellation_history; attempt uuid; parent uuid;
BEGIN
 PERFORM public.stripe_assert_manager(_actor);
 IF _state IS NULL OR _state NOT IN ('requested','failed','confirmed','unknown') THEN RAISE EXCEPTION 'Invalid cancellation state'; END IF;
 SELECT * INTO r FROM public.rentals WHERE id=_rental FOR UPDATE;
 IF NOT FOUND OR r.stripe_subscription_id IS DISTINCT FROM _sub THEN RAISE EXCEPTION 'Subscription changed'; END IF;
 INSERT INTO public.stripe_operations(rental_id,environment,state,parameters) VALUES(_rental,_env,'review','{}') ON CONFLICT DO NOTHING;
 SELECT * INTO o FROM public.stripe_operations WHERE rental_id=_rental FOR UPDATE;
 IF o.environment<>_env THEN RAISE EXCEPTION 'Environment mismatch'; END IF;
 IF _state='requested' THEN
  IF _attempt IS NOT NULL OR _evidence IS NOT NULL OR _error IS NOT NULL THEN RAISE EXCEPTION 'Invalid request'; END IF;
  attempt:=gen_random_uuid();
  SELECT attempt_id INTO parent FROM public.stripe_cancellation_history WHERE operation_id=o.operation_id AND outcome='requested' ORDER BY id DESC LIMIT 1;
  INSERT INTO public.stripe_cancellation_history(attempt_id,retry_of,operation_id,rental_id,environment,subscription_id,actor_user_id,requested_at,outcome)
   VALUES(attempt,parent,o.operation_id,_rental,_env,_sub,_actor,clock_timestamp(),'requested') RETURNING * INTO h;
 ELSE
  SELECT * INTO h FROM public.stripe_cancellation_history WHERE attempt_id=_attempt AND outcome='requested';
  IF NOT FOUND OR h.operation_id<>o.operation_id OR h.actor_user_id<>_actor OR h.subscription_id<>_sub THEN RAISE EXCEPTION 'Attempt mismatch'; END IF;
  IF _state='confirmed' AND (_evidence IS DISTINCT FROM 'provider_canceled' OR _error IS NOT NULL)
   OR _state='failed' AND (_evidence IS DISTINCT FROM 'provider_rejected' OR _error IS DISTINCT FROM 'provider_rejected')
   OR _state='unknown' AND (_evidence IS DISTINCT FROM 'provider_unverified' OR _error IS DISTINCT FROM 'provider_unverified') THEN RAISE EXCEPTION 'Outcome evidence required'; END IF;
  IF EXISTS(SELECT 1 FROM public.stripe_cancellation_history WHERE attempt_id=_attempt AND outcome<>'requested') THEN
   IF EXISTS(SELECT 1 FROM public.stripe_cancellation_history WHERE attempt_id=_attempt AND outcome=_state) THEN RETURN jsonb_build_object('attempt_id',_attempt); END IF;
   RAISE EXCEPTION 'Attempt already completed';
  END IF;
  attempt:=_attempt;
  INSERT INTO public.stripe_cancellation_history(attempt_id,retry_of,operation_id,rental_id,environment,subscription_id,actor_user_id,requested_at,outcome,evidence,error_code)
   VALUES(attempt,h.retry_of,o.operation_id,_rental,_env,_sub,_actor,h.requested_at,_state,_evidence,_error);
 END IF;
 -- Confirmed is terminal; a late response cannot turn billing back on.
 UPDATE public.stripe_operations SET cancellation_state=CASE WHEN cancellation_state='confirmed' THEN 'confirmed' ELSE _state END,
 cancellation_attempted_at=clock_timestamp(),error_code=CASE WHEN cancellation_state='confirmed' THEN NULL ELSE _error END WHERE rental_id=_rental;
 IF _state='confirmed' THEN
  UPDATE public.rentals SET autopay_active=false WHERE id=_rental;
  UPDATE public.stripe_rental_links SET provider_canceled=true WHERE environment=_env AND subscription_id=_sub;
 END IF;
 RETURN jsonb_build_object('attempt_id',attempt);
END $$;

-- Snapshot is minimized and retrieved server-side from the pinned Stripe account.
-- Receipt and payment/refund update are one transaction, including replay.
CREATE FUNCTION public.stripe_ingest(_env text,_event text,_s jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l public.stripe_rental_links; r public.rentals; p public.payments; receipt public.stripe_event_receipts;
 pid uuid; v_reason text; gross numeric; ra numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(_env||':'||coalesce(_s->>'subscription_id',_s->>'id'),0));
 INSERT INTO public.stripe_event_receipts(environment,event_id,object_id,kind,snapshot) VALUES(_env,_event,_s->>'id',_s->>'kind',_s)
 ON CONFLICT DO NOTHING;
 SELECT * INTO receipt FROM public.stripe_event_receipts WHERE environment=_env AND event_id=_event FOR UPDATE;
 IF receipt.object_id IS DISTINCT FROM _s->>'id' OR receipt.kind IS DISTINCT FROM _s->>'kind' THEN RAISE EXCEPTION 'Event identity conflict'; END IF;
 IF _s->>'kind'='payment' THEN
  gross:=(_s->>'paid_cents')::numeric/100; ra:=(_s->>'refunded_cents')::numeric/100;
  IF _s->>'review_reason' IS NOT NULL OR _s->>'currency'<>'usd' OR gross<=0 OR ra<0 OR ra>gross THEN
   v_reason:=coalesce(_s->>'review_reason','unverified_payment');
  ELSE
   PERFORM 1 FROM public.payments WHERE id IN (SELECT jsonb_array_elements_text(_s->'payment_ids')::uuid) ORDER BY id FOR UPDATE;
   IF (SELECT count(*) FROM public.payments WHERE id IN (SELECT jsonb_array_elements_text(_s->'payment_ids')::uuid)) <> jsonb_array_length(_s->'payment_ids')
    OR jsonb_array_length(_s->'payment_ids')=0
    OR EXISTS(SELECT 1 FROM public.payments p0 LEFT JOIN public.rentals r0 ON r0.id=p0.rental_id WHERE p0.id IN (SELECT jsonb_array_elements_text(_s->'payment_ids')::uuid) AND
     (r0.stripe_customer_id IS DISTINCT FROM _s->>'customer_id' OR p0.stripe_invoice_id IS NOT NULL OR (p0.stripe_payment_intent_id IS NOT NULL AND p0.stripe_payment_intent_id<>_s->>'id') OR (p0.stripe_collection_reference IS NOT NULL AND p0.stripe_collection_reference<>_s->>'id') OR (p0.stripe_environment IS NOT NULL AND p0.stripe_environment<>_env)))
    OR (SELECT sum(amount) FROM public.payments WHERE id IN (SELECT jsonb_array_elements_text(_s->'payment_ids')::uuid)) IS DISTINCT FROM gross THEN
    v_reason:='payment_association_requires_review';
   ELSE
    UPDATE public.payments SET status=CASE WHEN status='refunded' THEN status ELSE 'paid' END,balance_due=0,paid_date=(_s->>'paid_date')::date,stripe_collection_reference=_s->>'id',stripe_verified_at=now(),stripe_environment=_env
     WHERE id IN (SELECT jsonb_array_elements_text(_s->'payment_ids')::uuid);
    PERFORM public.apply_payment_refund(ARRAY(SELECT jsonb_array_elements_text(_s->'payment_ids')::uuid),ra,coalesce(_s->'refunds','[]'::jsonb),_s->>'charge_id',_s->>'id');
   END IF;
  END IF;
  UPDATE public.stripe_event_receipts SET state=CASE WHEN v_reason IS NULL THEN 'processed' ELSE 'review' END,reason=v_reason,snapshot=_s,updated_at=now() WHERE environment=_env AND event_id=_event;
  RETURN jsonb_build_object('state',CASE WHEN v_reason IS NULL THEN 'processed' ELSE 'review' END);
 END IF;
 SELECT * INTO l FROM public.stripe_rental_links WHERE environment=_env AND subscription_id=_s->>'subscription_id';
 IF NOT FOUND THEN v_reason:='unmatched_subscription';
 ELSIF l.customer_id IS DISTINCT FROM _s->>'customer_id' THEN v_reason:='customer_mismatch';
 ELSIF _s->>'review_reason' IS NOT NULL THEN v_reason:=_s->>'review_reason'; END IF;
 IF v_reason IS NOT NULL THEN
  UPDATE public.stripe_event_receipts SET state=CASE WHEN v_reason='unmatched_subscription' THEN 'unmatched' ELSE 'review' END,reason=v_reason,snapshot=_s,updated_at=now() WHERE environment=_env AND event_id=_event;
  RETURN jsonb_build_object('state','review','reason',v_reason);
 END IF;
 SELECT * INTO r FROM public.rentals WHERE id=l.rental_id FOR UPDATE;
 IF _s->>'kind'='subscription' THEN
  IF _s->>'status'='canceled' THEN UPDATE public.stripe_rental_links SET provider_canceled=true WHERE environment=_env AND subscription_id=l.subscription_id; END IF;
  -- Current provider state is re-fetched on each delivery; canceled is terminal.
  UPDATE public.rentals SET autopay_active=CASE WHEN l.provider_canceled OR (_s->>'status')='canceled' THEN false ELSE (_s->>'status') IN ('active','trialing') END
   WHERE id=r.id AND stripe_subscription_id=l.subscription_id;
 ELSE
  gross:=(_s->>'paid_cents')::numeric/100; ra:=(_s->>'refunded_cents')::numeric/100;
  IF _s->>'currency'<>'usd' OR gross<0 OR ra<0 OR ra>gross THEN RAISE EXCEPTION 'Invalid provider amounts'; END IF;
  SELECT * INTO p FROM public.payments WHERE stripe_invoice_id=_s->>'id' FOR UPDATE;
  IF FOUND AND (p.rental_id IS DISTINCT FROM r.id OR (p.stripe_payment_intent_id IS NOT NULL AND p.stripe_payment_intent_id IS DISTINCT FROM _s->>'payment_intent_id') OR (p.stripe_environment IS NOT NULL AND p.stripe_environment<>_env)) THEN RAISE EXCEPTION 'Invoice association conflict'; END IF;
  IF _s->>'status'='paid' THEN
   IF gross<=0 OR _s->>'payment_intent_id' IS NULL THEN RAISE EXCEPTION 'No verified Stripe collection'; END IF;
   IF p.id IS NOT NULL AND p.status IN ('paid','refunded') AND p.amount<>gross THEN RAISE EXCEPTION 'Existing amount mismatch requires review'; END IF;
   IF p.id IS NULL THEN
    INSERT INTO public.payments(rental_id,driver_id,vehicle_id,type,reason,amount,balance_due,status,due_date,paid_date,stripe_invoice_id,stripe_subscription_id,stripe_payment_intent_id,stripe_verified_at,stripe_environment)
    VALUES(r.id,r.application_id,r.vehicle_id,'rent','rent',gross,0,'paid',(_s->>'due_date')::date,(_s->>'paid_date')::date,_s->>'id',l.subscription_id,_s->>'payment_intent_id',now(),_env) RETURNING id INTO pid;
   ELSE
    pid:=p.id;
    UPDATE public.payments SET amount=gross,balance_due=0,status=CASE WHEN status='refunded' THEN status ELSE 'paid' END,paid_date=(_s->>'paid_date')::date,
      stripe_payment_intent_id=_s->>'payment_intent_id',stripe_verified_at=now(),stripe_environment=_env WHERE id=pid;
   END IF;
   PERFORM public.apply_payment_refund(ARRAY[pid],ra,coalesce(_s->'refunds','[]'::jsonb),_s->>'charge_id',_s->>'payment_intent_id');
  ELSE
   IF p.id IS NULL THEN
    INSERT INTO public.payments(rental_id,driver_id,vehicle_id,type,reason,amount,balance_due,status,due_date,stripe_invoice_id,stripe_subscription_id,stripe_environment)
    VALUES(r.id,r.application_id,r.vehicle_id,'rent','rent',(_s->>'due_cents')::numeric/100,(_s->>'due_cents')::numeric/100,'failed',(_s->>'due_date')::date,_s->>'id',l.subscription_id,_env);
   END IF; -- Never un-pay on old failure.
  END IF;
 END IF;
 UPDATE public.stripe_event_receipts SET state='processed',reason=NULL,snapshot=_s,updated_at=now() WHERE environment=_env AND event_id=_event;
 RETURN jsonb_build_object('state','processed');
END $$;
CREATE TRIGGER stripe_verified_guard BEFORE INSERT OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.stripe_guard_verification();

-- STABLE SQL statement uses one MVCC snapshot for all totals and issue counts.
CREATE FUNCTION public.stripe_report(_from date,_to date,_prior_from date,_prior_to date,_env text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.stripe_assert_manager(auth.uid());
 IF _from>_to OR _prior_from>_prior_to THEN RAISE EXCEPTION 'Invalid report dates'; END IF;
 WITH eligible AS (
  SELECT * FROM public.payments WHERE stripe_verified_at IS NOT NULL AND stripe_environment=_env
 ), totals AS (
 SELECT coalesce(sum(net_collected) FILTER(WHERE type IN ('rent','late_fee','other','toll','damage','fee') AND paid_date BETWEEN _from AND _to),0) revenue,
 coalesce(sum(net_collected) FILTER(WHERE type IN ('rent','late_fee','other','toll','damage','fee') AND paid_date BETWEEN _prior_from AND _prior_to),0) prior,
 coalesce(sum(refunded_amount) FILTER(WHERE type<>'deposit' AND paid_date BETWEEN _from AND _to),0) refunds,
 coalesce(sum(net_collected) FILTER(WHERE type='deposit' AND paid_date BETWEEN _from AND _to),0) deposits
 FROM eligible WHERE status IN ('paid','refunded')
 ), weeks AS (
 SELECT d::date AS week_day,coalesce(sum(p.net_collected) FILTER(WHERE p.status IN ('paid','refunded')),0) collected
 FROM generate_series(date_trunc('week',_to::timestamp + interval '1 day')-interval '1 day 11 weeks',date_trunc('week',_to::timestamp+interval '1 day')-interval '1 day',interval '1 week') d
 LEFT JOIN eligible p ON p.paid_date>=d::date AND p.paid_date<d::date+7 AND p.type IN ('rent','late_fee','other','toll','damage','fee') GROUP BY d
 ) SELECT jsonb_build_object('revenue',revenue,'prior',prior,'refunds',refunds,'deposits',deposits,'fees',NULL,'payouts',NULL,
 'outstanding',(SELECT coalesce(sum(coalesce(balance_due,amount)),0) FROM public.payments WHERE status IN ('late','past_due','collections','overdue','failed','unpaid') AND due_date<=_to AND (stripe_environment IS NULL OR stripe_environment=_env)),
 'unmatched',(SELECT count(*) FROM public.stripe_event_receipts WHERE environment=_env AND state<>'processed'),
 'unverified',(SELECT count(*) FROM public.payments WHERE stripe_verified_at IS NULL AND status IN ('paid','refunded')),
 'weekly',(SELECT jsonb_agg(jsonb_build_object('day',week_day,'collected',collected,'billed',(SELECT coalesce(sum(b.amount),0) FROM public.payments b WHERE b.due_date>=week_day AND b.due_date<week_day+7 AND b.type IN ('rent','late_fee','other','toll','damage','fee') AND b.status NOT IN ('void','waived','cancelled'))) ORDER BY week_day) FROM weeks)) INTO result FROM totals;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.stripe_report(date,date,date,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stripe_report(date,date,date,date,text) TO authenticated;
REVOKE ALL ON FUNCTION public.stripe_link(text,text,text,uuid,uuid,text,text),public.stripe_claim_creation(uuid,text,uuid),public.stripe_finish_creation(uuid,uuid,text,uuid),public.stripe_cancel_state(uuid,text,text,text,uuid,uuid,text,text),public.stripe_ingest(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_link(text,text,text,uuid,uuid,text,text),public.stripe_claim_creation(uuid,text,uuid),public.stripe_finish_creation(uuid,uuid,text,uuid),public.stripe_cancel_state(uuid,text,text,text,uuid,uuid,text,text),public.stripe_ingest(text,text,jsonb) TO service_role;
