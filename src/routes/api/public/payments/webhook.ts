import { createFileRoute } from '@tanstack/react-router';
import { createClient } from '@supabase/supabase-js';
import { type StripeEnv, verifyWebhook, createStripeClient } from '@/lib/stripe.server';
import { sendPaymentReceiptEmail, sendPaymentFailedEmail, sendCardExpiringEmail, sendTeamPaymentAlertEmail, sendRentReminderEmail } from '@/lib/email.server';
import { doubleCollectionMessage } from '@/lib/payment-overlap';
import { customerIdOf, formatUnmatchedWarn, stripeId } from '@/lib/stripe-unmatched';
import { holdIfHeld, type HeldNoticeInput } from '@/lib/held-payment-notices.server';
import { failedInvoiceLink } from '@/lib/failed-payment-link';
import { easternDateOf } from '@/lib/rent-reminders';
import { dueDateOf, extractPaymentReceiptFields, paidDateOf, shouldNotifyRenter } from '@/lib/renter-payments';
import { resolveStripePaymentMatch } from '@/lib/renter-payments-match.server';
import { safeReceiptUrl } from '@/lib/payment-received';
import { linkOrFlagSubscription, renderWebhookReminder, sendFailedPaymentText, webhookReminderSlot, type SmsSender } from '@/lib/failed-payment-notice.server';

/** Test seam for the outbound text and staff alert; the route never sets it. */
export type WebhookDeps = { sendSms?: SmsSender; alert?: (a: any) => Promise<unknown>; now?: Date; stripe?: any; welcome?: (admin: any, ref: { rentalId: string | null; applicationId: string | null; reason: string | null }) => Promise<unknown> };
let webhookDeps: WebhookDeps = {};

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
    .select('application_id, vehicles:vehicle_id(license_plate), applications:application_id(email, phone, full_name, card_brand, card_last4, card_exp_month, card_exp_year)')
    .eq('id', rentalId)
    .maybeSingle();
  if (!data?.applications?.email) return null;
  return {
    email: data.applications.email as string,
    applicationId: (data.application_id as string | null) ?? null,
    plate: (data.vehicles?.license_plate as string | null) ?? null,
    name: (data.applications.full_name as string | null) ?? null,
    phone: (data.applications.phone as string | null) ?? null,
    brand: data.applications.card_brand as string | null,
    last4: data.applications.card_last4 as string | null,
    expMonth: data.applications.card_exp_month as number | null,
    expYear: data.applications.card_exp_year as number | null,
  };
}

/**
 * A $50 Reservation Fee is paid before any rental exists, so its intent carries
 * applicationId and no rentalId. Without this the renter got no receipt and
 * staff got no email when a lead paid.
 */
async function driverForApplication(applicationId: string | undefined) {
  if (!applicationId || !/^[0-9a-f-]{36}$/i.test(applicationId)) return null;
  const admin: any = getSupabase();
  const { data } = await admin
    .from('applications')
    .select('email, full_name, phone, card_brand, card_last4, card_exp_month, card_exp_year')
    .eq('id', applicationId)
    .maybeSingle();
  if (!data?.email) return null;
  return {
    email: data.email as string,
    applicationId,
    plate: null as string | null,
    name: (data.full_name as string | null) ?? null,
    phone: (data.phone as string | null) ?? null,
    brand: data.card_brand as string | null,
    last4: data.card_last4 as string | null,
    expMonth: data.card_exp_month as number | null,
    expYear: data.card_exp_year as number | null,
  };
}

/** Staff email once per paid Reservation Fee (after the receipt claim, so a replay sends nothing). */
async function alertTeamReservationFeePaid(
  driver: { name: string | null; applicationId?: string | null } | null,
  amount: number,
  applicationId: string | undefined,
) {
  try {
    const { getLeadAlertPrefs, sendEmail } = await import('@/lib/email.server');
    const prefs = await getLeadAlertPrefs();
    if (!prefs.recipients.length) return;
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const who = driver?.name || 'A lead';
    const appId = driver?.applicationId ?? applicationId ?? null;
    const link = appId ? `https://drivereal.com/admin?tab=drivers&id=${encodeURIComponent(appId)}` : null;
    await sendEmail({
      to: prefs.recipients,
      subject: `Reservation Fee Paid — $${amount.toFixed(2)} — ${who}`,
      html: `<p><strong>${esc(who)}</strong> paid the $${amount.toFixed(2)} Reservation Fee.</p>${link ? `<p><a href="${link}">Open Their Profile</a></p>` : ''}`,
      track: { workflow: 'reservation_fee_paid' },
    });
  } catch (err) {
    console.error('[payments] reservation fee staff alert failed', err);
  }
}

function cardExpiresSoon(m: number | null, y: number | null): boolean {
  if (!m || !y) return false;
  const now = new Date();
  const soon = new Date(now.getFullYear(), now.getMonth() + 2, 1); // within ~60 days
  const exp = new Date(y, m, 1);
  return exp <= soon;
}

/** Card fields from a Stripe PaymentMethod, as stored on applications/rentals. */
function cardFieldsOf(pm: any) {
  const card = pm?.card;
  return {
    stripe_payment_method_id: pm.id,
    card_brand: card?.brand ?? null,
    card_last4: card?.last4 ?? null,
    card_exp_month: card?.exp_month ?? null,
    card_exp_year: card?.exp_year ?? null,
    card_on_file_at: new Date().toISOString(),
  };
}

/**
 * $50 Reservation Fee Checkout (reservation-fee.server.ts, Dolmar t309u): the
 * card is collected after signing and saved on file for the rental balance
 * (setup_future_usage off_session). Save it on the application like a setup
 * session would. The fee row itself is marked paid by payment_intent.succeeded.
 */
async function saveReservationFeeCard(session: any, env: StripeEnv) {
  const applicationId = session.metadata?.applicationId as string | undefined;
  const piId = stripeId(session.payment_intent);
  if (!applicationId || !piId) return;
  const stripe = createStripeClient(env);
  const pi: any = await stripe.paymentIntents.retrieve(piId, { expand: ['payment_method'] });
  const pm: any = pi?.payment_method;
  if (!pm || typeof pm === 'string') return;
  const customerId = stripeId(session.customer) ?? stripeId(pi.customer);
  const admin: any = getSupabase();
  must(await admin.from('applications').update({ ...(customerId ? { stripe_customer_id: customerId } : {}), ...cardFieldsOf(pm) }).eq('id', applicationId));
  await admin.from('notifications').insert({
    driver_id: null,
    title: 'Card Saved',
    body: `${pm.card?.brand ?? 'Card'} ····${pm.card?.last4 ?? ''} saved on file (Reservation Fee)`,
    kind: 'payment',
    read: false,
  }).select().maybeSingle().then(() => {}, () => {});
}

/** A paid Reservation Fee holds the car right away (the cron also catches it on pickup day). */
async function holdReservationAfterFee(pi: any) {
  if (pi?.metadata?.reason !== 'reservation_fee') return;
  const applicationId = pi.metadata?.applicationId as string | undefined;
  if (!applicationId) return;
  try {
    const { paidReservationFee, holdReservationForFee } = await import('@/lib/reservation-fee.server');
    const fee = await paidReservationFee(getSupabase(), applicationId);
    if (fee) await holdReservationForFee(getSupabase(), applicationId, fee);
  } catch (e) {
    console.error('[webhook] reservation fee hold failed', e);
  }
}

async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  if (session.mode === 'payment' && session.metadata?.reason === 'reservation_fee') {
    await saveReservationFeeCard(session, env);
  }
  if (session.mode === 'payment' && session.payment_status === 'paid') {
    // A Payment Link or Dashboard Checkout the app did not create carries no
    // paymentIds/rentalId, so the intent path below cannot record it.
    await recordOneOff({ paymentIntentId: stripeId(session.payment_intent), session }, env, { retryOnError: true });
  }
  if (session.mode === 'subscription' || session.mode === 'payment') {
    // Link the renter's customer / subscription to the rental. The money is
    // recorded from invoice.paid / payment_intent.succeeded, not here.
    const { linkStripeObjectToRental } = await import('@/lib/stripe-link.server');
    await linkStripeObjectToRental(getSupabase(), {
      metadata: session.metadata ?? null,
      clientReferenceId: session.client_reference_id ?? null,
      customerId: stripeId(session.customer),
      subscriptionId: session.mode === 'subscription' ? stripeId(session.subscription) : null,
    });
    return;
  }
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
  // What a held notice needs to be retried later: references only.
  const notice = (kind: HeldNoticeInput['kind']): HeldNoticeInput => ({
    kind, sourceRef: String(pi.id), rentalId: rentalId ?? null, paymentIds: [...claimedIds] as string[],
    outcome: status, amount, reason,
  });
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

  const driver = (await driverForRental(rentalId))
    ?? (reason === 'reservation_fee' ? await driverForApplication(pi.metadata?.applicationId as string | undefined) : null);
  if (status === 'paid' && reason === 'reservation_fee') {
    await alertTeamReservationFeePaid(driver, amount, pi.metadata?.applicationId as string | undefined);
  }
  if (driver) {
    if (status === 'paid') {
      const sendReceipt = () => sendPaymentReceiptEmail({
        to: driver.email, firstName: driver.name, amount, reason,
        brand: driver.brand, last4: driver.last4,
      });
      // A manual row that Stripe also collected used to return 200 with no
      // mail. Keep that status if the receipt send fails. A replay claims
      // nothing, so it cannot send a second notice.
      let receipt: Awaited<ReturnType<typeof sendReceipt>> | undefined;
      if (overlapHit && changed === 0) {
        try { receipt = await sendReceipt(); } catch (err) { console.error('[payments] overlap receipt failed', err); }
      } else {
        receipt = await sendReceipt();
      }
      await holdIfHeld(admin, receipt, notice('payment_receipt'));
      if (cardExpiresSoon(driver.expMonth, driver.expYear)) {
        const card = await sendCardExpiringEmail({
          to: driver.email, firstName: driver.name,
          brand: driver.brand, last4: driver.last4,
          expMonth: driver.expMonth!, expYear: driver.expYear!,
        });
        await holdIfHeld(admin, card, notice('card_expiring'));
      }
    } else {
      const { activePaymentPause } = await import('@/lib/payment-text-pause.server');
      const pause = await activePaymentPause(admin, rentalId);
      if (pause === 'unavailable' || pause.paused) {
        console.info('[payments] failed-payment email paused', { rental: rentalId });
      } else {
      const failedNotice = await sendPaymentFailedEmail({
        to: driver.email, firstName: driver.name, amount, reason,
        brand: driver.brand, last4: driver.last4,
      });
      await holdIfHeld(admin, failedNotice, notice('payment_failed'));
      }
    }
  }
  if (status !== 'paid') await alertTeamPaymentFailed(driver, amount, reason, rentalId, notice('payment_team_alert'));
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


function subscriptionIdOfInvoice(invoice: any): string | null {
  const raw = typeof invoice.subscription === 'string' ? invoice.subscription
    : invoice.subscription?.id ?? invoice.parent?.subscription_details?.subscription;
  return typeof raw === 'string' ? raw : null;
}

async function upsertPaymentFromInvoice(invoice: any, status: 'paid' | 'failed') {
  const admin: any = getSupabase();
  const subscriptionId = subscriptionIdOfInvoice(invoice);
  const receipts = extractPaymentReceiptFields(invoice);
  // 1. Stripe auto-link (PR 360): tie this customer / subscription to its
  // rental by metadata (rentalId / applicationId), then by customer id. Only
  // fills empty columns; a different subscription is never overwritten.
  const { linkStripeObjectToRental } = await import('@/lib/stripe-link.server');
  await linkStripeObjectToRental(admin, {
    metadata: { ...(invoice.parent?.subscription_details?.metadata ?? {}), ...(invoice.metadata ?? {}) },
    customerId: customerIdOf(invoice),
    subscriptionId,
  });
  // 2. Receipt matcher (PR 356): subscription, customer, application metadata,
  // prior payments. 3. Subscription Matching by contact (off by default).
  const match = await resolveStripePaymentMatch(admin, invoice, {
    afterSubscriptionMiss: subscriptionId
      ? async () => {
          await linkOrFlagSubscription(admin, invoice, subscriptionId, status, { alert: webhookDeps.alert });
        }
      : undefined,
  });
  // An invoice we cannot tie to any rental or application is not written:
  // staff get the unmatched warning (and the daily Stripe Link Check) instead.
  if (!match.rentalId && !match.driverId) {
    await warnUnmatchedInvoice(admin, invoice, status, subscriptionId);
    return;
  }
  const notify = shouldNotifyRenter(match);
  const rental = match.rentalId
    ? { id: match.rentalId, application_id: match.driverId, vehicle_id: match.vehicleId }
    : null;

  // The week's rent is owed whether or not the card worked.
  const owed = Number(invoice.amount_due ?? invoice.amount_paid ?? 0) / 100;
  const amount = status === 'paid' ? Number(invoice.amount_paid ?? invoice.amount_due ?? 0) / 100 : owed;
  const failure = 'Weekly rent charge failed';

  // One row per invoice (unique index). A duplicate insert is ignored.
  // Matched rentals stay on the existing pending → paid/failed notice path.
  // Application-only, unmatched, or ambiguous rows are stored as a terminal
  // status with notified_status already set so they cannot trigger receipts,
  // rent reminders, late fees, or staff payment notices.
  must(await admin.from('payments').insert({
    rental_id: match.rentalId,
    driver_id: match.driverId,
    vehicle_id: match.vehicleId,
    amount,
    balance_due: status === 'paid' ? 0 : owed,
    type: 'rent',
    reason: 'rent',
    status: notify ? 'pending' : (status === 'paid' ? 'paid' : 'failed'),
    notified_status: notify ? null : status,
    failure_reason: !notify && status === 'failed' ? failure : null,
    paid_date: !notify && status === 'paid' ? paidDateOf(invoice, receipts) : null,
    payment_method: 'card',
    // The week this invoice bills starts when Stripe created it (ET), the same
    // date the rent reminders and late-fee waivers use. invoice.period_start is
    // the previous period for renewals, which made weeks look days later.
    due_date: invoice.created ? easternDateOf(Number(invoice.created)) : invoice.period_start ? new Date(invoice.period_start * 1000).toISOString().slice(0, 10) : dueDateOf(invoice),
    stripe_invoice_id: invoice.id,
    stripe_subscription_id: subscriptionId,
    stripe_invoice_number: receipts.stripe_invoice_number,
    stripe_hosted_invoice_url: receipts.stripe_hosted_invoice_url,
    stripe_invoice_pdf_url: receipts.stripe_invoice_pdf_url,
    stripe_receipt_url: receipts.stripe_receipt_url,
    stripe_charge_id: receipts.stripe_charge_id,
    stripe_customer_id: receipts.stripe_customer_id,
    stripe_payment_intent_id: receipts.stripe_payment_intent_id,
    stripe_paid_at: status === 'paid' ? receipts.stripe_paid_at : null,
  }));

  // Fill receipt links on a replay without changing status or notified_status.
  // Also attach a later match onto a previously unmatched row (nulls only).
  must(await admin.from('payments').update({
    stripe_invoice_number: receipts.stripe_invoice_number,
    stripe_hosted_invoice_url: receipts.stripe_hosted_invoice_url,
    stripe_invoice_pdf_url: receipts.stripe_invoice_pdf_url,
    stripe_receipt_url: receipts.stripe_receipt_url,
    stripe_charge_id: receipts.stripe_charge_id,
    stripe_customer_id: receipts.stripe_customer_id,
    stripe_payment_intent_id: receipts.stripe_payment_intent_id,
    stripe_subscription_id: subscriptionId,
    // Only stamp a paid time when Stripe actually collected. A failed
    // replay must not clear stripe_paid_at on an already-paid row.
    ...(receipts.stripe_paid_at ? { stripe_paid_at: receipts.stripe_paid_at } : {}),
  }).eq('stripe_invoice_id', invoice.id));

  // Application-only (paid before activation), ambiguous, or another
  // subscription: stored without notices; activation attaches it later.
  if (!notify || !rental) return;

  const patch = status === 'paid'
    ? { status: 'paid', paid_date: today(), balance_due: 0, amount, failure_reason: null, stripe_paid_at: receipts.stripe_paid_at }
    // attempt_count is ours (collectRows' idempotency keys); Stripe's invoice retry count never
    // overwrites it, or a later attempt could reuse an old key.
    // This path already skips paid/refunded/void/waived rows, so clearing
    // stripe_paid_at here only removes a stamp that was never a real payment.
    : { status: 'failed', failure_reason: failure, stripe_paid_at: null };
  let q = admin.from('payments').update(patch)
    .eq('stripe_invoice_id', invoice.id)
    .neq('status', 'paid').neq('status', 'refunded');
  // A failed retry never reopens a charge staff voided or waived, and never fails a row that
  // our own collection has claimed (pending with an attempt time): that attempt is still unsettled.
  if (status !== 'paid') q = q.neq('status', 'void').neq('status', 'waived').or('status.neq.pending,last_attempt_at.is.null');
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
              const res = await sendPaymentReceiptEmail({
                to: driver.email, firstName: driver.name, amount, reason: 'weekly rent',
                brand: driver.brand, last4: driver.last4,
              });
              await holdIfHeld(admin, res, { kind: 'payment_receipt', sourceRef: String(invoice.id), rentalId: rental.id, paymentIds: (claimed.data ?? []).map((x: any) => x.id), outcome: 'paid', amount, reason: 'weekly rent' });
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

  // A failed invoice row stays "failed", so a replayed invoice.payment_failed
  // matches it again. Claim the failure notice per Stripe attempt: a replay
  // (same attempt) or a late older attempt claims nothing, while Stripe's next
  // retry attempt (a genuinely new failure) claims and notifies once.
  // Zero-padded so text order = attempt order; plain 'failed' (charge path)
  // sorts below every attempt key.
  if (status !== 'paid') {
    const attempt = Math.max(1, Math.min(9999, Math.trunc(Number(invoice.attempt_count) || 1)));
    const key = `failed:a${String(attempt).padStart(4, '0')}`;
    const claimed = must(await admin.from('payments').update({ notified_status: key })
      .in('id', (r.data ?? []).map((x: any) => x.id)).eq('status', 'failed')
      .or(`notified_status.is.null,notified_status.lt.${key}`)
      .select('id'));
    if (!claimed.data?.length) return;
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

  const invNotice = (kind: HeldNoticeInput['kind']): HeldNoticeInput => ({
    kind, sourceRef: String(invoice.id), rentalId: rental.id, paymentIds: (r.data ?? []).map((x: any) => x.id),
    outcome: status, amount, reason: 'weekly rent',
  });
  const driver = await driverForRental(rental.id);
  if (driver) {
    if (status === 'paid') {
      const receipt = await sendPaymentReceiptEmail({
        to: driver.email, firstName: driver.name, amount, reason: 'weekly rent',
        brand: driver.brand, last4: driver.last4,
      });
      await holdIfHeld(admin, receipt, invNotice('payment_receipt'));
      if (cardExpiresSoon(driver.expMonth, driver.expYear)) {
        const card = await sendCardExpiringEmail({
          to: driver.email, firstName: driver.name,
          brand: driver.brand, last4: driver.last4,
          expMonth: driver.expMonth!, expYear: driver.expYear!,
        });
        await holdIfHeld(admin, card, invNotice('card_expiring'));
      }
    } else {
      // The failed invoice's own page, never a generic payment link: paying
      // it settles this week on the SAME subscription (no second one).
      // Shares the rent-reminder ledger: if today's reminder email for this
      // week already went out, send nothing; with Rent Reminder: Overdue on,
      // the email uses that editable template (with the late fee).
      // A payment deal (staff or FLEET) pauses this renter's automatic notices.
      const { activePaymentPause } = await import('@/lib/payment-text-pause.server');
      const pause = await activePaymentPause(admin, rental.id, webhookDeps.now ?? new Date());
      const slot = pause === 'unavailable' || pause.paused
        ? ({ kind: 'taken' } as const)
        : await webhookReminderSlot(admin, rental.id, invoice, 'email', webhookDeps.now ?? new Date());
      const link = failedInvoiceLink(invoice);
      let rendered: Awaited<ReturnType<typeof renderWebhookReminder>> = null;
      if (slot.kind === 'claimed' && slot.useReminderTemplate && link) {
        rendered = await renderWebhookReminder(admin, slot, {
          invoice, amount, rentalId: rental.id, applicationId: rental.application_id ?? null,
          firstName: driver.name ?? null, phone: driver.phone ?? null,
        }, link, webhookDeps.now ?? new Date());
      }
      if (slot.kind !== 'taken') {
        const failed = rendered && slot.kind === 'claimed'
          ? await sendRentReminderEmail({
              to: driver.email, subject: rendered.subject, text: rendered.email, link: rendered.link,
              linkLabel: rendered.linkLabel, workflow: slot.ledgerStage === 'overdue' ? 'rent_reminder_overdue' : 'rent_reminder_daily',
            })
          : await sendPaymentFailedEmail({
              to: driver.email, firstName: driver.name, amount, reason: 'weekly rent',
              brand: driver.brand, last4: driver.last4,
              payInvoiceUrl: link,
            });
        await holdIfHeld(admin, failed, invNotice('payment_failed'));
      }
    }
  }
  if (status !== 'paid') {
    // Automations → Payment Failed Text (off by default). Same claim as above,
    // so one text per Stripe attempt.
    const text = await sendFailedPaymentText(admin, {
      invoice, amount, rentalId: rental.id, vehicleId: rental.vehicle_id ?? null,
      applicationId: rental.application_id ?? null,
      firstName: driver?.name ?? null, phone: driver?.phone ?? null,
    }, { sendSms: webhookDeps.sendSms, now: webhookDeps.now });
    if (!text.sent && text.reason !== 'off') console.info('[payments] failed-payment text not sent', { invoice: invoice.id, reason: text.reason });
  }
  if (status !== 'paid') await alertTeamPaymentFailed(driver, amount, 'weekly rent', rental.id, invNotice('payment_team_alert'));
}

// Staff copy of a failed charge. Runs only after the notice claim above, so a
// replayed event never re-alerts. A send failure never fails the webhook.
async function alertTeamPaymentFailed(
  driver: { name: string | null; applicationId?: string | null; plate?: string | null } | null,
  amount: number,
  reason: string,
  rentalId: string | undefined,
  held?: HeldNoticeInput,
) {
  try {
    const res = await sendTeamPaymentAlertEmail({
      event: 'failed', driverName: driver?.name ?? null, amount, reason,
      applicationId: driver?.applicationId ?? null, plate: driver?.plate ?? null, rentalId: rentalId ?? null,
    });
    if (held) await holdIfHeld(getSupabase(), res, held);
  } catch (err) {
    console.error('[payments] team failure alert failed', err);
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

/** customer.subscription.created: link a new subscription to its rental by metadata or customer. */
async function handleSubscriptionCreated(sub: any) {
  const { linkStripeObjectToRental } = await import('@/lib/stripe-link.server');
  await linkStripeObjectToRental(getSupabase(), {
    metadata: sub.metadata ?? null,
    customerId: stripeId(sub.customer),
    subscriptionId: typeof sub.id === 'string' ? sub.id : null,
  });
}

async function handleSubscriptionUpdated(sub: any) {
  const admin: any = getSupabase();
  await admin.from('rentals').update({
    autopay_active: sub.status === 'active' || sub.status === 'trialing',
    ...(sub.status === 'canceled' ? { stripe_subscription_id: null } : {}),
  }).eq('stripe_subscription_id', sub.id);
}

/**
 * One-off payments the app did not create (Payment Links, Dashboard Checkout,
 * manual charges): record them against exactly one rental, or warn staff.
 * App-created and invoice payments are skipped inside.
 */
async function recordOneOff(
  input: { paymentIntentId: string | null; session?: any; charge?: any; paymentIntent?: any },
  env: StripeEnv,
  opts: { retryOnError: boolean },
) {
  if (!input.paymentIntentId) return;
  try {
    const { recordOneOffPayment } = await import('@/lib/one-off-payment.server');
    const stripe = webhookDeps.stripe ?? createStripeClient(env);
    const admin: any = getSupabase();
    await recordOneOffPayment(admin, stripe, input, { warn: (pi) => warnUnmatchedPayment(admin, pi, 'paid') });
  } catch (err) {
    // checkout.session.completed retries (400) so a Payment Link is never lost.
    // The intent/charge events also reach invoice and app payments, which
    // must keep returning 200 when this extra read fails; they only log.
    if (opts.retryOnError) throw err;
    console.error('[webhook] one-off payment check failed', err);
  }
}

/**
 * Store the Stripe receipt link on rows paid by a PaymentIntent (the
 * Reservation Fee, collection-flow charges). Invoices already carry theirs
 * (extractPaymentReceiptFields). charge.succeeded is not subscribed on the
 * live endpoint, so the charge is read from the intent. Fills nulls only and
 * never fails the event.
 */
async function fillIntentReceipt(pi: any, env: StripeEnv) {
  try {
    if (!pi?.id) return;
    let charge: any = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
    const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : charge?.id ?? null;
    if (!charge && chargeId) {
      const stripe = webhookDeps.stripe ?? createStripeClient(env);
      charge = await stripe.charges.retrieve(chargeId);
    }
    const receipt = safeReceiptUrl(charge?.receipt_url);
    if (!receipt) return;
    const admin: any = getSupabase();
    const chargeRef = charge?.id ?? chargeId;
    // Receipt link only: never status, amount or paid_date, and never over a stored link.
    await admin.from('payments').update({ stripe_receipt_url: receipt, stripe_charge_id: chargeRef }).eq('stripe_payment_intent_id', pi.id).is('stripe_receipt_url', null);
    const ids = String(pi.metadata?.paymentIds ?? '').split(',').map((x: string) => x.trim()).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x));
    if (ids.length) await admin.from('payments').update({ stripe_receipt_url: receipt, stripe_charge_id: chargeRef }).in('id', ids).is('stripe_receipt_url', null);
  } catch (err) {
    console.error('[webhook] receipt link fill failed', err);
  }
}

/**
 * The pickup payment just landed: the one Driver Portal welcome may now go
 * (portal-welcome.server.ts decides: picked up, paid, pending, never sent).
 * Never for the Reservation Fee. Never fails the event.
 */
async function welcomeAfterPaid(ref: { invoiceId?: string | null; paymentIntentId?: string | null; paymentIds?: string[]; rentalId?: string | null; reason?: string | null }) {
  try {
    if (String(ref.reason ?? '').toLowerCase() === 'reservation_fee') return;
    const admin: any = getSupabase();
    const pairs = new Map<string, { rentalId: string | null; applicationId: string | null }>();
    const add = (row: any) => {
      if (!row || String(row.reason ?? '').toLowerCase() === 'reservation_fee') return;
      pairs.set(`${row.rental_id ?? ''}|${row.driver_id ?? ''}`, { rentalId: row.rental_id ?? null, applicationId: row.driver_id ?? null });
    };
    const cols = 'rental_id,driver_id,reason,status';
    if (ref.invoiceId) ((await admin.from('payments').select(cols).eq('stripe_invoice_id', ref.invoiceId).eq('status', 'paid')).data ?? []).forEach(add);
    if (ref.paymentIntentId) ((await admin.from('payments').select(cols).eq('stripe_payment_intent_id', ref.paymentIntentId).eq('status', 'paid')).data ?? []).forEach(add);
    if (ref.paymentIds?.length) ((await admin.from('payments').select(cols).in('id', ref.paymentIds).eq('status', 'paid')).data ?? []).forEach(add);
    if (!pairs.size && ref.rentalId) pairs.set(ref.rentalId, { rentalId: ref.rentalId, applicationId: null });
    if (!pairs.size) return;
    const welcome = webhookDeps.welcome ?? (await import('@/lib/portal-welcome.server')).maybeWelcomeAfterPayment;
    for (const pair of pairs.values()) await welcome(admin, { ...pair, reason: ref.reason ?? null });
  } catch (err) {
    console.error('[webhook] portal welcome failed', err);
  }
}

/** A paid intent with no app metadata that the intent path left without a row. */
function unownedIntent(pi: any): boolean {
  const m = pi?.metadata ?? {};
  // rental_id (snake_case, FLEET's Payment Links) is not read by the intent
  // path, so the one-off recorder must still see it.
  return !m.paymentIds && !m.rentalId && !m.applicationId && !m.agreementId && m.reason !== 'reservation_fee';
}

async function handleVerifiedPaymentEvent(event: { type: string; data: { object: any } }, env: StripeEnv) {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object, env);
      break;
    case 'payment_intent.succeeded':
      await upsertPaymentFromPaymentIntent(event.data.object, 'paid');
      await holdReservationAfterFee(event.data.object);
      await fillIntentReceipt(event.data.object, env);
      await welcomeAfterPaid({
        paymentIntentId: stripeId(event.data.object?.id),
        paymentIds: String(event.data.object?.metadata?.paymentIds ?? '').split(',').map((x: string) => x.trim()).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)),
        rentalId: (event.data.object?.metadata?.rentalId as string | undefined) ?? null,
        reason: (event.data.object?.metadata?.reason as string | undefined) ?? null,
      });
      if (unownedIntent(event.data.object)) {
        await recordOneOff({ paymentIntentId: stripeId(event.data.object?.id), paymentIntent: event.data.object }, env, { retryOnError: false });
      }
      break;
    case 'charge.succeeded':
      if (event.data.object?.paid && unownedIntent(event.data.object)) {
        await recordOneOff({ paymentIntentId: stripeId(event.data.object?.payment_intent), charge: event.data.object }, env, { retryOnError: false });
      }
      break;
    case 'payment_intent.payment_failed':
      await upsertPaymentFromPaymentIntent(event.data.object, 'failed');
      break;
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
      await upsertPaymentFromInvoice(event.data.object, 'paid');
      await welcomeAfterPaid({ invoiceId: stripeId(event.data.object?.id) });
      break;
    case 'invoice.payment_failed':
      await upsertPaymentFromInvoice(event.data.object, 'failed');
      break;
    case 'charge.refunded':
      await handleChargeRefunded(event.data.object);
      break;
    case 'customer.subscription.created':
      await handleSubscriptionCreated(event.data.object);
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
  deps: WebhookDeps = {},
): Promise<Response> {
  const previous = webhookAdmin;
  const previousDeps = webhookDeps;
  webhookAdmin = admin;
  webhookDeps = deps;
  try {
    await handleVerifiedPaymentEvent(event, env);
    return Response.json({ received: true });
  } catch (e) {
    console.error('Webhook error:', e);
    return new Response('Webhook error', { status: 400 });
  } finally {
    webhookAdmin = previous;
    webhookDeps = previousDeps;
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