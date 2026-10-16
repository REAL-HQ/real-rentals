// Record Rental — pure rules for rentals that already started outside REAL RENTALS.
//
// No I/O here. The server functions gather facts and call these; tests call
// them directly. Two guarantees live in this file:
//   1. Every reason not to record a rental is returned at once (blockers).
//   2. Payment import only ever records money Stripe says actually moved —
//      once per invoice / PaymentIntent / charge, never projected revenue.

export type IntakeBlockerCode =
  | "no_driver"
  | "no_vehicle"
  | "vehicle_unavailable"
  | "vehicle_not_ready"
  | "vehicle_busy"
  | "driver_has_active_rental"
  | "duplicate_rental"
  | "invalid_rate"
  | "invalid_deposit"
  | "invalid_dates"
  | "future_pickup"
  | "mileage_below_history"
  | "stripe_not_checked"
  | "stripe_live_not_approved"
  | "subscription_not_found"
  | "subscription_inactive"
  | "subscription_customer_mismatch"
  | "subscription_not_weekly"
  | "subscription_amount_mismatch"
  | "subscription_already_linked"
  | "db_not_installed"
  | "confirmation_required";

export type IntakeBlocker = { code: IntakeBlockerCode; message: string };

export type IntakeInput = {
  applicationId: string;
  vehicleId: string;
  pickupDate: string; // YYYY-MM-DD
  pickupMileage: number | null;
  weeklyRate: number;
  /** Deposit actually collected. null = Not Set (never invented). */
  depositCollected: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

export type SubscriptionSummary = {
  id: string;
  customerId: string;
  status: string;
  weeklyAmount: number | null;
  interval: string | null;
  intervalCount: number | null;
  /** Stripe's own next billing date (YYYY-MM-DD), never computed by us. */
  nextBillingDate: string | null;
  cancelAtPeriodEnd: boolean;
};

export type IntakeFacts = {
  today: string;
  driver: { id: string; status: string | null } | null;
  vehicle: { id: string; status: string | null; archived: boolean } | null;
  rentalReadyMissing: string[];
  activeRentalOnVehicle: boolean;
  activeRentalForDriver: boolean;
  /** Any rental (any status) for this driver + vehicle starting the same day. */
  duplicateRental: boolean;
  mileageHistoryMax: number | null;
  /** null when no Stripe IDs were given. */
  subscription: SubscriptionSummary | null;
  stripeChecked: boolean;
  stripeLiveBlocked: boolean;
  subscriptionLinkedElsewhere: boolean;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function evaluateIntake(input: IntakeInput, f: IntakeFacts): IntakeBlocker[] {
  const b: IntakeBlocker[] = [];
  const add = (code: IntakeBlockerCode, message: string) => b.push({ code, message });

  if (!f.driver) add("no_driver", "Driver not found.");
  if (!f.vehicle) add("no_vehicle", "Vehicle not found.");
  else if (f.vehicle.archived || ["archived", "sold", "retired"].includes(String(f.vehicle.status)))
    add("vehicle_unavailable", "This vehicle is archived, sold or retired.");
  if (f.vehicle && f.rentalReadyMissing.length)
    add("vehicle_not_ready", `Vehicle is not Rental Ready (missing: ${f.rentalReadyMissing.join(", ")}).`);
  if (f.activeRentalOnVehicle) add("vehicle_busy", "This vehicle is already on an active rental.");
  if (f.activeRentalForDriver) add("driver_has_active_rental", "This driver already has an active rental.");
  if (f.duplicateRental) add("duplicate_rental", "A rental for this driver, vehicle and pickup date already exists.");

  if (!(input.weeklyRate > 0) || input.weeklyRate > 100000) add("invalid_rate", "Enter the weekly rate.");
  if (input.depositCollected != null && (input.depositCollected < 0 || input.depositCollected > 100000))
    add("invalid_deposit", "Deposit must be zero or more.");
  if (!ISO.test(input.pickupDate)) add("invalid_dates", "Enter the pickup date.");
  else if (input.pickupDate > f.today) add("future_pickup", "Pickup date cannot be in the future — use Activate Rental for new rentals.");
  if (input.pickupMileage != null && f.mileageHistoryMax != null && input.pickupMileage + 500 < f.mileageHistoryMax)
    add("mileage_below_history", `Pickup mileage is below this vehicle's history (${f.mileageHistoryMax.toLocaleString()} mi).`);

  const wantsStripe = !!(input.stripeCustomerId || input.stripeSubscriptionId);
  if (wantsStripe) {
    if (f.stripeLiveBlocked) add("stripe_live_not_approved", "Live Stripe lookups are not approved yet.");
    else if (!f.stripeChecked) add("stripe_not_checked", "Check the Stripe subscription first.");
    else if (!f.subscription) add("subscription_not_found", "Stripe subscription not found.");
    else {
      const s = f.subscription;
      if (!["active", "trialing", "past_due"].includes(s.status))
        add("subscription_inactive", `Subscription is ${s.status}.`);
      if (input.stripeCustomerId && s.customerId !== input.stripeCustomerId)
        add("subscription_customer_mismatch", "Subscription belongs to a different Stripe customer.");
      if (!(s.interval === "week" && s.intervalCount === 1))
        add("subscription_not_weekly", "Subscription does not bill weekly.");
      if (s.weeklyAmount == null || Math.abs(s.weeklyAmount - input.weeklyRate) > 0.005)
        add("subscription_amount_mismatch", `Stripe bills ${s.weeklyAmount ?? "?"} — weekly rate entered is ${input.weeklyRate}.`);
      if (f.subscriptionLinkedElsewhere)
        add("subscription_already_linked", "This subscription is already linked to another rental.");
    }
  }
  return b;
}

/** Normalise a Stripe subscription object (basil puts periods on the item). */
export function summarizeSubscription(sub: any): SubscriptionSummary {
  const item = sub?.items?.data?.[0];
  const price = item?.price ?? {};
  const qty = Number(item?.quantity ?? 1);
  const end = item?.current_period_end ?? sub?.current_period_end ?? null;
  return {
    id: String(sub.id),
    customerId: typeof sub.customer === "string" ? sub.customer : String(sub.customer?.id ?? ""),
    status: String(sub.status),
    weeklyAmount: price.unit_amount != null ? (Number(price.unit_amount) * qty) / 100 : null,
    interval: price.recurring?.interval ?? null,
    intervalCount: price.recurring?.interval_count ?? null,
    nextBillingDate: end ? new Date(Number(end) * 1000).toISOString().slice(0, 10) : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
  };
}

export type PaymentImportRow = {
  stripe_invoice_id: string;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  amount: number;
  refunded_amount: number;
  status: "paid" | "failed" | "refunded" | "partially_refunded";
  due_date: string;
  paid_date: string | null;
  failure_reason: string | null;
};

const idOf = (v: any): string | null => (v == null ? null : typeof v === "string" ? v : v.id ?? null);
const day = (unix: any) => (unix ? new Date(Number(unix) * 1000).toISOString().slice(0, 10) : null);

/**
 * Turn Stripe invoices into payment rows to record — once each.
 *
 * Skipped: drafts, voids, upcoming/projected invoices, and anything already
 * recorded by invoice, PaymentIntent or charge id. Refunds and failures are
 * kept, never dropped. Pure; inserts happen in one DB transaction.
 */
export function planPaymentImport(
  invoices: any[],
  existing: { invoiceIds: string[]; paymentIntentIds: string[]; chargeIds: string[] },
): PaymentImportRow[] {
  const seenInv = new Set(existing.invoiceIds);
  const seenPi = new Set(existing.paymentIntentIds);
  const seenCh = new Set(existing.chargeIds);
  const out: PaymentImportRow[] = [];

  for (const inv of invoices ?? []) {
    if (!inv?.id || inv.object === "upcoming" || String(inv.id).startsWith("upcoming")) continue;
    if (inv.status === "draft" || inv.status === "void") continue;
    const pi = idOf(inv.payment_intent) ?? idOf(inv.payments?.data?.[0]?.payment?.payment_intent);
    const charge = idOf(inv.charge) ?? idOf(inv.payment_intent?.latest_charge);
    if (seenInv.has(inv.id) || (pi && seenPi.has(pi)) || (charge && seenCh.has(charge))) continue;

    const paidCents = Number(inv.amount_paid ?? 0);
    const dueCents = Number(inv.amount_due ?? 0);
    const refundedCents = Number(inv.charge?.amount_refunded ?? inv.post_payment_credit_notes_amount ?? 0);
    let status: PaymentImportRow["status"];
    if (inv.status === "paid" && paidCents > 0) {
      status = refundedCents >= paidCents ? "refunded" : refundedCents > 0 ? "partially_refunded" : "paid";
    } else if (inv.status === "open" || inv.status === "uncollectible") {
      if (!Number(inv.attempt_count ?? 0)) continue; // not attempted yet = projected, not a failure
      status = "failed";
    } else continue;

    out.push({
      stripe_invoice_id: inv.id,
      stripe_payment_intent_id: pi,
      stripe_charge_id: charge,
      amount: (status === "failed" ? dueCents : paidCents) / 100,
      refunded_amount: refundedCents / 100,
      status,
      due_date: day(inv.period_start) ?? day(inv.created) ?? "1970-01-01",
      paid_date: status === "failed" ? null : day(inv.status_transitions?.paid_at),
      failure_reason: status === "failed" ? "Weekly rent charge failed" : null,
    });
    seenInv.add(inv.id);
    if (pi) seenPi.add(pi);
    if (charge) seenCh.add(charge);
  }
  return out;
}

/** Collected = paid minus refunded. Failed/open invoices are never revenue. */
export function collectedTotal(rows: PaymentImportRow[]): number {
  return rows
    .filter((r) => r.status !== "failed")
    .reduce((s, r) => s + r.amount - r.refunded_amount, 0);
}

export const RECORD_CONFIRM_PHRASE = "RECORD";
