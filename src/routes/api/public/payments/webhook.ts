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

async function upsertPaymentFromPaymentIntent(pi: any, status: 'paid' | 'failed') {
  const admin: any = getSupabase();
  const rentalId = pi.metadata?.rentalId as string | undefined;
  const reason = (pi.metadata?.reason as string | undefined) ?? 'other';
  const amount = Number(pi.amount ?? 0) / 100;

  // Try update existing row keyed by intent id first
  const { data: existing } = await admin
    .from('payments')
    .select('id')
    .eq('stripe_payment_intent_id', pi.id)
    .maybeSingle();

  const patch: any = {
    status,
    paid_date: status === 'paid' ? new Date().toISOString().slice(0, 10) : null,
  };
  if (existing) {
    await admin.from('payments').update(patch).eq('id', existing.id);
  } else if (rentalId) {
    const { data: r } = await admin.from('rentals').select('application_id').eq('id', rentalId).maybeSingle();
    await admin.from('payments').insert({
      rental_id: rentalId,
      driver_id: r?.application_id ?? null,
      amount,
      type: reason === 'rent' ? 'rent' : 'other',
      reason,
      status,
      stripe_payment_intent_id: pi.id,
      paid_date: patch.paid_date,
    });
  }

  if (status === 'failed' && rentalId) {
    await admin.from('rentals').update({ payment_status: 'past_due' }).eq('id', rentalId);
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
  const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
  if (!subId) return;
  const { data: rental } = await admin
    .from('rentals')
    .select('id, application_id')
    .eq('stripe_subscription_id', subId)
    .maybeSingle();
  if (!rental) return;

  const amount = Number(invoice.amount_paid ?? invoice.amount_due ?? 0) / 100;
  const { data: existing } = await admin
    .from('payments')
    .select('id')
    .eq('stripe_invoice_id', invoice.id)
    .maybeSingle();

  const patch: any = {
    status,
    paid_date: status === 'paid' ? new Date().toISOString().slice(0, 10) : null,
  };
  if (existing) {
    await admin.from('payments').update(patch).eq('id', existing.id);
  } else {
    await admin.from('payments').insert({
      rental_id: rental.id,
      driver_id: rental.application_id,
      amount,
      type: 'rent',
      reason: 'rent',
      status,
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: subId,
      paid_date: patch.paid_date,
    });
  }

  await admin.from('rentals').update({
    payment_status: status === 'paid' ? 'current' : 'past_due',
    ...(status === 'paid' && invoice.period_end
      ? { next_payment_due: new Date((invoice.period_end + 7 * 24 * 60 * 60) * 1000).toISOString().slice(0, 10) }
      : {}),
  }).eq('id', rental.id);

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