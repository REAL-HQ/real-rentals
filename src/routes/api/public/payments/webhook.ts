import { createFileRoute } from '@tanstack/react-router';
import { createClient } from '@supabase/supabase-js';
import { type StripeEnv, verifyWebhook, createStripeClient } from '@/lib/stripe.server';

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

async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  if (session.mode !== 'setup') return;
  const applicationId = session.metadata?.applicationId;
  if (!applicationId) return;

  const setupIntentId = typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent?.id;
  if (!setupIntentId) return;

  const stripe = createStripeClient(env);
  const si = await stripe.setupIntents.retrieve(setupIntentId, { expand: ['payment_method'] });
  const pm: any = si.payment_method;
  if (!pm || typeof pm === 'string') return;

  const card = pm.card;
  await getSupabase()
    .from('applications')
    .update({
      stripe_customer_id: typeof session.customer === 'string' ? session.customer : session.customer?.id,
      stripe_payment_method_id: pm.id,
      card_brand: card?.brand ?? null,
      card_last4: card?.last4 ?? null,
      card_exp_month: card?.exp_month ?? null,
      card_exp_year: card?.exp_year ?? null,
      card_on_file_at: new Date().toISOString(),
    })
    .eq('id', applicationId);
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
          if (event.type === 'checkout.session.completed') {
            await handleCheckoutCompleted(event.data.object, env);
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