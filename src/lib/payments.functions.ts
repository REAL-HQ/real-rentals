import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from '@/lib/stripe.server';

type SessionResult = { clientSecret: string } | { error: string };

export const createCardOnFileSession = createServerFn({ method: 'POST' })
  .inputValidator((data: { applicationId: string; returnUrl: string; environment: StripeEnv }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.applicationId)) throw new Error('Invalid applicationId');
    return data;
  })
  .handler(async ({ data }): Promise<SessionResult> => {
    try {
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { data: app, error } = await supabaseAdmin
        .from('applications')
        .select('id, full_name, email, phone, stripe_customer_id')
        .eq('id', data.applicationId)
        .maybeSingle();
      if (error || !app) throw new Error('Application not found');

      const stripe = createStripeClient(data.environment);

      let customerId = app.stripe_customer_id as string | null;
      if (!customerId) {
        const created = await stripe.customers.create({
          ...(app.email && { email: app.email as string }),
          ...(app.full_name && { name: app.full_name as string }),
          ...(app.phone && { phone: app.phone as string }),
          metadata: { applicationId: app.id as string },
        });
        customerId = created.id;
        await supabaseAdmin
          .from('applications')
          .update({ stripe_customer_id: customerId })
          .eq('id', app.id);
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'setup',
        ui_mode: 'embedded_page',
        currency: 'usd',
        customer: customerId,
        return_url: data.returnUrl,
        payment_method_types: ['card'],
        metadata: { applicationId: app.id as string, purpose: 'card_on_file' },
      });

      return { clientSecret: session.client_secret ?? '' };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const removeCardOnFile = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { applicationId: string; environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
    try {
      const { data: isAdmin } = await context.supabase.rpc('has_role', {
        _user_id: context.userId,
        _role: 'admin',
      });
      if (!isAdmin) throw new Error('Forbidden');

      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { data: app } = await supabaseAdmin
        .from('applications')
        .select('stripe_payment_method_id')
        .eq('id', data.applicationId)
        .maybeSingle();

      if (app?.stripe_payment_method_id) {
        const stripe = createStripeClient(data.environment);
        try {
          await stripe.paymentMethods.detach(app.stripe_payment_method_id as string);
        } catch {
          // ignore detach failure — clear locally regardless
        }
      }
      await supabaseAdmin
        .from('applications')
        .update({
          stripe_payment_method_id: null,
          card_brand: null,
          card_last4: null,
          card_exp_month: null,
          card_exp_year: null,
          card_on_file_at: null,
        })
        .eq('id', data.applicationId);

      return { ok: true };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });