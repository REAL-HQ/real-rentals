/**
 * Collect the Reservation Fee after signing, hold the car once it is paid, and
 * credit it to week 1 at activation. See src/lib/reservation-fee.ts.
 *
 * The card is collected only AFTER the agreement is signed (Dolmar, t309u):
 * every renter, including a returning renter with a saved card (card
 * t315s1710), gets a Stripe Checkout for the $50 that also saves the card on
 * file for the rental balance. Nothing is charged off-session for the fee.
 *
 * Money safety (same rules as payment-collection.server.ts):
 *   - The charge row (payments, type fee, reason reservation_fee, notes
 *     reservation_fee:<agreement id>) is written BEFORE Stripe is called.
 *   - One row per agreement; a paid or refunded row is never charged again.
 *   - No off-session charge for the fee, ever: one Stripe Checkout per row
 *     (idempotency key per row attempt). The payments webhook settles it via
 *     metadata.paymentIds; a re-run returns the same link.
 *   - Never throws out to signing.
 */
import {
  RESERVATION_FEE_CHECKOUT_DESCRIPTION,
  RESERVATION_FEE_CHECKOUT_TTL_MS,
  reservationFeeSubmitMessage,
  RESERVATION_FEE_REASON,
  reservationFeeNote,
  reservationFeeReturnUrls,
  reservationFeeSigningStep,
  type ReservationFeeSigningStep,
  signedReservationFee,
  type ReservationFeeOutcome,
  type ReservationFeeSettings,
} from "@/lib/reservation-fee";

import { applyReservationFeeCredit, loadReservationFeeSettings, paidReservationFee, stripeClient as coreStripeClient } from "@/lib/reservation-fee-core.server";
export { applyReservationFeeCredit, loadReservationFeeSettings, paidReservationFee };

type Admin = any;
type StripeLike = any;

export type ReservationFeeDeps = {
  settings?: ReservationFeeSettings;
  stripe?: StripeLike | null;
  audit?: (e: { action: string; summary: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) => Promise<void>;
  /** Clock for the 23-hour Checkout reuse window. */
  now?: () => number;
  /**
   * When true (default), an unpaid fee reuses its still-open Checkout.
   * Payment Not Completed sets this false to mint a new session after expiry
   * without charging a second time (same payments row).
   */
  reuseCheckout?: boolean;
};


const stripeClient = (deps: ReservationFeeDeps) => coreStripeClient(deps);

const audit = (deps: ReservationFeeDeps) => deps.audit ?? (async (e: any) => (await import("@/lib/audit.server")).logAudit(null, e));


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
  await (await import("@/lib/booking-links.server")).linkOrphansToRental(admin, res.id as string);
  try {
    const { maybeConfirmReservation } = await import("@/lib/reservation-confirmation.server");
    await maybeConfirmReservation(admin, { rentalId: res.id });
  } catch { /* never fails the charge */ }
  return res.id as string;
}

/**
 * Stripe Checkout for the Reservation Fee when no card is on file yet: one
 * per-renter session (24 hours), the $50 line, and the card saved for
 * off-session use so the rental balance can be charged to it later. The
 * charge row already exists; the session only points at it.
 */
async function reservationFeeCheckout(
  admin: Admin,
  stripe: StripeLike,
  x: { app: { id: string; full_name?: string | null; email?: string | null; phone?: string | null; stripe_customer_id?: string | null }; agreementId: string; row: { id: string; attempt_count?: number | null }; amount: number; signerEmail: string | null; deps: ReservationFeeDeps },
): Promise<ReservationFeeOutcome> {
  const { agreementId, row, amount } = x;
  try {
    let customer = x.app.stripe_customer_id ?? null;
    if (!customer) {
      const { ensureApplicationStripeCustomer } = await import("@/lib/stripe-link.server");
      customer = await ensureApplicationStripeCustomer(admin, stripe, x.app);
    }
    const attempt = Number(row.attempt_count ?? 0) + 1;
    const { publicAppOrigin } = await import("@/lib/public-app-url");
    const site = publicAppOrigin();
    const meta = { applicationId: x.app.id, agreementId, paymentIds: row.id, reason: RESERVATION_FEE_REASON };
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer,
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: Math.round(amount * 100), product_data: { name: "Reservation Fee (applied to your first week)", description: RESERVATION_FEE_CHECKOUT_DESCRIPTION } } }],
      custom_text: { submit: { message: reservationFeeSubmitMessage(amount) } },
      payment_intent_data: { setup_future_usage: "off_session", description: "Reservation Fee (applied to week 1)", metadata: meta },
      metadata: meta,
      // Return pages that explain the result (src/routes/reservation-fee.tsx).
      // The applicant usually has no login yet, so /login made no sense here.
      success_url: reservationFeeReturnUrls(site).success,
      cancel_url: reservationFeeReturnUrls(site).cancel,
      expires_at: Math.floor(Date.now() / 1000) + 23 * 3600,
    }, { idempotencyKey: `reservation-fee-checkout:${row.id}:attempt:${attempt}` });
    if (!session?.url) throw new Error("Checkout session has no url");
    // The row waits for the renter: still owed, not failed, no blind retry.
    await admin.from("payments").update({ status: "unpaid", attempt_count: attempt, failure_reason: null, balance_due: amount }).eq("id", row.id).in("status", ["current", "failed", "unpaid"]);
    const { data: ag } = await admin.from("agreements").select("metadata").eq("id", agreementId).maybeSingle();
    const metadata = { ...((ag?.metadata as Record<string, unknown> | null) ?? {}), reservation_fee_checkout: { url: session.url, session_id: (session as any).id ?? null, payment_id: row.id, created_at: new Date().toISOString() } };
    await admin.from("agreements").update({ metadata }).eq("id", agreementId);
    await audit(x.deps)({ action: "payment.reservation_fee_checkout", summary: `Reservation Fee $${amount.toFixed(2)} card checkout sent after signing (card saved on file for the rental balance)`, entityType: "payment", entityId: row.id, metadata: { agreement_id: agreementId, application_id: x.app.id, automatic: true } }).catch(() => {});
    return { status: "checkout", amount, paymentId: row.id, url: session.url };
  } catch (e: any) {
    console.error("[reservation-fee] checkout failed", e);
    await admin.from("payments").update({ status: "unpaid", failure_reason: "Card checkout could not be created" }).eq("id", row.id).in("status", ["current", "failed", "unpaid"]);
    return { status: "no_card", amount, paymentId: row.id };
  }
}

export async function chargeReservationFeeAfterSigning(admin: Admin, agreementId: string, deps: ReservationFeeDeps = {}): Promise<ReservationFeeOutcome> {
  try {
    const settings = deps.settings ?? (await loadReservationFeeSettings(admin));
    if (!settings.enabled) return { status: "off" };
    const { data: ag } = await admin.from("agreements").select("id,application_id,status,body,merge_data,metadata,vehicle_id,signed_at").eq("id", agreementId).maybeSingle();
    if (!ag?.application_id || ag.status !== "signed") return { status: "not_found" };
    // An updated agreement for an already-active rental (rental-amendment.server.ts)
    // never carries or charges a Reservation Fee: the renter already paid week 1.
    if ((ag as any)?.metadata?.amendment) return { status: "no_fee_on_agreement" };
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
    // Signing runs once, but never send a second checkout for the same fee in a re-run
    // while the stored Checkout is still within 23 hours. An expired link is not reused;
    // a new session is created on the same unpaid row below.
    const now = deps.now?.() ?? Date.now();
    if (row && row.status === "unpaid" && deps.reuseCheckout !== false) {
      const co = (ag as any)?.metadata?.reservation_fee_checkout;
      const url = co?.payment_id === row.id ? String(co.url ?? "") : "";
      const created = Date.parse(String(co?.created_at ?? ""));
      if (/^https:\/\//.test(url) && Number.isFinite(created) && now - created < RESERVATION_FEE_CHECKOUT_TTL_MS) {
        return { status: "checkout", amount: Number(row.amount), paymentId: row.id, url };
      }
    }
    if (!row) {
      const ins = await admin.from("payments").insert({
        driver_id: appId, vehicle_id: ag.vehicle_id ?? null, type: "fee", reason: RESERVATION_FEE_REASON,
        amount, balance_due: amount, status: "current", due_date: new Date().toISOString().slice(0, 10), notes: note,
      }).select("id,status,amount,attempt_count").single();
      if (ins.error || !ins.data) return { status: "failed", amount, paymentId: null, error: "Could not record the Reservation Fee." };
      row = ins.data;
    }

    const { data: app } = await admin.from("applications").select("id,full_name,email,phone,stripe_customer_id,stripe_payment_method_id,card_last4").eq("id", appId).maybeSingle();
    const stripe = await stripeClient(deps);
    // Always the Stripe link (Dolmar, t309u and card t315s1710): the card is
    // collected only AFTER signing, and a card already saved from an earlier
    // rental is never charged automatically for the fee. Stripe Checkout takes
    // the $50 and saves that card on file for the rental balance
    // (setup_future_usage off_session). The payments webhook marks the row
    // paid (metadata.paymentIds), saves the card on the application and holds
    // the car.
    if (!stripe) {
      await admin.from("payments").update({ status: "unpaid", failure_reason: "Card payments are not configured" }).eq("id", row.id).in("status", ["current", "failed", "unpaid"]);
      return { status: "no_card", amount, paymentId: row.id };
    }
    return await reservationFeeCheckout(admin, stripe, { app: app ?? { id: appId }, agreementId, row, amount, signerEmail: null, deps });
  } catch (e) {
    console.error("[reservation-fee] charge failed", e);
    return { status: "failed", amount: 0, paymentId: null, error: "Unexpected error" };
  }
}


/**
 * Read-only: the Reservation Fee step for an agreement that is ALREADY signed
 * (a double tap, a second tab, or a retry that lost the race). Never creates a
 * Checkout, never writes. Returns the stored Checkout only while it is open
 * (same row, unpaid, under 23 hours old); otherwise paid/processing/null.
 */
export async function existingReservationFeeStep(admin: Admin, agreementId: string, now: number = Date.now()): Promise<ReservationFeeSigningStep | null> {
  try {
    const { data: ag } = await admin.from("agreements").select("id,application_id,status,metadata").eq("id", agreementId).maybeSingle();
    if (!ag?.application_id || ag.status !== "signed") return null;
    if ((ag as any)?.metadata?.amendment) return null;
    const { data: rows } = await admin.from("payments").select("id,status,amount,notes").eq("driver_id", String(ag.application_id)).eq("notes", reservationFeeNote(agreementId)).limit(5);
    const row = ((rows ?? []) as any[]).find((p) => p.status !== "void") ?? null;
    if (!row) return null;
    const amount = Number(row.amount);
    if (row.status === "paid") return reservationFeeSigningStep({ status: "already_paid", amount, paymentId: row.id });
    if (row.status === "pending") return reservationFeeSigningStep({ status: "pending", amount, paymentId: row.id, last4: null });
    if (row.status !== "unpaid") return null;
    const co = (ag as any)?.metadata?.reservation_fee_checkout;
    if (!co || co.payment_id !== row.id) return null;
    const created = Date.parse(String(co.created_at ?? ""));
    if (!Number.isFinite(created) || now - created >= RESERVATION_FEE_CHECKOUT_TTL_MS) return null;
    return reservationFeeSigningStep({ status: "checkout", amount, paymentId: row.id, url: String(co.url ?? "") });
  } catch {
    return null;
  }
}

export type ReservationFeeLinkResult =
  | { ok: true; url: string; amount: number; agreementId: string; sessionId: string | null; expiresAt: string | null; reused: boolean; status: "checkout" }
  | { ok: false; message: string; agreementId: string | null; status: ReservationFeeOutcome["status"] | "no_signed_agreement" };

/**
 * One shared core for "give me the $50 Reservation Fee Checkout link for this
 * applicant" (staff Copy Reservation Fee Link and FLEET's reservation-fee-link
 * API). Needs a signed, non-amendment agreement that prints the fee. Reuses the
 * open Checkout (under 23 hours) or creates one on the same unpaid fee row; a
 * paid fee is never charged again. Sends nothing to anyone.
 */
export async function reservationFeeLinkForApplication(admin: Admin, applicationId: string, deps: ReservationFeeDeps = {}): Promise<ReservationFeeLinkResult> {
  const { data: rows } = await admin
    .from("agreements")
    .select("id,status,signed_at,metadata")
    .eq("application_id", applicationId)
    .eq("status", "signed")
    .order("signed_at", { ascending: false })
    .limit(10);
  const ag = ((rows ?? []) as any[]).find((r) => !r?.metadata?.amendment) ?? null;
  if (!ag) return { ok: false, message: "No Signed Agreement With A Reservation Fee.", agreementId: null, status: "no_signed_agreement" };
  const before = ag?.metadata?.reservation_fee_checkout?.session_id ?? null;
  const fee = await chargeReservationFeeAfterSigning(admin, ag.id as string, deps);
  const { staffReservationFeeLinkResult } = await import("@/lib/reservation-fee");
  const res = staffReservationFeeLinkResult(fee);
  if (!res.ok || fee.status !== "checkout") return { ok: false, message: res.ok ? "Card Checkout Could Not Be Created." : res.message, agreementId: ag.id as string, status: fee.status };
  const { data: fresh } = await admin.from("agreements").select("metadata").eq("id", ag.id).maybeSingle();
  const co = (fresh?.metadata as any)?.reservation_fee_checkout;
  const sessionId = co?.url === res.url ? (co?.session_id ?? null) : null;
  const created = Date.parse(String(co?.created_at ?? ""));
  const expiresAt = co?.url === res.url && Number.isFinite(created) ? new Date(created + RESERVATION_FEE_CHECKOUT_TTL_MS).toISOString() : null;
  return { ok: true, url: res.url, amount: res.amount, agreementId: ag.id as string, sessionId, expiresAt, reused: sessionId !== null && sessionId === before, status: "checkout" };
}
