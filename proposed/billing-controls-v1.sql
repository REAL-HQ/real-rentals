-- PROPOSED ONLY. This file is not a migration and must not be run from this work.
-- Do not copy it into drizzle/migrations or supabase/migrations.
-- Do not run it on a hosted database.
--
-- Billing-day apply and one-invoice extensions need a journal that does not
-- reuse rental_subscription_begin_v1. That function only starts and stops
-- autopay, and its finish writes stripe_subscription_id and autopay_active.
-- This journal keeps the same subscription id. An extension inserts an
-- exception row and does not mark anything paid.
--
-- Environment is sandbox only. Live is refused here as well as in the server.
-- Run APPLY or ROLLBACK, not the whole file.

-- ===== APPLY =====

CREATE TABLE private.billing_operations_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rentals(id),
  actor_id uuid NOT NULL,
  session_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('billing_day', 'extend_invoice')),
  account text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox')),
  snapshot jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'complete')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  result jsonb
);

CREATE UNIQUE INDEX billing_operations_pending_v1
  ON private.billing_operations_v1 (rental_id)
  WHERE state = 'pending';

CREATE TABLE private.billing_exceptions_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES private.billing_operations_v1(id),
  rental_id uuid NOT NULL REFERENCES public.rentals(id),
  invoice_id text NOT NULL,
  subscription_id text NOT NULL,
  actor_id uuid NOT NULL,
  reason text NOT NULL,
  original_due date,
  new_due date,
  amount_due_cents integer,
  state text NOT NULL CHECK (state IN ('extended', 'collected')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE private.billing_operations_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.billing_exceptions_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.billing_operations_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON private.billing_exceptions_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON private.billing_exceptions_v1 TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON private.billing_operations_v1 TO service_role;

CREATE POLICY billing_exceptions_select_v1
  ON private.billing_exceptions_v1
  FOR SELECT
  TO authenticated
  USING (private.is_manager());

-- No INSERT, UPDATE, or DELETE policy: authenticated cannot write either table.

CREATE FUNCTION private.billing_actor_v1(actor uuid, sess uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM auth.sessions
  WHERE id = sess AND user_id = actor AND (not_after IS NULL OR not_after > clock_timestamp())
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_revoked'; END IF;
  PERFORM 1 FROM public.user_roles
  WHERE user_id = actor AND role::text IN ('admin', 'team')
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'manager_required'; END IF;
END $$;

CREATE FUNCTION public.billing_operation_begin_v1(
  rental uuid,
  actor uuid,
  sess uuid,
  action text,
  account text,
  environment text,
  snapshot jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  op private.billing_operations_v1%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(710026, 3);
  PERFORM 1 FROM public.rentals WHERE id = rental FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rental_missing'; END IF;
  PERFORM private.billing_actor_v1(actor, sess);
  IF environment IS DISTINCT FROM 'sandbox' THEN RAISE EXCEPTION 'live_refused'; END IF;
  IF action NOT IN ('billing_day', 'extend_invoice') OR account IS NULL OR account = '' OR snapshot IS NULL THEN
    RAISE EXCEPTION 'invalid_scope';
  END IF;
  IF coalesce(snapshot->>'subscription', '') = '' THEN RAISE EXCEPTION 'subscription_missing'; END IF;
  SELECT * INTO op FROM private.billing_operations_v1 WHERE rental_id = rental AND state = 'pending';
  IF FOUND THEN
    IF op.created_at < clock_timestamp() - interval '23 hours' THEN
      RAISE EXCEPTION 'provider_reconciliation_required';
    END IF;
    IF ROW(op.actor_id, op.session_id, op.action, op.account, op.environment)
      IS DISTINCT FROM ROW(actor, sess, action, account, environment) THEN
      RAISE EXCEPTION 'operation_conflict';
    END IF;
    RETURN to_jsonb(op);
  END IF;
  INSERT INTO private.billing_operations_v1 (rental_id, actor_id, session_id, action, account, environment, snapshot)
  VALUES (rental, actor, sess, action, account, environment, snapshot)
  RETURNING * INTO op;
  RETURN to_jsonb(op);
END $$;

CREATE FUNCTION public.billing_operation_finish_v1(
  operation uuid,
  actor uuid,
  sess uuid,
  account text,
  environment text,
  subscription text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  op private.billing_operations_v1%ROWTYPE;
  outcome jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(710026, 3);
  SELECT * INTO op FROM private.billing_operations_v1 WHERE id = operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'operation_missing'; END IF;
  PERFORM 1 FROM public.rentals WHERE id = op.rental_id FOR UPDATE;
  PERFORM private.billing_actor_v1(actor, sess);
  IF environment IS DISTINCT FROM 'sandbox' THEN RAISE EXCEPTION 'live_refused'; END IF;
  IF ROW(op.actor_id, op.session_id, op.account, op.environment)
    IS DISTINCT FROM ROW(actor, sess, account, environment) THEN
    RAISE EXCEPTION 'operation_conflict';
  END IF;
  IF op.state = 'complete' THEN RETURN op.result; END IF;
  IF subscription IS NULL OR subscription = '' OR subscription IS DISTINCT FROM op.snapshot->>'subscription' THEN
    RAISE EXCEPTION 'subscription_mismatch';
  END IF;
  IF op.action = 'billing_day' THEN
    outcome := jsonb_build_object('ok', true, 'action', 'billing_day', 'subscriptionId', subscription);
    UPDATE private.billing_operations_v1 SET state = 'complete', result = outcome WHERE id = op.id;
    RETURN outcome;
  END IF;
  IF op.action = 'extend_invoice' THEN
    INSERT INTO private.billing_exceptions_v1 (
      operation_id, rental_id, invoice_id, subscription_id, actor_id, reason, original_due, new_due, amount_due_cents, state
    ) VALUES (
      op.id,
      op.rental_id,
      op.snapshot->>'invoice',
      subscription,
      op.actor_id,
      op.snapshot->>'reason',
      nullif(op.snapshot->>'originalDue', '')::date,
      nullif(op.snapshot->>'newDue', '')::date,
      CASE
        WHEN op.snapshot->>'amountDueCents' IS NULL OR op.snapshot->>'amountDueCents' = '' THEN NULL
        WHEN op.snapshot->>'amountDueCents' ~ '^[0-9]+$' THEN (op.snapshot->>'amountDueCents')::integer
        ELSE NULL
      END,
      'extended'
    );
    outcome := jsonb_build_object('ok', true, 'action', 'extend_invoice', 'subscriptionId', subscription, 'state', 'extended');
    UPDATE private.billing_operations_v1 SET state = 'complete', result = outcome WHERE id = op.id;
    RETURN outcome;
  END IF;
  RAISE EXCEPTION 'invalid_scope';
END $$;

CREATE FUNCTION public.billing_exceptions_list_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' AND NOT private.is_manager() THEN
    RAISE EXCEPTION 'manager_required';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'invoiceId', invoice_id,
      'amountDueCents', amount_due_cents,
      'originalDue', original_due,
      'newDue', new_due,
      'state', state
    ) ORDER BY created_at, id)
    FROM private.billing_exceptions_v1
  ), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION private.billing_actor_v1(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.billing_operation_begin_v1(uuid, uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_operation_finish_v1(uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_exceptions_list_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_operation_begin_v1(uuid, uuid, uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_operation_finish_v1(uuid, uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_exceptions_list_v1() TO service_role, authenticated;

-- Finish does not update public.rentals. It does not set autopay_active
-- or stripe_subscription_id. billing_day only completes the journal row
-- after the subscription id matches the snapshot. extend_invoice inserts
-- state extended. There is no collected-by-this-function path and no paid state.

-- ===== ROLLBACK =====
-- Run this section only to undo APPLY. It drops the objects above.
-- It does not drop public.rental_subscription_begin_v1 or public.rentals.

DROP POLICY IF EXISTS billing_exceptions_select_v1 ON private.billing_exceptions_v1;
DROP FUNCTION IF EXISTS public.billing_exceptions_list_v1();
DROP FUNCTION IF EXISTS public.billing_operation_finish_v1(uuid, uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.billing_operation_begin_v1(uuid, uuid, uuid, text, text, text, jsonb);
DROP FUNCTION IF EXISTS private.billing_actor_v1(uuid, uuid);
DROP TABLE IF EXISTS private.billing_exceptions_v1;
DROP TABLE IF EXISTS private.billing_operations_v1;
