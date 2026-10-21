/** External work is bracketed by separate, committed database RPCs. Never retry
 * an ambiguous failure automatically or release its durable reservation. */
export async function coordinateRentalSubscription(deps: {
  authorize: () => Promise<void>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<any>;
  stripe: any;
}, input: { rentalId: string; actorId: string; sessionId: string; environment: 'live' | 'sandbox'; action: 'start' | 'stop' }) {
  await deps.authorize();
  const account = await deps.stripe.accounts.retrieve();
  if (!account?.id) throw new Error('Provider account unavailable');
  await deps.authorize();
  const scope = { actor: input.actorId, sess: input.sessionId, account: account.id, environment: input.environment };
  const op = await deps.rpc('rental_subscription_begin_v1', { ...scope, rental: input.rentalId, action: input.action });
  if (op.state === 'complete') return op.result;
  const s = op.snapshot;
  if (!op.id || !s?.customer) throw new Error('Invalid operation snapshot');
  let sub: any;
  if (input.action === 'start') {
    await deps.authorize();
    await deps.stripe.customers.update(s.customer, { invoice_settings: { default_payment_method: s.paymentMethod } }, { idempotencyKey: `rr:${op.id}:customer` });
    await deps.authorize();
    sub = await deps.stripe.subscriptions.create({
      customer: s.customer, default_payment_method: s.paymentMethod,
      items: [{ price_data: { currency: 'usd', product_data: { name: `Weekly Rent — Rental ${input.rentalId.slice(0, 8)}` }, unit_amount: s.amount, recurring: { interval: 'week' } } }],
      billing_cycle_anchor: s.start, proration_behavior: 'none', collection_method: 'charge_automatically', metadata: { rentalId: input.rentalId },
    }, { idempotencyKey: `rr:${op.id}:subscription` });
  } else {
    sub = await deps.stripe.subscriptions.retrieve(s.subscription);
    if (sub.customer !== s.customer || sub.livemode !== (input.environment === 'live')) throw new Error('Provider scope mismatch');
    if (sub.status !== 'canceled') {
      await deps.authorize();
      sub = await deps.stripe.subscriptions.cancel(s.subscription);
    }
  }
  if (!sub?.id || sub.customer !== s.customer || sub.livemode !== (input.environment === 'live') || (input.action === 'stop' && sub.status !== 'canceled')) throw new Error('Provider result mismatch');
  await deps.authorize();
  return deps.rpc('rental_subscription_finish_v1', { ...scope, operation: op.id, subscription: sub.id });
}
