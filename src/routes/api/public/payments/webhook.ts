import { createFileRoute } from '@tanstack/react-router';
import { createClient } from '@supabase/supabase-js';
import { type StripeEnv, verifyWebhook, createStripeClient } from '@/lib/stripe.server';
import { sendPaymentReceiptEmail, sendPaymentFailedEmail, sendCardExpiringEmail } from '@/lib/email.server';

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
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

function must(res: { error: any }) {
  if (res.error && res.error.code !== '23505') throw new Error(res.error.message);
  return res;
}

async function upsertPaymentFromPaymentIntent(pi: any, status: 'paid' | 'failed') {
  const admin: any = getSupabase();
  const rentalId = pi.metadata?.rentalId as string | undefined;
  const reason = (pi.metadata?.reason as string | undefined) ?? 'other';
  const amount = Number(pi.amount ?? 0) / 100;
  const failure = (pi.last_payment_error?.message as string | undefined)?.slice(0, 500) ?? 'Payment failed';
  const ids = String(pi.metadata?.paymentIds ?? '').split(',').map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s));

  let changed = 0;
  if (ids.length) {
    // Charges created by our own collection flow. The rows already exist.
    if (status === 'paid') {
      const r = must(await admin.from('payments')
        .update({ status: 'paid', paid_date: today(), balance_due: 0, failure_reason: null, ...(ids.length === 1 ? { stripe_payment_intent_id: pi.id } : {}) })
        .in('id', ids).neq('status', 'paid').neq('status', 'refunded').select('id'));
      changed = r.data?.length ?? 0;
    } else {
      // Stale guard: a single charge that has since been retried points at a
      // newer intent; a late failure for the old one must not touch it.
      let q = admin.from('payments').update({ status: 'failed', failure_reason: failure })
        .in('id', ids).neq('status', 'paid').neq('status', 'refunded');
      if (ids.length === 1) q = q.or(`stripe_payment_intent_id.is.null,stripe_payment_intent_id.eq.${pi.id}`);
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

  if (!changed) return; // duplicate / stale event — no second receipt

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
      await sendPaymentReceiptEmail({
        to: driver.email, firstName: driver.name, amount, reason,
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
        to: driver.email, firstName: driver.name, amount, reason,
        brand: driver.brand, last4: driver.last4,
      });
    }
  }
}

async function upsertPaymentFromInvoice(invoice: any, status: 'paid' | 'failed') {
  const admin: any = getSupabase();
  const subId = typeof invoice.subscription === 'string' ? invoice.subscription
    : invoice.subscription?.id ?? invoice.parent?.subscription_details?.subscription;
  if (!subId) return;
  const { data: rental } = await admin
    .from('rentals')
    .select('id, application_id, vehicle_id')
    .eq('stripe_subscription_id', subId)
    .maybeSingle();
  if (!rental) return;

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
    stripe_subscription_id: subId,
  }));

  const patch = status === 'paid'
    ? { status: 'paid', paid_date: today(), balance_due: 0, amount, failure_reason: null }
    : { status: 'failed', failure_reason: failure, attempt_count: Number(invoice.attempt_count ?? 1) };
  const r = must(await admin.from('payments').update(patch)
    .eq('stripe_invoice_id', invoice.id)
    .neq('status', 'paid').neq('status', 'refunded')
    .select('id'));
  if (!(r.data?.length)) return; // duplicate / out-of-order event

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

/** Money returned. Full refund → 'refunded' (drops out of revenue); partial → amount recorded. */
async function handleChargeRefunded(charge: any) {
  const admin: any = getSupabase();
  const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!piId) return;
  const refunded = Number(charge.amount_refunded ?? 0) / 100;
  const full = charge.refunded === true || Number(charge.amount_refunded ?? 0) >= Number(charge.amount ?? Infinity);
  must(await admin.from('payments')
    .update({ refunded_amount: refunded, refunded_at: new Date().toISOString(), ...(full ? { status: 'refunded' } : {}) })
    .eq('stripe_payment_intent_id', piId));
}

async function handleSubscriptionUpdated(sub: any) {
  const admin: any = getSupabase();
  await admin.from('rentals').update({
    autopay_active: sub.status === 'active' || sub.status === 'trialing',
    ...(sub.status === 'canceled' ? { stripe_subscription_id: null } : {}),
  }).eq('stripe_subscription_id', sub.id);
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
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted':
              await handleSubscriptionUpdated(event.data.object);
              break;
            default:
              // ignored
              break;
          }
          return Response.json({ received: true });
        } catch (e) {
          console.error('Webhook error:', e);
          return new Response('Webhook error', { status: 400 });
        }
      },
    },
  },
});