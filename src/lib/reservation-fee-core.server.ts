/**
 * The light half of the Reservation Fee code: the switch, the paid-fee lookup
 * and the week-1 credit at activation. Kept apart from
 * reservation-fee.server.ts so the activation path does not pull in the
 * reservation-confirmation / FLEET webhook code. See src/lib/reservation-fee.ts.
 */
import {
  readReservationFeeSettings,
  RESERVATION_FEE_REASON,
  RESERVATION_FEE_SETTINGS_KEY,
  type ReservationFeeSettings,
} from "@/lib/reservation-fee";

type Admin = any;
type StripeLike = any;

export type ReservationFeeCoreDeps = {
  settings?: ReservationFeeSettings;
  stripe?: StripeLike | null;
  audit?: (e: { action: string; summary: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) => Promise<void>;
};

export async function loadReservationFeeSettings(admin: Admin): Promise<ReservationFeeSettings> {
  const r = await admin.from("app_settings").select("value").eq("key", RESERVATION_FEE_SETTINGS_KEY).maybeSingle();
  return readReservationFeeSettings(r?.error ? null : r?.data?.value);
}

export async function stripeClient(deps: ReservationFeeCoreDeps): Promise<StripeLike | null> {
  if (deps.stripe !== undefined) return deps.stripe;
  const { checkoutStripeEnv } = await import("@/lib/initial-payment.server");
  const env = checkoutStripeEnv();
  if (!env) return null;
  const { createStripeClient } = await import("@/lib/stripe.server");
  return createStripeClient(env);
}

const audit = (deps: ReservationFeeCoreDeps) => deps.audit ?? (async (e: any) => (await import("@/lib/audit.server")).logAudit(null, e));

/** The paid (or applied) Reservation Fee row for an application, if any. */
export async function paidReservationFee(admin: Admin, applicationId: string, opts: { includeCredited?: boolean } = {}): Promise<{ id: string; amount: number; rental_id: string | null; notes: string } | null> {
  const r = await admin.from("payments").select("id,amount,status,rental_id,notes,reason").eq("driver_id", applicationId).eq("reason", RESERVATION_FEE_REASON).eq("status", "paid").limit(5);
  // A fee kept for a missed pickup (late-pickup.server.ts) never holds another car or credits a week.
  // One already credited to a week holds nothing new either.
  const row = ((r?.data ?? []) as any[]).find((p) => !/\bkept:/.test(String(p.notes ?? "")) && (opts.includeCredited || !/credited_week1/.test(String(p.notes ?? ""))));
  return row ? { id: row.id, amount: Number(row.amount), rental_id: row.rental_id ?? null, notes: String(row.notes ?? "") } : null;
}

/**
 * Week 1 credit at activation: a paid Reservation Fee becomes a Stripe customer
 * balance credit (-$50), which Stripe applies to the renter's next invoice
 * (their week 1 subscription invoice). Once per fee (idempotency key and a
 * note on the row). Switch off, no paid fee, already credited: nothing.
 */
export async function applyReservationFeeCredit(admin: Admin, rentalId: string, deps: ReservationFeeCoreDeps = {}): Promise<{ status: "off" | "none" | "already" | "credited" | "no_customer" | "failed"; amount?: number }> {
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
