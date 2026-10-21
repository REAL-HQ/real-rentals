-- LOCAL PROPOSAL. Install only after the reviewed safe-release contracts; no automatic migrations.
CREATE TABLE private.rental_subscription_operations_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid NOT NULL REFERENCES public.rentals(id),
 actor_id uuid NOT NULL, session_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('start','stop')),
 account text NOT NULL, environment text NOT NULL CHECK(environment IN ('live','sandbox')),
 snapshot jsonb NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), result jsonb
);
CREATE UNIQUE INDEX rental_subscription_pending_v1 ON private.rental_subscription_operations_v1(rental_id) WHERE state='pending';
ALTER TABLE private.rental_subscription_operations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.rental_subscription_operations_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.subscription_actor_v1(actor uuid, sess uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM auth.sessions WHERE id=sess AND user_id=actor AND (not_after IS NULL OR not_after>clock_timestamp()) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'session_revoked'; END IF;
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role::text='admin' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'owner_required'; END IF;
END $$;
-- Reject all lifecycle/linkage edits while an external operation is unresolved. Never wait
-- for the global lock from a row trigger: direct UPDATE already owns the row lock.
CREATE FUNCTION private.subscription_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF ROW(NEW.application_id,NEW.status,NEW.vehicle_id,NEW.driver_id,NEW.weekly_rate,NEW.start_date,NEW.stripe_customer_id,NEW.stripe_payment_method_id,NEW.stripe_subscription_id,NEW.autopay_active)
 IS DISTINCT FROM ROW(OLD.application_id,OLD.status,OLD.vehicle_id,OLD.driver_id,OLD.weekly_rate,OLD.start_date,OLD.stripe_customer_id,OLD.stripe_payment_method_id,OLD.stripe_subscription_id,OLD.autopay_active) THEN
  IF NOT pg_try_advisory_xact_lock(710026,2) THEN RAISE EXCEPTION 'subscription_lifecycle_busy'; END IF;
  IF EXISTS(SELECT 1 FROM private.rental_subscription_operations_v1 WHERE rental_id=OLD.id AND state='pending') THEN RAISE EXCEPTION 'subscription_operation_unresolved'; END IF;
 END IF;
 RETURN NEW;
END $$;
-- SECURITY DEFINER for private journal lookup only; no client-controlled bypass setting.
ALTER FUNCTION private.subscription_guard_v1() SECURITY DEFINER;
CREATE TRIGGER subscription_guard_v1 BEFORE UPDATE ON public.rentals FOR EACH ROW EXECUTE FUNCTION private.subscription_guard_v1();
CREATE FUNCTION public.rental_subscription_begin_v1(rental uuid, actor uuid, sess uuid, action text, account text, environment text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rentals%ROWTYPE; op private.rental_subscription_operations_v1%ROWTYPE; snap jsonb; customer text; method text;
BEGIN
 PERFORM pg_advisory_xact_lock(710026,2);
 SELECT * INTO r FROM public.rentals WHERE id=rental FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'rental_missing'; END IF;
 PERFORM private.subscription_actor_v1(actor,sess);
 IF action NOT IN ('start','stop') OR account IS NULL OR account='' OR environment NOT IN ('sandbox','live') THEN RAISE EXCEPTION 'invalid_scope'; END IF;
 SELECT * INTO op FROM private.rental_subscription_operations_v1 WHERE rental_id=rental AND state='pending';
 IF FOUND THEN
  IF ROW(op.actor_id,op.session_id,op.action,op.account,op.environment) IS DISTINCT FROM ROW(actor,sess,action,account,environment) THEN RAISE EXCEPTION 'operation_conflict'; END IF;
  -- Never recreate after Stripe's idempotency retention window. Needs explicit reconciliation.
  IF op.created_at < clock_timestamp()-interval '23 hours' THEN RAISE EXCEPTION 'provider_reconciliation_required'; END IF;
  RETURN to_jsonb(op);
 END IF;
 IF action='start' AND r.status::text<>'active' THEN RAISE EXCEPTION 'rental_not_active'; END IF;
 IF action='start' AND r.stripe_subscription_id IS NOT NULL THEN
  SELECT * INTO op FROM private.rental_subscription_operations_v1 o WHERE o.rental_id=rental AND o.state='complete' AND o.action='start' AND o.actor_id=actor AND o.session_id=sess AND o.account=rental_subscription_begin_v1.account AND o.environment=rental_subscription_begin_v1.environment AND o.result->>'subscriptionId'=r.stripe_subscription_id ORDER BY o.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Autopay already active'; END IF;
  RETURN jsonb_build_object('state','complete','result',op.result);
 END IF;
 IF action='stop' AND r.stripe_subscription_id IS NULL THEN RETURN jsonb_build_object('state','complete','result',jsonb_build_object('ok',true)); END IF;
 customer:=r.stripe_customer_id;method:=r.stripe_payment_method_id;
 IF action='start' AND (customer IS NULL OR method IS NULL) THEN
  SELECT stripe_customer_id,stripe_payment_method_id INTO customer,method FROM public.applications WHERE id=r.application_id FOR SHARE;
 END IF;
 IF customer IS NULL OR (action='start' AND (method IS NULL OR r.weekly_rate IS NULL OR r.weekly_rate<=0)) THEN RAISE EXCEPTION 'billing_evidence_missing'; END IF;
 snap:=jsonb_build_object('status',r.status,'customer',customer,'paymentMethod',method,'subscription',r.stripe_subscription_id,'amount',round(r.weekly_rate*100),'start',greatest(extract(epoch FROM r.start_date::timestamptz)::bigint,extract(epoch FROM clock_timestamp())::bigint+60));
 INSERT INTO private.rental_subscription_operations_v1(rental_id,actor_id,session_id,action,account,environment,snapshot) VALUES(rental,actor,sess,action,account,environment,snap) RETURNING * INTO op;
 RETURN to_jsonb(op);
END $$;
CREATE FUNCTION public.rental_subscription_finish_v1(operation uuid, actor uuid, sess uuid, account text, environment text, subscription text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op private.rental_subscription_operations_v1%ROWTYPE;r public.rentals%ROWTYPE;outcome jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(710026,2);
 SELECT * INTO op FROM private.rental_subscription_operations_v1 WHERE id=operation;
 IF NOT FOUND THEN RAISE EXCEPTION 'operation_missing'; END IF;
 SELECT * INTO r FROM public.rentals WHERE id=op.rental_id FOR UPDATE;
 PERFORM private.subscription_actor_v1(actor,sess);
 IF ROW(op.actor_id,op.session_id,op.account,op.environment) IS DISTINCT FROM ROW(actor,sess,account,environment) THEN RAISE EXCEPTION 'operation_conflict'; END IF;
 IF op.state='complete' THEN RETURN op.result; END IF;
 IF r.status::text IS DISTINCT FROM op.snapshot->>'status' OR r.stripe_subscription_id IS DISTINCT FROM op.snapshot->>'subscription' THEN RAISE EXCEPTION 'rental_changed'; END IF;
 IF op.action='start' AND (subscription IS NULL OR subscription='') THEN RAISE EXCEPTION 'subscription_missing'; END IF;
 IF op.action='stop' AND subscription IS DISTINCT FROM op.snapshot->>'subscription' THEN RAISE EXCEPTION 'subscription_mismatch'; END IF;
 outcome:=jsonb_build_object('ok',true,'subscriptionId',CASE WHEN op.action='start' THEN subscription ELSE NULL END);
 UPDATE private.rental_subscription_operations_v1 SET state='complete',result=outcome WHERE id=op.id;
 UPDATE public.rentals SET stripe_subscription_id=CASE WHEN op.action='start' THEN subscription ELSE NULL END,autopay_active=(op.action='start'),stripe_customer_id=op.snapshot->>'customer',stripe_payment_method_id=coalesce(op.snapshot->>'paymentMethod',stripe_payment_method_id) WHERE id=r.id;
 RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION private.subscription_actor_v1(uuid,uuid),private.subscription_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text),public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
-- Existing server-admin transport only; browser cannot attest provider success.
GRANT EXECUTE ON FUNCTION public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text),public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text) TO service_role;
