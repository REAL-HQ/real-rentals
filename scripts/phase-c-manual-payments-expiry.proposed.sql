-- PROPOSED ONLY — DO NOT APPLY. Addendum to phase-c-manual-payments.proposed.sql.
-- Migration number assigned only after Codex's 0022 is approved/applied and the journal is reconciled.

ALTER TABLE public.payment_collections DROP CONSTRAINT IF EXISTS payment_collections_status_check;
ALTER TABLE public.payment_collections
  ADD CONSTRAINT payment_collections_status_check CHECK (status IN ('pending','verified','rejected','reversed','expired')),
  ADD COLUMN expires_at timestamptz NOT NULL DEFAULT now() + interval '48 hours',
  ADD COLUMN expired_at timestamptz,
  ADD COLUMN extended_count int NOT NULL DEFAULT 0;
CREATE INDEX payment_collections_pending_expiry ON public.payment_collections (expires_at) WHERE status = 'pending';

-- Reservation = pending AND expires_at > now(): correct even if the sweep is late.
-- collection_record / collection_verify compute v_pending with that predicate under
-- SELECT ... FOR UPDATE on the payments row (atomic balance + allocation recheck);
-- collection_verify refuses when expires_at <= now().

CREATE FUNCTION public.collection_expire_due() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH e AS (
    UPDATE public.payment_collections SET status='expired', expired_at=now()
    WHERE status='pending' AND expires_at <= now() RETURNING id)
  INSERT INTO public.audit_log(entity, entity_id, action, details)
  SELECT 'payment_collection', id, 'expired', jsonb_build_object('reason','48-hour verification deadline passed') FROM e;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n; -- no cash, revenue, ledger or Stripe effect
END $$;
REVOKE ALL ON FUNCTION public.collection_expire_due() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.collection_extend(_id uuid, _reason text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.payment_collections; v timestamptz := now() + interval '48 hours';
BEGIN
  IF NOT private.is_owner() THEN RAISE EXCEPTION 'Only the Owner can extend a deadline' USING ERRCODE='42501'; END IF;
  IF coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO r FROM public.payment_collections WHERE id=_id FOR UPDATE;
  IF r.status NOT IN ('pending','expired') THEN RAISE EXCEPTION 'Payment record is %', r.status; END IF;
  -- Re-reserving an expired row rechecks availability under the charge lock (same as record).
  UPDATE public.payment_collections SET status='pending', expires_at=v, expired_at=NULL, extended_count=extended_count+1 WHERE id=_id;
  INSERT INTO public.audit_log(entity, entity_id, action, actor_id, details)
  VALUES ('payment_collection', _id, 'deadline_extended', auth.uid(), jsonb_build_object('reason',_reason,'new_deadline',v,'previous',r.expires_at));
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.collection_extend(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collection_extend(uuid,text) TO authenticated;

-- Scheduler (runs with nobody online): pg_cron every 5 minutes.
-- SELECT cron.schedule('manual-payments-expiry', '*/5 * * * *', $$SELECT public.collection_expire_due()$$);
