import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from '@/lib/stripe.server';
import { RENTAL_SUBSCRIPTION_COORDINATION_ENABLED } from '@/lib/record-rental-live-path';
import { AUTOPAY_START_OFF_MESSAGE, RENTAL_AUTOPAY_START_ENABLED } from '@/lib/rental-autopay-flag';

const previewInput = (d: unknown): { previewDriverId?: string } => {
  const id = (d as any)?.previewDriverId;
  if (id == null || id === "") return {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid driver");
  return { previewDriverId: id };
};


const REASONS = ['rent', 'late_fee', 'toll', 'damage', 'cleaning', 'fuel', 'other'] as const;
export type ChargeReason = (typeof REASONS)[number];

// Owner only. Checked server-side from user_roles (roles.server.ts). The former
// rpc('has_role') call named public.has_role, which migration 20260713042639 dropped
// (it is private.has_role now, not exposed), so every call answered Forbidden.
async function assertAdmin(context: any) {
  const { requireOwner } = await import('@/lib/roles.server');
  return requireOwner(context.userId);
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
//
// The charge is recorded FIRST, then collected. A decline, a provider error or
// a missing card leaves an owed charge with the reason — it never vanishes.
// Pass `paymentId` to retry an existing unpaid charge: the same row is
// re-attempted, so a retry can never create a second charge.

export const chargeCardOnRental = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    rentalId: string;
    amountCents: number;
    reason: ChargeReason;
    note?: string;
    paymentId?: string;
    environment: StripeEnv;
  }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.rentalId)) throw new Error('Invalid rentalId');
    if (data.paymentId && !/^[0-9a-f-]{36}$/i.test(data.paymentId)) throw new Error('Invalid paymentId');
    if (!Number.isFinite(data.amountCents) || data.amountCents < 50) throw new Error('Amount must be at least $0.50');
    if (!REASONS.includes(data.reason)) throw new Error('Invalid reason');
    return data;
  })
  .handler(async ({ data, context }): Promise<{ ok: true; paymentIntentId: string; paymentId: string; status: string } | { error: string; paymentId?: string }> => {
    let paymentId: string | undefined;
    try {
      const actor = await assertAdmin(context);
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { collectRows, markUncollectable, REASON_TO_TYPE, CLAIMABLE_STATUSES } = await import('@/lib/payment-collection.server');
      const { data: rental } = await supabaseAdmin
        .from('rentals')
        .select('id, application_id, vehicle_id, stripe_customer_id, stripe_payment_method_id')
        .eq('id', data.rentalId)
        .maybeSingle();
      if (!rental) throw new Error('Rental not found');

      // One payment at a time per rental: a charge still Processing (in flight, or its outcome not
      // yet confirmed by Stripe) blocks a new one. collectRows enforces this again atomically.
      const { data: inFlight } = await supabaseAdmin.from('payments').select('id').eq('rental_id', data.rentalId).eq('status', 'pending').limit(1);
      if ((inFlight ?? []).length)
        return { error: 'A charge on this rental is still Processing: Stripe has not confirmed it yet. Don\'t charge again. Check it in Stripe; it settles automatically, or the Owner can release it from Payments once Stripe shows nothing was collected.' };

      // 1. The charge (amount owed) exists before any collection attempt.
      let row: any;
      let created = false;
      if (data.paymentId) {
        const { data: existing } = await supabaseAdmin
          .from('payments')
          .select('id, status, amount, balance_due, attempt_count, rental_id, stripe_invoice_id')
          .eq('id', data.paymentId)
          .eq('rental_id', data.rentalId)
          .maybeSingle();
        if (!existing) throw new Error('Charge not found on this rental');
        if (existing.status === 'paid' || existing.status === 'refunded' || existing.status === 'void' || existing.status === 'waived')
          return { error: `This charge is ${existing.status} and cannot be collected again`, paymentId: existing.id as string };
        if (existing.status === 'pending')
          return { error: 'This charge is still Processing in Stripe and cannot be charged again until Stripe confirms it.', paymentId: existing.id as string };
        if (existing.stripe_invoice_id)
          return { error: 'This charge belongs to a Stripe invoice, which Stripe retries itself. Collect it in Stripe, not here.', paymentId: existing.id as string };
        row = existing;
      } else {
        // One week's rent, one row: a rent charge for this driver still owed from the last 6 days
        // is this week's rent. Charging rent again would create a second debt that Pay Now (or a
        // later charge) also collects. Next week's rent is not blocked by an older unpaid week.
        if (data.reason === 'rent') {
          const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
          const thisWeek = (col: string, value: string) => supabaseAdmin.from('payments').select('id, amount, due_date')
            .eq(col, value).eq('type', 'rent').in('status', [...CLAIMABLE_STATUSES]).gte('due_date', weekAgo).limit(1);
          const [byRental, byDriver] = await Promise.all([
            thisWeek('rental_id', data.rentalId),
            rental.application_id ? thisWeek('driver_id', rental.application_id as string) : Promise.resolve({ data: [] as any[] }),
          ]);
          const openRent = [...(byRental.data ?? []), ...(byDriver.data ?? [])];
          if (openRent.length)
            return { error: `This week's rent is already charged and still owed ($${Number(openRent![0].amount).toFixed(2)}, due ${openRent![0].due_date}). Charge that one from Payments (Charge Card for This Charge), or void it first if it was replaced.` };
        }
        const amount = data.amountCents / 100;
        const { data: inserted, error: insErr } = await supabaseAdmin
          .from('payments')
          .insert({
            rental_id: data.rentalId,
            driver_id: rental.application_id as string,
            vehicle_id: (rental as any).vehicle_id ?? null,
            amount,
            balance_due: amount,
            type: REASON_TO_TYPE[data.reason] ?? 'other',
            reason: data.reason,
            // Owed until collectRows claims it for this attempt.
            status: 'current',
            due_date: new Date().toISOString().slice(0, 10),
            notes: data.note ?? null,
          } as any)
          .select('id, status, amount, balance_due, attempt_count')
          .single();
        if (insErr) throw new Error(`Could not record the charge: ${insErr.message}`);
        row = inserted;
        created = true;
      }
      paymentId = row.id as string;

      // 2. Card on file.
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
      if (!customerId || !paymentMethodId) {
        await markUncollectable(supabaseAdmin, [paymentId], 'No card on file');
        return { error: 'No card on file — the charge is recorded as unpaid.', paymentId };
      }

      // 3. Collect.
      const stripe = createStripeClient(data.environment);
      const res = await collectRows(supabaseAdmin, stripe, [row], {
        rentalId: data.rentalId,
        customerId,
        paymentMethodId,
        description: `${data.reason.replace('_', ' ')}${data.note ? ` — ${data.note}` : ''}`,
        metadata: {
          rentalId: data.rentalId,
          reason: data.reason,
          ...(data.note && { note: data.note.slice(0, 450) }),
        },
      });
      // Never invite a blind retry: a retry is a new charge with a new idempotency key.
      if ('error' in res) {
        if (res.outcome === 'busy') {
          // Another payment on this rental got there first. A charge this request created is not
          // owed twice: void it, unless that other payment has already taken it over.
          if (created) {
            const { data: voided } = await supabaseAdmin.from('payments').update({ status: 'void', notes: [data.note, 'Voided automatically: not charged, another payment on this rental was in progress.'].filter(Boolean).join('\n') } as any).eq('id', paymentId).eq('status', 'current').select('id');
            if (!voided?.length)
              return { error: 'Another payment on this rental picked up this new charge and is collecting it. Check Payments before doing anything else.', paymentId };
            await (supabaseAdmin as any).from('audit_log').insert({
              actor_user_id: actor.userId, actor_email: actor.email, actor_role: actor.role, action: 'payment.void',
              entity_type: 'payment', entity_id: paymentId, summary: `Voided automatically (not charged): $${(data.amountCents / 100).toFixed(2)}`,
              metadata: { from: 'current', to: 'void', reason: 'Charge Card request not charged: another payment on this rental was in progress', rental_id: data.rentalId, automatic: true },
            });
          }
          return { error: res.error, paymentId };
        }
        if (res.outcome === 'unconfirmed')
          return { error: `${res.error} — Stripe has not confirmed this charge, so it may have gone through. It stays Processing until Stripe confirms it. Don't charge again: check it in Stripe.`, paymentId };
        return { error: `${res.error} — Stripe declined or refused it, so nothing was collected. It is recorded as failed and still owed.`, paymentId };
      }
      return { ok: true, paymentIntentId: res.paymentIntentId, paymentId, status: res.status };
    } catch (error) {
      return { error: getStripeErrorMessage(error), paymentId };
    }
  });

// ─── Admin: start weekly rent autopay on a rental ─────────────────────────

async function coordinatedAutopay(context: any, data: { rentalId: string; environment: StripeEnv }, action: 'start' | 'stop') {
  if (!/^[0-9a-f-]{36}$/i.test(data.rentalId) || !['live', 'sandbox'].includes(data.environment)) throw new Error('Invalid rental scope');
  const sessionId = context.claims?.session_id;
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('Verified session required');
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { coordinateRentalSubscription } = await import('@/lib/rental-subscription-coordination.server');
  return coordinateRentalSubscription({
    authorize: async () => {
      const { data: user, error } = await context.supabase.auth.getUser();
      if (error || user?.user?.id !== context.userId) throw new Error('Session expired');
      await assertAdmin(context);
    },
    rpc: async (name, args) => {
      const { data, error } = await (supabaseAdmin as any).rpc(name, args);
      if (error) throw new Error(error.message);
      return data;
    },
    stripe: createStripeClient(data.environment),
  }, { ...data, actorId: context.userId, sessionId, action });
}

export const startRentalAutopay = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rentalId: string; environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<{ ok: true; subscriptionId: string } | { error: string }> => {
    try {
      // Off for launch (see rental-autopay-flag.ts). Checked before any Stripe call, on both paths.
      if (!RENTAL_AUTOPAY_START_ENABLED) return { error: AUTOPAY_START_OFF_MESSAGE };
      // rental_subscription_begin_v1 / finish_v1 do not exist until
      // subscription-coordination-v1.sql. The flag-off path is today's Stripe call.
      if (RENTAL_SUBSCRIPTION_COORDINATION_ENABLED) return await coordinatedAutopay(context, data, 'start');
      await assertAdmin(context);
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { data: rental } = await supabaseAdmin
        .from('rentals')
        .select('id, application_id, status, weekly_rate, start_date, stripe_customer_id, stripe_payment_method_id, stripe_subscription_id')
        .eq('id', data.rentalId)
        .maybeSingle();
      if (!rental) throw new Error('Rental not found');
      if (rental.status !== 'active') throw new Error('Autopay can only start on an active rental');
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
      if (RENTAL_SUBSCRIPTION_COORDINATION_ENABLED) return await coordinatedAutopay(context, data, 'stop');
      await assertAdmin(context);
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { data: rental } = await supabaseAdmin
        .from('rentals').select('stripe_subscription_id').eq('id', data.rentalId).maybeSingle();
      if (rental?.stripe_subscription_id) {
        // The subscription id is cleared only once Stripe confirms the subscription is over.
        // A failed or unconfirmed cancel leaves autopay on here, so it can be retried and the
        // driver is never charged by a subscription the app no longer knows about.
        const stripe = createStripeClient(data.environment);
        const { subscriptionEnded } = await import('@/lib/subscription-cancel.server');
        const problem = await subscriptionEnded(stripe, rental.stripe_subscription_id as string);
        if (problem) return { error: `${problem} Autopay is still on; nothing was changed. Check the subscription in Stripe.` };
      }
      const { error: clearError } = await supabaseAdmin.from('rentals').update({
        stripe_subscription_id: null,
        autopay_active: false,
      }).eq('id', data.rentalId);
      if (clearError) return { error: 'The subscription is cancelled in Stripe, but the rental still shows autopay on. Press Stop again to clear it.' };
      return { ok: true };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

// ─── Driver Portal: pay outstanding balance ───────────────────────────────

// Pays the driver's EXISTING outstanding charges (incl. late fees on them).
// It never creates a new charge: a failed attempt marks those charges failed
// (still owed) instead of adding a phantom "rent" row, and success marks them
// paid. The amount is computed server-side; the client's figure is only a
// confirmation that the driver saw the same balance.
export const payRentalBalance = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rentalId: string; amountCents: number; environment: StripeEnv }) => {
    if (!Number.isFinite(data.amountCents) || data.amountCents < 50) throw new Error('Amount must be at least $0.50');
    return data;
  })
  .handler(async ({ data, context }): Promise<{ ok: true; paymentIntentId: string } | { error: string }> => {
    // Driver-only: staff (including Driver Preview) are refused before any lookup.
    await (await import('@/lib/driver-preview.server')).refuseStaffPortalWrite(context.userId);
    try {
      // Verify driver owns rental via authenticated supabase (RLS)
      const { data: rental } = await (context.supabase as any)
        .from('rentals')
        .select('id, driver_id, application_id, stripe_customer_id, stripe_payment_method_id')
        .eq('id', data.rentalId)
        .maybeSingle();
      // Staff can READ every rental, so RLS alone would let a Coordinator push
      // a charge through the driver's own pay button. Only the renter pays here.
      if (!rental || rental.driver_id !== context.userId) throw new Error('Rental not found');
      if (!rental.stripe_customer_id || !rental.stripe_payment_method_id) throw new Error('No card on file');

      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { collectRows, rentalBalance } = await import('@/lib/payment-collection.server');
      // Same computation as the portal's balance (getRentalBilling).
      const { processing, rows, cents } = await rentalBalance(supabaseAdmin, data.rentalId);
      // A payment still Processing (in flight, or not yet confirmed by Stripe) blocks a new one,
      // so the same charges are never collected twice. collectRows enforces this atomically too.
      if (processing)
        return { error: 'A payment is still being confirmed by Stripe. Please don\'t pay again; your balance updates once it is confirmed.' };
      if (!rows.length) return { error: 'Nothing is owed on this rental.' };
      if (cents !== Math.round(data.amountCents)) return { error: 'Your balance changed. Refresh and try again.' };

      const stripe = createStripeClient(data.environment);
      const res = await collectRows(supabaseAdmin, stripe, rows, {
        rentalId: data.rentalId,
        customerId: rental.stripe_customer_id,
        paymentMethodId: rental.stripe_payment_method_id,
        description: 'Rent balance payment',
        metadata: { rentalId: data.rentalId, reason: 'rent', source: 'driver_portal' },
      });
      if ('error' in res) {
        if (res.outcome === 'unconfirmed')
          return { error: 'We could not confirm your payment with the card processor. It may have gone through, so please don\'t pay again; your balance updates once it is confirmed.' };
        return { error: res.error };
      }
      return { ok: true, paymentIntentId: res.paymentIntentId };
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
  /** A payment is in flight or waiting for Stripe to confirm it: no new payment until it settles. */
  processing: boolean;
};

export const getRentalBilling = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator(previewInput)
  .handler(async ({ context, data: input }): Promise<RentalBilling> => {
    const { supabase, userId } = await (await import('@/lib/driver-preview.server')).portalScope(context as any, input, 'billing');
    const { data: rental } = await (supabase as any)
      .from('rentals')
      .select('id, weekly_rate, autopay_active, payment_status, card_brand, card_last4, card_exp_month, card_exp_year, stripe_subscription_id, next_payment_due')
      .eq('driver_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!rental) {
      return { rentalId: null, weeklyRate: 0, autopayActive: false, paymentStatus: 'current', card: null, nextChargeDate: null, outstandingCents: 0, processing: false };
    }
    // Same computation as Pay Now collects (payRentalBalance), so the two always agree.
    const { rentalBalance } = await import('@/lib/payment-collection.server');
    const { processing, cents: outstandingCents } = await rentalBalance(supabase, rental.id);
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
      processing,
    };
  });