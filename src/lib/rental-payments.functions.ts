import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from '@/lib/stripe.server';

const REASONS = ['rent', 'late_fee', 'toll', 'damage', 'cleaning', 'fuel', 'other'] as const;
export type ChargeReason = (typeof REASONS)[number];

async function assertAdmin(context: any) {
  const { data } = await (context.supabase as any).rpc('has_role', {
    _user_id: context.userId,
    _role: 'admin',
  });
  if (!data) throw new Error('Forbidden');
}

async function findOrCreateStripeCustomer(
  admin: any,
  stripe: ReturnType<typeof createStripeClient>,
  driver: { id: string; full_name?: string | null; email?: string | null; phone?: string | null; stripe_customer_id?: string | null },
): Promise<string> {
  if (driver.stripe_customer_id) return driver.stripe_customer_id;

  // Try to find a sibling application (same email) that already has a customer
  if (driver.email) {
    const { data: sibling } = await admin
      .from('applications')
      .select('stripe_customer_id')
      .eq('email', driver.email)
      .not('stripe_customer_id', 'is', null)
      .limit(1)
      .maybeSingle();
    if (sibling?.stripe_customer_id) {
      await admin.from('applications').update({ stripe_customer_id: sibling.stripe_customer_id }).eq('id', driver.id);
      return sibling.stripe_customer_id;
    }
  }

  const created = await stripe.customers.create({
    ...(driver.email && { email: driver.email }),
    ...(driver.full_name && { name: driver.full_name }),
    ...(driver.phone && { phone: driver.phone }),
    metadata: { applicationId: driver.id },
  });
  await admin.from('applications').update({ stripe_customer_id: created.id }).eq('id', driver.id);
  return created.id;
}

async function copyCardFromApplicationToRental(admin: any, rentalId: string, applicationId: string) {
  const { data: app } = await admin
    .from('applications')
    .select('stripe_customer_id, stripe_payment_method_id, card_brand, card_last4, card_exp_month, card_exp_year, card_on_file_at')
    .eq('id', applicationId)
    .maybeSingle();
  if (!app) return;
  await admin.from('rentals').update({
    stripe_customer_id: app.stripe_customer_id,
    stripe_payment_method_id: app.stripe_payment_method_id,
    card_brand: app.card_brand,
    card_last4: app.card_last4,
    card_exp_month: app.card_exp_month,
    card_exp_year: app.card_exp_year,
    card_on_file_at: app.card_on_file_at,
  }).eq('id', rentalId);
}

// ─── Admin: charge card on file for an incidental / manual rent charge ─────

export const chargeCardOnRental = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    rentalId: string;
    amountCents: number;
    reason: ChargeReason;
    note?: string;
    environment: StripeEnv;
  }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.rentalId)) throw new Error('Invalid rentalId');
    if (!Number.isFinite(data.amountCents) || data.amountCents < 50) throw new Error('Amount must be at least $0.50');
    if (!REASONS.includes(data.reason)) throw new Error('Invalid reason');
    return data;
  })
  .handler(async ({ data, context }): Promise<{ ok: true; paymentIntentId: string } | { error: string }> => {
    try {
      await assertAdmin(context);
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { data: rental } = await supabaseAdmin
        .from('rentals')
        .select('id, application_id, stripe_customer_id, stripe_payment_method_id')
        .eq('id', data.rentalId)
        .maybeSingle();
      if (!rental) throw new Error('Rental not found');

      let customerId = rental.stripe_customer_id as string | null;
      let paymentMethodId = rental.stripe_payment_method_id as string | null;

      if ((!customerId || !paymentMethodId) && rental.application_id) {
        await copyCardFromApplicationToRental(supabaseAdmin, rental.id as string, rental.application_id as string);
        const { data: refetched } = await supabaseAdmin
          .from('rentals')
          .select('stripe_customer_id, stripe_payment_method_id')
          .eq('id', data.rentalId)
          .maybeSingle();
        customerId = (refetched?.stripe_customer_id as string | null) ?? null;
        paymentMethodId = (refetched?.stripe_payment_method_id as string | null) ?? null;
      }
      if (!customerId || !paymentMethodId) throw new Error('No card on file for this rental');

      const stripe = createStripeClient(data.environment);
      const pi = await stripe.paymentIntents.create({
        amount: data.amountCents,
        currency: 'usd',
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: `${data.reason.replace('_', ' ')}${data.note ? ` — ${data.note}` : ''}`,
        metadata: {
          rentalId: data.rentalId,
          reason: data.reason,
          ...(data.note && { note: data.note.slice(0, 500) }),
        },
      });

      // Record the pending row; webhook flips it on succeeded/failed.
      await supabaseAdmin.from('payments').insert({
        rental_id: data.rentalId,
        driver_id: rental.application_id as string,
        amount: data.amountCents / 100,
        type: data.reason === 'rent' ? 'rent' : 'other',
        reason: data.reason,
        status: pi.status === 'succeeded' ? 'paid' : 'pending',
        stripe_payment_intent_id: pi.id,
        notes: data.note ?? null,
        paid_date: pi.status === 'succeeded' ? new Date().toISOString().slice(0, 10) : null,
      });

      return { ok: true, paymentIntentId: pi.id };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

// ─── Admin: start weekly rent autopay on a rental ─────────────────────────

export const startRentalAutopay = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rentalId: string; environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<{ ok: true; subscriptionId: string } | { error: string }> => {
    try {
      await assertAdmin(context);
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { data: rental } = await supabaseAdmin
        .from('rentals')
        .select('id, application_id, weekly_rate, start_date, stripe_customer_id, stripe_payment_method_id, stripe_subscription_id')
        .eq('id', data.rentalId)
        .maybeSingle();
      if (!rental) throw new Error('Rental not found');
      if (rental.stripe_subscription_id) throw new Error('Autopay already active');
      if (!rental.weekly_rate) throw new Error('Weekly rate not set');

      let customerId = rental.stripe_customer_id as string | null;
      let paymentMethodId = rental.stripe_payment_method_id as string | null;
      if ((!customerId || !paymentMethodId) && rental.application_id) {
        await copyCardFromApplicationToRental(supabaseAdmin, rental.id as string, rental.application_id as string);
        const { data: refetched } = await supabaseAdmin
          .from('rentals')
          .select('stripe_customer_id, stripe_payment_method_id')
          .eq('id', data.rentalId)
          .maybeSingle();
        customerId = (refetched?.stripe_customer_id as string | null) ?? null;
        paymentMethodId = (refetched?.stripe_payment_method_id as string | null) ?? null;
      }
      if (!customerId || !paymentMethodId) throw new Error('No card on file');

      const stripe = createStripeClient(data.environment);
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });

      const startTs = rental.start_date
        ? Math.max(Math.floor(new Date(rental.start_date as string).getTime() / 1000), Math.floor(Date.now() / 1000) + 60)
        : Math.floor(Date.now() / 1000) + 60;

      const sub = await stripe.subscriptions.create({
        customer: customerId,
        default_payment_method: paymentMethodId,
        items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: `Weekly Rent — Rental ${String(rental.id).slice(0, 8)}` },
            unit_amount: Math.round(Number(rental.weekly_rate) * 100),
            recurring: { interval: 'week' },
          } as any,
        }],
        billing_cycle_anchor: startTs,
        proration_behavior: 'none',
        collection_method: 'charge_automatically',
        metadata: { rentalId: data.rentalId },
      });

      await supabaseAdmin.from('rentals').update({
        stripe_subscription_id: sub.id,
        autopay_active: true,
      }).eq('id', data.rentalId);

      return { ok: true, subscriptionId: sub.id };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const stopRentalAutopay = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rentalId: string; environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
    try {
      await assertAdmin(context);
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { data: rental } = await supabaseAdmin
        .from('rentals').select('stripe_subscription_id').eq('id', data.rentalId).maybeSingle();
      if (rental?.stripe_subscription_id) {
        const stripe = createStripeClient(data.environment);
        try { await stripe.subscriptions.cancel(rental.stripe_subscription_id as string); } catch { /* ignore */ }
      }
      await supabaseAdmin.from('rentals').update({
        stripe_subscription_id: null,
        autopay_active: false,
      }).eq('id', data.rentalId);
      return { ok: true };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

// ─── Driver Portal: pay outstanding balance ───────────────────────────────

export const payRentalBalance = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rentalId: string; amountCents: number; environment: StripeEnv }) => {
    if (!Number.isFinite(data.amountCents) || data.amountCents < 50) throw new Error('Amount must be at least $0.50');
    return data;
  })
  .handler(async ({ data, context }): Promise<{ ok: true; paymentIntentId: string } | { error: string }> => {
    try {
      // Verify driver owns rental via authenticated supabase (RLS)
      const { data: rental } = await (context.supabase as any)
        .from('rentals')
        .select('id, application_id, stripe_customer_id, stripe_payment_method_id')
        .eq('id', data.rentalId)
        .maybeSingle();
      if (!rental) throw new Error('Rental not found');
      if (!rental.stripe_customer_id || !rental.stripe_payment_method_id) throw new Error('No card on file');

      const stripe = createStripeClient(data.environment);
      const pi = await stripe.paymentIntents.create({
        amount: data.amountCents,
        currency: 'usd',
        customer: rental.stripe_customer_id,
        payment_method: rental.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        description: 'Rent balance payment',
        metadata: { rentalId: data.rentalId, reason: 'rent', source: 'driver_portal' },
      });

      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      await supabaseAdmin.from('payments').insert({
        rental_id: data.rentalId,
        driver_id: rental.application_id,
        amount: data.amountCents / 100,
        type: 'rent',
        reason: 'rent',
        status: pi.status === 'succeeded' ? 'paid' : 'pending',
        stripe_payment_intent_id: pi.id,
        paid_date: pi.status === 'succeeded' ? new Date().toISOString().slice(0, 10) : null,
      });

      return { ok: true, paymentIntentId: pi.id };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

// ─── Driver Portal: update card (new SetupIntent) ─────────────────────────

export const createRentalSetupSession = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rentalId: string; returnUrl: string; environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<{ clientSecret: string } | { error: string }> => {
    try {
      const { data: rental } = await (context.supabase as any)
        .from('rentals')
        .select('id, application_id, stripe_customer_id')
        .eq('id', data.rentalId)
        .maybeSingle();
      if (!rental) throw new Error('Rental not found');

      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { data: app } = await supabaseAdmin
        .from('applications')
        .select('id, full_name, email, phone, stripe_customer_id')
        .eq('id', rental.application_id)
        .maybeSingle();
      if (!app) throw new Error('Application not found');

      const stripe = createStripeClient(data.environment);
      const customerId = await findOrCreateStripeCustomer(supabaseAdmin, stripe, app as any);

      const session = await stripe.checkout.sessions.create({
        mode: 'setup',
        ui_mode: 'embedded_page',
        currency: 'usd',
        customer: customerId,
        return_url: data.returnUrl,
        payment_method_types: ['card'],
        metadata: { applicationId: app.id as string, rentalId: data.rentalId, purpose: 'card_on_file' },
      });
      return { clientSecret: session.client_secret ?? '' };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

// ─── Driver Portal: get rental billing snapshot ───────────────────────────

export type RentalBilling = {
  rentalId: string | null;
  weeklyRate: number;
  autopayActive: boolean;
  paymentStatus: string;
  card: { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null } | null;
  nextChargeDate: string | null;
  outstandingCents: number;
};

export const getRentalBilling = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RentalBilling> => {
    const { supabase, userId } = context;
    const { data: rental } = await (supabase as any)
      .from('rentals')
      .select('id, weekly_rate, autopay_active, payment_status, card_brand, card_last4, card_exp_month, card_exp_year, stripe_subscription_id, next_payment_due')
      .eq('driver_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!rental) {
      return { rentalId: null, weeklyRate: 0, autopayActive: false, paymentStatus: 'current', card: null, nextChargeDate: null, outstandingCents: 0 };
    }
    const { data: unpaid } = await (supabase as any)
      .from('payments')
      .select('amount')
      .eq('rental_id', rental.id)
      .in('status', ['pending', 'failed', 'past_due']);
    const outstandingCents = Math.round(((unpaid ?? []) as any[]).reduce((s, p) => s + Number(p.amount ?? 0), 0) * 100);
    return {
      rentalId: rental.id,
      weeklyRate: Number(rental.weekly_rate ?? 0),
      autopayActive: Boolean(rental.autopay_active),
      paymentStatus: rental.payment_status ?? 'current',
      card: rental.card_last4 ? {
        brand: rental.card_brand, last4: rental.card_last4, expMonth: rental.card_exp_month, expYear: rental.card_exp_year,
      } : null,
      nextChargeDate: rental.next_payment_due,
      outstandingCents,
    };
  });