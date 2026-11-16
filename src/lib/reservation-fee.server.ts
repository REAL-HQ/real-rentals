/**
 * Charge the Reservation Fee after signing, hold the car once it is paid, and
 * credit it to week 1 at activation. See src/lib/reservation-fee.ts.
 *
 * Money safety (same rules as payment-collection.server.ts):
 *   - The charge row (payments, type fee, reason reservation_fee, notes
 *     reservation_fee:<agreement id>) is written BEFORE Stripe is called.
 *   - One row per agreement; a paid or refunded row is never charged again.
 *   - One off-session attempt per call with an idempotency key per attempt.
 *     An outcome Stripe has not confirmed stays pending (the payments webhook
 *     settles it via metadata.paymentIds); only a reported decline is failed.
 *   - Never throws out to signing.
 */
import {
  readReservationFeeSettings,
  RESERVATION_FEE_REASON,
  RESERVATION_FEE_SETTINGS_KEY,
  reservationFeeNote,
  signedReservationFee,
  type ReservationFeeOutcome,
  type ReservationFeeSettings,
} from "@/lib/reservation-fee";

type Admin = any;
type StripeLike = any;

export type ReservationFeeDeps = {
  settings?: ReservationFeeSettings;
  stripe?: StripeLike | null;
  audit?: (e: { action: string; summary: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) => Promise<void>;
};

export async function loadReservationFeeSettings(admin: Admin): Promise<ReservationFeeSettings> {
  const r = await admin.from("app_settings").select("value").eq("key", RESERVATION_FEE_SETTINGS_KEY).maybeSingle();
  return readReservationFeeSettings(r?.error ? null : r?.data?.value);
}

async function stripeClient(deps: ReservationFeeDeps): Promise<StripeLike | null> {
  if (deps.stripe !== undefined) return deps.stripe;
  const { checkoutStripeEnv } = await import("@/lib/initial-payment.server");
  const env = checkoutStripeEnv();
  if (!env) return null;
  const { createStripeClient } = await import("@/lib/stripe.server");
  return createStripeClient(env);
}

const audit = (deps: ReservationFeeDeps) => deps.audit ?? (async (e: any) => (await import("@/lib/audit.server")).logAudit(null, e));

/** The paid (or applied) Reservation Fee row for an application, if any. */
export async function paidReservationFee(admin: Admin, applicationId: string, opts: { includeCredited?: boolean } = {}): Promise<{ id: string; amount: number; rental_id: string | null; notes: string } | null> {
  const r = await admin.from("payments").select("id,amount,status,rental_id,notes,reason").eq("driver_id", applicationId).eq("reason", RESERVATION_FEE_REASON).eq("status", "paid").limit(5);
  // A fee kept for a missed pickup (late-pickup.server.ts) never holds another car or credits a week.
  // One already credited to a week holds nothing new either.
  const row = ((r?.data ?? []) as any[]).find((p) => !/\bkept:/.test(String(p.notes ?? "")) && (opts.includeCredited || !/credited_week1/.test(String(p.notes ?? ""))));
  return row ? { id: row.id, amount: Number(row.amount), rental_id: row.rental_id ?? null, notes: String(row.notes ?? "") } : null;
}

/** Mark an open reservation for this application as fee paid (applied to week 1). */
export async function holdReservationForFee(admin: Admin, applicationId: string, fee: { id: string; amount: number }): Promise<string | null> {
  const r = await admin.from("rentals").select("id,status").eq("application_id", applicationId).eq("status", "reserved").limit(1);
  const res = ((r?.data ?? []) as any[])[0];
  if (!res) return null;
  await admin.from("rentals").update({
    reservation_deposit_required: true,
    reservation_deposit_amount: fee.amount,
    // "applied": a Reservation Fee is credited to week 1, never carried as a security deposit.
    reservation_deposit_status: "applied",
    reservation_deposit_payment_id: fee.id,
  }).eq("id", res.id).eq("status", "reserved");
  await admin.from("payments").update({ rental_id: res.id }).eq("id", fee.id).is("rental_id", null);
  try {
    const { maybeConfirmReservation } = await import("@/lib/reservation-confirmation.server");
    await maybeConfirmReservation(admin, { rentalId: res.id });
  } catch { /* never fails the charge */ }
  return res.id as string;
}

export async function chargeReservationFeeAfterSigning(admin: Admin, agreementId: string, deps: ReservationFeeDeps = {}): Promise<ReservationFeeOutcome> {
  try {
    const settings = deps.settings ?? (await loadReservationFeeSettings(admin));
    if (!settings.enabled) return { status: "off" };
    const { data: ag } = await admin.from("agreements").select("id,application_id,status,body,merge_data,vehicle_id,signed_at").eq("id", agreementId).maybeSingle();
    if (!ag?.application_id || ag.status !== "signed") return { status: "not_found" };
    const amount = signedReservationFee(ag);
    if (amount === null) return { status: "no_fee_on_agreement" };
    const appId = String(ag.application_id);
    const note = reservationFeeNote(agreementId);

    // One charge row per agreement, written before any attempt.
    const { data: existing } = await admin.from("payments").select("id,status,amount,attempt_count,notes").eq("driver_id", appId).eq("notes", note).limit(5);
    let row = ((existing ?? []) as any[]).find((p) => p.status !== "void") ?? null;
    if (row && (row.status === "paid" || row.status === "refunded" || row.status === "waived")) {
      if (row.status === "paid") await holdReservationForFee(admin, appId, { id: row.id, amount: Number(row.amount) });
      return { status: "already_paid", amount: Number(row.amount), paymentId: row.id };
    }
    if (row && row.status === "pending") return { status: "pending", amount: Number(row.amount), paymentId: row.id, last4: null };
    if (!row) {
      const ins = await admin.from("payments").insert({
        driver_id: appId, vehicle_id: ag.vehicle_id ?? null, type: "fee", reason: RESERVATION_FEE_REASON,
        amount, balance_due: amount, status: "current", due_date: new Date().toISOString().slice(0, 10), notes: note,
      }).select("id,status,amount,attempt_count").single();
      if (ins.error || !ins.data) return { status: "failed", amount, paymentId: null, error: "Could not record the Reservation Fee." };
      row = ins.data;
    }

    const { data: app } = await admin.from("applications").select("id,stripe_customer_id,stripe_payment_method_id,card_last4").eq("id", appId).maybeSingle();
    if (!app?.stripe_customer_id || !app?.stripe_payment_method_id) {
      await admin.from("payments").update({ status: "unpaid", failure_reason: "No card on file" }).eq("id", row.id).in("status", ["current", "failed", "unpaid"]);
      return { status: "no_card", amount, paymentId: row.id };
    }
    const stripe = await stripeClient(deps);
    if (!stripe) return { status: "failed", amount, paymentId: row.id, error: "Card payments are not configured." };

    const attempt = Number(row.attempt_count ?? 0) + 1;
    const claim = await admin.from("payments").update({ status: "pending", attempt_count: attempt, last_attempt_at: new Date().toISOString() })
      .eq("id", row.id).in("status", ["current", "failed", "unpaid"]).lt("attempt_count", attempt).select("id");
    if (!(claim?.data ?? []).length) return { status: "pending", amount, paymentId: row.id, last4: null };

    try {
      const pi = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), currency: "usd",
        customer: app.stripe_customer_id, payment_method: app.stripe_payment_method_id,
        off_session: true, confirm: true,
        description: "Reservation Fee (applied to week 1)",
        metadata: { applicationId: appId, agreementId, paymentIds: row.id, reason: RESERVATION_FEE_REASON, attempt: String(attempt) },
      }, { idempotencyKey: `reservation-fee:${row.id}:attempt:${attempt}` });
      const paid = pi?.status === "succeeded";
      await admin.from("payments").update({
        status: paid ? "paid" : "pending", stripe_payment_intent_id: pi?.id ?? null,
        ...(paid ? { paid_date: new Date().toISOString().slice(0, 10), balance_due: 0, failure_reason: null } : {}),
      }).eq("id", row.id).eq("status", "pending").eq("attempt_count", attempt);
      await audit(deps)({ action: paid ? "payment.reservation_fee_charged" : "payment.reservation_fee_processing", summary: `Reservation Fee $${amount.toFixed(2)} ${paid ? "charged" : "processing"} after signing (applied to week 1)`, entityType: "payment", entityId: row.id, metadata: { agreement_id: agreementId, application_id: appId, automatic: true } }).catch(() => {});
      if (paid) await holdReservationForFee(admin, appId, { id: row.id, amount });
      return { status: paid ? "paid" : "pending", amount, paymentId: row.id, last4: app.card_last4 ?? null };
    } catch (e: any) {
      const { stripeDefinitelyNotCharged } = await import("@/lib/payment-collection.server");
      const message = String(e?.message ?? "Card charge failed").slice(0, 300);
      if (!stripeDefinitelyNotCharged(e)) return { status: "pending", amount, paymentId: row.id, last4: null };
      await admin.from("payments").update({ status: "failed", failure_reason: message }).eq("id", row.id).eq("status", "pending").eq("attempt_count", attempt);
      await audit(deps)({ action: "payment.reservation_fee_failed", summary: `Reservation Fee $${amount.toFixed(2)} declined after signing`, entityType: "payment", entityId: row.id, metadata: { agreement_id: agreementId, application_id: appId, automatic: true } }).catch(() => {});
      return { status: "failed", amount, paymentId: row.id, error: message };
    }
  } catch (e) {
    console.error("[reservation-fee] charge failed", e);
    return { status: "failed", amount: 0, paymentId: null, error: "Unexpected error" };
  }
}

/**
 * Week 1 credit at activation: a paid Reservation Fee becomes a Stripe customer
 * balance credit (-$50), which Stripe applies to the renter's next invoice
 * (their week 1 subscription invoice). Once per fee (idempotency key and a
 * note on the row). Switch off, no paid fee, already credited: nothing.
 */
export async function applyReservationFeeCredit(admin: Admin, rentalId: string, deps: ReservationFeeDeps = {}): Promise<{ status: "off" | "none" | "already" | "credited" | "no_customer" | "failed"; amount?: number }> {
  try {
    const settings = deps.settings ?? (await loadReservationFeeSettings(admin));
    if (!settings.enabled) return { status: "off" };
    const { data: rental } = await admin.from("rentals").select("id,application_id,stripe_customer_id,status").eq("id", rentalId).maybeSingle();
    if (!rental?.application_id) return { status: "none" };
    const fee = await paidReservationFee(admin, rental.application_id, { includeCredited: true });
    if (!fee) return { status: "none" };
    if (/credited_week1/.test(fee.notes)) return { status: "already" };
    let customer = rental.stripe_customer_id as string | null;
    if (!customer) {
      const { data: app } = await admin.from("applications").select("stripe_customer_id").eq("id", rental.application_id).maybeSingle();
      customer = app?.stripe_customer_id ?? null;
    }
    if (!customer) return { status: "no_customer" };
    const stripe = await stripeClient(deps);
    if (!stripe) return { status: "failed" };
    await stripe.customers.createBalanceTransaction(customer, {
      amount: -Math.round(fee.amount * 100), currency: "usd",
      description: "Reservation Fee applied to week 1",
      metadata: { paymentId: fee.id, rentalId, reason: "reservation_fee_credit" },
    }, { idempotencyKey: `reservation-fee-credit:${fee.id}` });
    await admin.from("payments").update({ rental_id: rentalId, notes: `${fee.notes} credited_week1:${rentalId}` }).eq("id", fee.id);
    await audit(deps)({ action: "payment.reservation_fee_credited", summary: `Reservation Fee $${fee.amount.toFixed(2)} credited to week 1`, entityType: "rental", entityId: rentalId, metadata: { payment_id: fee.id, automatic: true } }).catch(() => {});
    return { status: "credited", amount: fee.amount };
  } catch (e) {
    console.error("[reservation-fee] week-1 credit failed", e);
    return { status: "failed" };
  }
}
