import { createFileRoute } from '@tanstack/react-router';
import { createClient } from '@supabase/supabase-js';
import { type StripeEnv, verifyWebhook, createStripeClient } from '@/lib/stripe.server';
import { sendPaymentReceiptEmail, sendPaymentFailedEmail, sendCardExpiringEmail } from '@/lib/email.server';
import { doubleCollectionMessage } from '@/lib/payment-overlap';
import { customerIdOf, formatUnmatchedWarn, stripeId } from '@/lib/stripe-unmatched';

let _supabase: ReturnType<typeof createClient> | null = null;
let webhookAdmin: any = null;
function getSupabase() {
  if (webhookAdmin) return webhookAdmin;
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

async function driverForRental(rentalId: string | undefined) {
  if (!rentalId) return null;
  const admin: any = getSupabase();
  const { data } = await admin
    .from('rentals')
    .select('application_id, applications:application_id(email, full_name, card_brand, card_last4, card_exp_month, card_exp_year)')
    .eq('id', rentalId)
    .maybeSingle();
  if (!data?.applications?.email) return null;
  return {
    email: data.applications.email as string,
    name: (data.applications.full_name as string | null) ?? null,
    brand: data.applications.card_brand as string | null,
    last4: data.applications.card_last4 as string | null,
    expMonth: data.applications.card_exp_month as number | null,
    expYear: data.applications.card_exp_year as number | null,
  };
}

function cardExpiresSoon(m: number | null, y: number | null): boolean {
  if (!m || !y) return false;
  const now = new Date();
  const soon = new Date(now.getFullYear(), now.getMonth() + 2, 1); // within ~60 days
  const exp = new Date(y, m, 1);
  return exp <= soon;
}

async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  if (session.mode !== 'setup') return;
  const applicationId = session.metadata?.applicationId;
  const rentalId = session.metadata?.rentalId as string | undefined;
  if (!applicationId) return;

  const setupIntentId = typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent?.id;
  if (!setupIntentId) return;

  const stripe = createStripeClient(env);
  const si = await stripe.setupIntents.retrieve(setupIntentId, { expand: ['payment_method'] });
  const pm: any = si.payment_method;
  if (!pm || typeof pm === 'string') return;

  const card = pm.card;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const cardFields = {
    stripe_payment_method_id: pm.id,
    card_brand: card?.brand ?? null,
    card_last4: card?.last4 ?? null,
    card_exp_month: card?.exp_month ?? null,
    card_exp_year: card?.exp_year ?? null,
    card_on_file_at: new Date().toISOString(),
  };
  const admin: any = getSupabase();
  await admin
    .from('applications')
    .update({ stripe_customer_id: customerId, ...cardFields })
    .eq('id', applicationId);

  if (rentalId) {
    await admin.from('rentals').update({ stripe_customer_id: customerId, ...cardFields }).eq('id', rentalId);
  }
  // Try to reuse the same customer for any other applications with the same email
  const { data: app } = await admin.from('applications').select('email').eq('id', applicationId).maybeSingle();
  if (app?.email) {
    await admin.from('applications')
      .update({ stripe_customer_id: customerId })
      .eq('email', app.email)
      .is('stripe_customer_id', null);
  }
  await admin.from('notifications').insert({
    driver_id: null,
    title: 'Card Saved',
    body: `${card?.brand ?? 'Card'} ····${card?.last4 ?? ''} saved on file`,
    kind: 'payment',
    read: false,
  }).select().maybeSingle().then(() => {}, () => {});
}

// Payment invariants (see src/lib/payment-collection.server.ts):
//  - A payments row is a charge. Failure leaves it owed (status 'failed'); it
//    is never deleted and never counted as revenue (only 'paid' is).
//  - Nothing moves a row out of 'paid' except a refund.
//  - Duplicate or out-of-order events are no-ops: every write is guarded, and
//    receipts/notifications only fire when a row actually changed.
//  - DB write errors throw → 400 → Stripe retries, rather than being swallowed.

const today = () => new Date().toISOString().slice(0, 10);

function must<T extends { error: any }>(res: T): T {
  if (res.error && res.error.code !== '23505') throw new Error(res.error.message);
  return res;
}

function failureReasonStillSet(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

async function customerLinked(admin: any, customerId: string | null): Promise<boolean> {
  if (!customerId) return false;
  const rental = await admin.from('rentals').select('id').eq('stripe_customer_id', customerId).limit(1);
  if (rental.error) throw new Error(rental.error.message);
  if (rental.data?.length) return true;
  const application = await admin.from('applications').select('id').eq('stripe_customer_id', customerId).limit(1);
  if (application.error) throw new Error(application.error.message);
  return !!application.data?.length;
}

/** A log line must not turn a delivered event into a retry. */
async function warnUnmatchedInvoice(admin: any, invoice: any, status: 'paid' | 'failed', subscriptionId: string | null) {
  try {
    const customerId = customerIdOf(invoice);
    if (await customerLinked(admin, customerId)) return;
    const raw = status === 'paid'
      ? Number(invoice?.amount_paid ?? invoice?.amount_due ?? 0)
      : Number(invoice?.amount_due ?? invoice?.amount_paid ?? 0);
    console.warn(formatUnmatchedWarn({
      invoiceId: stripeId(invoice?.id),
      subscriptionId,
      customerId,
      amountCents: Number.isFinite(raw) ? Math.round(raw) : null,
      status,
    }));
  } catch {
    // Logging reads the directory. A down database, or a console that throws,
    // still leaves the event delivered.
  }
}

/**
 * Kept so a payment-intent log cannot fail the request. The payment-intent
 * handler does not call it: that extra warning is not part of the base flow.
 */
export async function warnUnmatchedPayment(admin: any, pi: any, status: 'paid' | 'failed') {
  try {
    const customerId = customerIdOf(pi);
    if (await customerLinked(admin, customerId)) return;
    const raw = Number(pi?.amount ?? 0);
    console.warn(formatUnmatchedWarn({
      paymentIntentId: stripeId(pi?.id),
      customerId,
      amountCents: Number.isFinite(raw) ? Math.round(raw) : null,
      status,
    }));
  } catch {
    // Same rule as the invoice log.
  }
}

async function upsertPaymentFromPaymentIntent(pi: any, status: 'paid' | 'failed') {
  const admin: any = getSupabase();
  const rentalId = pi.metadata?.rentalId as string | undefined;
  const reason = (pi.metadata?.reason as string | undefined) ?? 'other';
  const amount = Number(pi.amount ?? 0) / 100;
  const failure = (pi.last_payment_error?.message as string | undefined)?.slice(0, 500) ?? 'Payment failed';
  const ids = String(pi.metadata?.paymentIds ?? '').split(',').map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  // Which collection attempt this intent was (set by collectRows). Older intents have none.
  const attemptNo = Number(pi.metadata?.attempt);

  let changed = 0;
  let noticeIds = ids;
  let manualIds: string[] = [];
  if (ids.length) {
    // Charges created by our own collection flow. The rows already exist.
    if (status === 'paid') {
      const prior = must(await admin.from('payments').select('id, status, failure_reason').in('id', ids));
      const alreadyPaid = (prior.data ?? []).filter((row: any) => row.status === 'paid');
      const alreadyPaidIds = alreadyPaid.map((row: any) => row.id as string);
      // Staff marked these paid while the failure reason was still set.
      // Keep that manual record. Status, paid_date, and failure_reason stay.
      // The receipt claim below still includes them, once.
      manualIds = alreadyPaid.filter((row: any) => failureReasonStillSet(row.failure_reason)).map((row: any) => row.id as string);
      const openIds = ids.filter((id) => !alreadyPaidIds.includes(id));
      if (openIds.length) {
        const r = must(await admin.from('payments')
          .update({ status: 'paid', paid_date: today(), balance_due: 0, failure_reason: null, ...(ids.length === 1 ? { stripe_payment_intent_id: pi.id } : {}) })
          .in('id', openIds).neq('status', 'paid').neq('status', 'refunded').select('id'));
        changed = r.data?.length ?? 0;
      }
      noticeIds = ids;
    } else {
      // Stale guard: a single charge that has since been retried points at a
      // newer intent; a late failure for the old one must not touch it.
      // A failure never reopens a charge staff voided or waived.
      let q = admin.from('payments').update({ status: 'failed', failure_reason: failure })
        .in('id', ids).neq('status', 'paid').neq('status', 'refunded').neq('status', 'void').neq('status', 'waived');
      if (ids.length === 1) q = q.or(`stripe_payment_intent_id.is.null,stripe_payment_intent_id.eq.${pi.id}`);
      // A late or repeated failure for an earlier attempt must not mark rows failed while a newer
      // attempt is in flight on them: that would let a further attempt start (a double charge).
      if (Number.isInteger(attemptNo) && attemptNo > 0) q = q.eq('attempt_count', attemptNo);
      const r = must(await q.select('id'));
      changed = r.data?.length ?? 0;
    }
  } else {
    // Intents created elsewhere (legacy): keyed by intent id, inserted once.
    const { data: existing } = await admin.from('payments').select('id').eq('stripe_payment_intent_id', pi.id).maybeSingle();
    if (existing) {
      let q = admin.from('payments').update(status === 'paid'
        ? { status: 'paid', paid_date: today(), balance_due: 0, failure_reason: null }
        : { status: 'failed', failure_reason: failure }).eq('id', existing.id).neq('status', 'paid').neq('status', 'refunded');
      if (status !== 'paid') q = q.neq('status', 'void').neq('status', 'waived');
      const r = must(await q.select('id'));
      changed = r.data?.length ?? 0;
    } else if (rentalId) {
      const { data: r } = await admin.from('rentals').select('application_id, vehicle_id').eq('id', rentalId).maybeSingle();
      const ins = must(await admin.from('payments').insert({
        rental_id: rentalId,
        driver_id: r?.application_id ?? null,
        vehicle_id: r?.vehicle_id ?? null,
        amount,
        balance_due: status === 'paid' ? 0 : amount,
        type: reason === 'rent' ? 'rent' : reason === 'late_fee' ? 'late_fee' : 'other',
        reason,
        status,
        failure_reason: status === 'failed' ? failure : null,
        stripe_payment_intent_id: pi.id,
        paid_date: status === 'paid' ? today() : null,
      }).select('id'));
      changed = ins.data?.length ?? 0; // 0 when a duplicate event lost the insert race
    }
  }

  // Driver notice, exactly once per outcome. Our own collection flow usually
  // settles the row before this event arrives (so `changed` is 0), yet the
  // driver still needs a receipt. Claim the notice atomically instead: only
  // rows currently IN this outcome, and not already notified for it, qualify.
  // A duplicate event, or a stale failure for a charge now paid, claims none.
  const target = ids.length
    ? noticeIds
    : ((await admin.from('payments').select('id').eq('stripe_payment_intent_id', pi.id)).data ?? []).map((r: any) => r.id);
  if (!target.length) return;
  let claim = admin.from('payments').update({ notified_status: status })
    .in('id', target).eq('status', status)
    .or(`notified_status.is.null,notified_status.neq.${status}`);
  if (status === 'failed' && ids.length === 1) claim = claim.eq('stripe_payment_intent_id', pi.id);
  const claimed = must(await claim.select('id'));
  if (!claimed.data?.length) return; // already notified / stale — no second email
  const claimedIds = new Set((claimed.data ?? []).map((row: any) => row.id as string));
  const overlapHit = manualIds.some((id) => claimedIds.has(id));
  void changed;

  if (status === 'failed' && rentalId) {
    must(await admin.from('rentals').update({ payment_status: 'past_due' }).eq('id', rentalId));
  }

  await admin.from('notifications').insert({
    title: status === 'paid' ? 'Payment Received' : 'Payment Failed',
    body: `$${amount.toFixed(2)} — ${reason.replace('_', ' ')}`,
    kind: 'payment',
    read: false,
  }).then(() => {}, () => {});

  const driver = await driverForRental(rentalId);
  if (driver) {
    if (status === 'paid') {
      const sendReceipt = () => sendPaymentReceiptEmail({
        to: driver.email, firstName: driver.name, amount, reason,
        brand: driver.brand, last4: driver.last4,
      });
      // A manual row that Stripe also collected used to return 200 with no
      // mail. Keep that status if the receipt send fails. A replay claims
      // nothing, so it cannot send a second notice.
      if (overlapHit && changed === 0) {
        try { await sendReceipt(); } catch (err) { console.error('[payments] overlap receipt failed', err); }
      } else {
        await sendReceipt();
      }
      if (cardExpiresSoon(driver.expMonth, driver.expYear)) {
        await sendCardExpiringEmail({
          to: driver.email, firstName: driver.name,
          brand: driver.brand, last4: driver.last4,
          expMonth: driver.expMonth!, expYear: driver.expYear!,
        });
      }
    } else {
      await sendPaymentFailedEmail({
        to: driver.email, firstName: driver.name, amount, reason,
        brand: driver.brand, last4: driver.last4,
      });
    }
  }
  if (overlapHit) await alertPossibleDoubleCollection(amount);
}

async function alertPossibleDoubleCollection(amount: number): Promise<void> {
  const message = doubleCollectionMessage(amount);
  try {
    const { getLeadAlertPrefs, sendEmail } = await import('@/lib/email.server');
    const prefs = await getLeadAlertPrefs();
    if (!prefs.recipients.length) return;
    await sendEmail({
      to: prefs.recipients,
      subject: message,
      html: `<p>${message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`,
      track: { workflow: 'payment_overlap' },
    });
  } catch (err) {
    console.error('[payments] double-collection alert failed', err);
  }
}

async function upsertPaymentFromInvoice(invoice: any, status: 'paid' | 'failed') {
  const admin: any = getSupabase();
  const rawSub = typeof invoice.subscription === 'string' ? invoice.subscription
    : invoice.subscription?.id ?? invoice.parent?.subscription_details?.subscription;
  const subscriptionId = typeof rawSub === 'string' ? rawSub : null;
  if (!subscriptionId) {
    await warnUnmatchedInvoice(admin, invoice, status, null);
    return;
  }
  const rentalResult = await admin
    .from('rentals')
    .select('id, application_id, vehicle_id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (rentalResult.error || !rentalResult.data) {
    if (!rentalResult.error) await warnUnmatchedInvoice(admin, invoice, status, subscriptionId);
    return;
  }
  const rental = rentalResult.data;

  // The week's rent is owed whether or not the card worked.
  const owed = Number(invoice.amount_due ?? invoice.amount_paid ?? 0) / 100;
  const amount = status === 'paid' ? Number(invoice.amount_paid ?? invoice.amount_due ?? 0) / 100 : owed;
  const failure = 'Weekly rent charge failed';

  // One row per invoice (unique index). A duplicate insert is ignored.
  must(await admin.from('payments').insert({
    rental_id: rental.id,
    driver_id: rental.application_id,
    vehicle_id: rental.vehicle_id ?? null,
    amount,
    balance_due: status === 'paid' ? 0 : owed,
    type: 'rent',
    reason: 'rent',
    status: 'pending',
    due_date: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString().slice(0, 10) : today(),
    stripe_invoice_id: invoice.id,
    stripe_subscription_id: subscriptionId,
  }));

  const patch = status === 'paid'
    ? { status: 'paid', paid_date: today(), balance_due: 0, amount, failure_reason: null }
    : { status: 'failed', failure_reason: failure, attempt_count: Number(invoice.attempt_count ?? 1) };
  let q = admin.from('payments').update(patch)
    .eq('stripe_invoice_id', invoice.id)
    .neq('status', 'paid').neq('status', 'refunded');
  // A failed retry never reopens a charge staff voided or waived.
  if (status !== 'paid') q = q.neq('status', 'void').neq('status', 'waived');
  const r = must(await q.select('id'));
  if (!(r.data?.length)) {
    // The row was already paid, usually because staff marked a failed invoice
    // paid in cash. Keep that manual record: do not clear failure_reason, do
    // not change status or paid_date, and do not store a payment intent.
    // Claim the notice once, then send one Payment Received email and one
    // staff alert. A replay claims nothing.
    if (status === 'paid') {
      const prior = must(await admin.from('payments').select('id, failure_reason').eq('stripe_invoice_id', invoice.id).eq('status', 'paid'));
      const manualIds = (prior.data ?? []).filter((row: any) => failureReasonStillSet(row.failure_reason)).map((row: any) => row.id as string);
      if (manualIds.length) {
        const claimed = must(await admin.from('payments').update({ notified_status: 'paid' })
          .in('id', manualIds).eq('status', 'paid')
          .or('notified_status.is.null,notified_status.neq.paid')
          .select('id'));
        if (claimed.data?.length) {
          try {
            await admin.from('notifications').insert({
              title: 'Payment Received',
              body: `$${amount.toFixed(2)} — rent`,
              kind: 'payment',
              read: false,
            });
            const driver = await driverForRental(rental.id);
            if (driver) {
              await sendPaymentReceiptEmail({
                to: driver.email, firstName: driver.name, amount, reason: 'weekly rent',
                brand: driver.brand, last4: driver.last4,
              });
            }
            await alertPossibleDoubleCollection(amount);
          } catch (err) {
            console.error('[payments] overlap notice failed', err);
          }
        }
      }
    }
    return;
  }

  must(await admin.from('rentals').update({
    payment_status: status === 'paid' ? 'current' : 'past_due',
    ...(status === 'paid' && invoice.period_end
      ? { next_payment_due: new Date((invoice.period_end + 7 * 24 * 60 * 60) * 1000).toISOString().slice(0, 10) }
      : {}),
  }).eq('id', rental.id));

  await admin.from('notifications').insert({
    title: status === 'paid' ? 'Weekly Rent Paid' : 'Weekly Rent Failed',
    body: `$${amount.toFixed(2)} weekly rent`,
    kind: 'payment',
    read: false,
  }).then(() => {}, () => {});

  const driver = await driverForRental(rental.id);
  if (driver) {
    if (status === 'paid') {
      await sendPaymentReceiptEmail({
        to: driver.email, firstName: driver.name, amount, reason: 'weekly rent',
        brand: driver.brand, last4: driver.last4,
      });
      if (cardExpiresSoon(driver.expMonth, driver.expYear)) {
        await sendCardExpiringEmail({
          to: driver.email, firstName: driver.name,
          brand: driver.brand, last4: driver.last4,
          expMonth: driver.expMonth!, expYear: driver.expYear!,
        });
      }
    } else {
      await sendPaymentFailedEmail({
        to: driver.email, firstName: driver.name, amount, reason: 'weekly rent',
        brand: driver.brand, last4: driver.last4,
      });
    }
  }
}

/**
 * Money returned. The original charge row keeps its gross amount; refunded_amount
 * follows Stripe's cumulative amount_refunded (provider truth), so duplicate or
 * out-of-order events are idempotent and can never lower it. net_collected
 * (amount − refunded_amount) is what reports count. Only a full refund flips
 * the status to 'refunded'. Each Stripe refund is logged once in payment_refunds.
 */
async function handleChargeRefunded(charge: any) {
  const admin: any = getSupabase();
  const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!piId) return;
  // Single charge: matched by pointer. Combined balance payment: by metadata.paymentIds.
  let ids: string[] = String(charge.metadata?.paymentIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) {
    const { data } = await admin.from('payments').select('id').eq('stripe_payment_intent_id', piId);
    ids = (data ?? []).map((r: any) => r.id);
  }
  if (!ids.length) return;
  const refunds = (charge.refunds?.data ?? []).map((r: any) => ({ id: r.id, amount: Number(r.amount ?? 0) / 100, status: r.status ?? null }));
  must(await admin.rpc('apply_payment_refund', {
    _payment_ids: ids,
    _cumulative: Number(charge.amount_refunded ?? 0) / 100,
    _refunds: refunds,
    _charge_id: charge.id ?? null,
    _pi: piId,
  }));
}

async function handleSubscriptionUpdated(sub: any) {
  const admin: any = getSupabase();
  await admin.from('rentals').update({
    autopay_active: sub.status === 'active' || sub.status === 'trialing',
    ...(sub.status === 'canceled' ? { stripe_subscription_id: null } : {}),
  }).eq('stripe_subscription_id', sub.id);
}

async function handleVerifiedPaymentEvent(event: { type: string; data: { object: any } }, env: StripeEnv) {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object, env);
      break;
    case 'payment_intent.succeeded':
      await upsertPaymentFromPaymentIntent(event.data.object, 'paid');
      break;
    case 'payment_intent.payment_failed':
      await upsertPaymentFromPaymentIntent(event.data.object, 'failed');
      break;
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
      await upsertPaymentFromInvoice(event.data.object, 'paid');
      break;
    case 'invoice.payment_failed':
      await upsertPaymentFromInvoice(event.data.object, 'failed');
      break;
    case 'charge.refunded':
      await handleChargeRefunded(event.data.object);
      break;
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await handleSubscriptionUpdated(event.data.object);
      break;
    default:
      break;
  }
}

/**
 * One dispatch for a verified event. Tests pass a mocked database; the route
 * passes null and uses the service client. Throws become 400, matching the
 * route. A caught unmatched log stays 200.
 */
export async function postVerifiedPaymentWebhook(
  event: { type: string; data: { object: any } },
  admin: any,
  env: StripeEnv = 'live',
): Promise<Response> {
  const previous = webhookAdmin;
  webhookAdmin = admin;
  try {
    await handleVerifiedPaymentEvent(event, env);
    return Response.json({ received: true });
  } catch (e) {
    console.error('Webhook error:', e);
    return new Response('Webhook error', { status: 400 });
  } finally {
    webhookAdmin = previous;
  }
}

export const Route = createFileRoute('/api/public/payments/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get('env');
        if (rawEnv !== 'sandbox' && rawEnv !== 'live') {
          return Response.json({ received: true, ignored: 'invalid env' });
        }
        const env: StripeEnv = rawEnv;
        try {
          const event = await verifyWebhook(request, env);
          return await postVerifiedPaymentWebhook(event, null, env);
        } catch (e) {
          console.error('Webhook error:', e);
          return new Response('Webhook error', { status: 400 });
        }
      },
    },
  },
});