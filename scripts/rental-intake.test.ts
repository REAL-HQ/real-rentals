import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateIntake, planPaymentImport, summarizeSubscription, collectedTotal, type IntakeFacts, type IntakeInput } from "../src/lib/rental-intake";

// Synthetic data only. No database, no Stripe.
const input: IntakeInput = {
  applicationId: "a", vehicleId: "v", pickupDate: "2026-10-15", pickupMileage: 100000,
  weeklyRate: 350, depositCollected: null, stripeCustomerId: "cus_T", stripeSubscriptionId: "sub_T",
};
const sub = summarizeSubscription({
  id: "sub_T", customer: "cus_T", status: "active", cancel_at_period_end: false,
  items: { data: [{ quantity: 1, current_period_end: 1792022400, price: { unit_amount: 35000, recurring: { interval: "week", interval_count: 1 } } }] },
});
const facts = (o: Partial<IntakeFacts> = {}): IntakeFacts => ({
  today: "2026-10-16", driver: { id: "a", status: "reviewing" }, vehicle: { id: "v", status: "available", archived: false },
  rentalReadyMissing: [], activeRentalOnVehicle: false, activeRentalForDriver: false, duplicateRental: false,
  mileageHistoryMax: 99000, subscription: sub, stripeChecked: true, stripeLiveBlocked: false,
  subscriptionLinkedElsewhere: false, ...o,
});
const codes = (f: IntakeFacts, i = input) => evaluateIntake(i, f).map((b) => b.code);

describe("Record Rental rules", () => {
  it("clean case passes", () => expect(codes(facts())).toEqual([]));
  it("prevents duplicates and overlaps", () => {
    expect(codes(facts({ duplicateRental: true }))).toContain("duplicate_rental");
    expect(codes(facts({ activeRentalOnVehicle: true }))).toContain("vehicle_busy");
    expect(codes(facts({ activeRentalForDriver: true }))).toContain("driver_has_active_rental");
  });
  it("keeps readiness and safety", () => {
    expect(codes(facts({ rentalReadyMissing: ["vin"] }))).toContain("vehicle_not_ready");
    expect(codes(facts({ vehicle: { id: "v", status: "sold", archived: false } }))).toContain("vehicle_unavailable");
    expect(codes(facts({ mileageHistoryMax: 120000 }))).toContain("mileage_below_history");
    expect(codes(facts(), { ...input, pickupDate: "2026-10-20" })).toContain("future_pickup");
  });
  it("verifies the existing subscription", () => {
    expect(codes(facts({ subscriptionLinkedElsewhere: true }))).toContain("subscription_already_linked");
    expect(codes(facts(), { ...input, weeklyRate: 375 })).toContain("subscription_amount_mismatch");
    expect(codes(facts({ subscription: { ...sub, interval: "month" } }))).toContain("subscription_not_weekly");
    expect(codes(facts({ subscription: { ...sub, customerId: "cus_X" } }))).toContain("subscription_customer_mismatch");
    expect(codes(facts({ subscription: { ...sub, status: "canceled" } }))).toContain("subscription_inactive");
    expect(codes(facts({ stripeLiveBlocked: true, subscription: null, stripeChecked: false }))).toEqual(["stripe_live_not_approved"]);
  });
  it("uses Stripe's next billing date", () => expect(sub.nextBillingDate).toBe("2026-10-15"));
  it("deposit unknown stays Not Set", () => expect(codes(facts(), { ...input, depositCollected: null })).toEqual([]));
});

describe("Payment import", () => {
  const paid = { id: "in_1", status: "paid", amount_paid: 35000, amount_due: 35000, payment_intent: "pi_1", charge: { id: "ch_1", amount_refunded: 0 }, period_start: 1792022400, status_transitions: { paid_at: 1792022400 } };
  it("imports paid once, dedupes by invoice/PI/charge", () => {
    expect(planPaymentImport([paid, paid], { invoiceIds: [], paymentIntentIds: [], chargeIds: [] })).toHaveLength(1);
    expect(planPaymentImport([paid], { invoiceIds: ["in_1"], paymentIntentIds: [], chargeIds: [] })).toHaveLength(0);
    expect(planPaymentImport([{ ...paid, id: "in_2" }], { invoiceIds: [], paymentIntentIds: ["pi_1"], chargeIds: [] })).toHaveLength(0);
    expect(planPaymentImport([{ ...paid, id: "in_3", payment_intent: null }], { invoiceIds: [], paymentIntentIds: [], chargeIds: ["ch_1"] })).toHaveLength(0);
  });
  it("keeps refunds and failures, skips projected", () => {
    const rows = planPaymentImport([
      { ...paid, id: "in_r", payment_intent: "pi_r", charge: { id: "ch_r", amount_refunded: 35000 } },
      { id: "in_f", status: "open", amount_due: 35000, attempt_count: 2, period_start: 1792022400 },
      { id: "in_u", status: "open", amount_due: 35000, attempt_count: 0 },
      { id: "upcoming_x", object: "upcoming", status: "draft", amount_due: 35000 },
    ], { invoiceIds: [], paymentIntentIds: [], chargeIds: [] });
    expect(rows.map((r) => r.status)).toEqual(["refunded", "failed"]);
    expect(collectedTotal(rows)).toBe(0);
  });
});

describe("No-charge guarantees (source check)", () => {
  const src = readFileSync("src/lib/rental-intake.functions.ts", "utf8").replace(/\/\/.*$/gm, "");
  it("never writes to Stripe, messages, or provisions logins", () => {
    expect(src).not.toMatch(/\.(create|update|cancel|del|pay|finalizeInvoice|confirm)\s*\(/);
    expect(src).not.toMatch(/sendEmail|sendSms|provisionDriverAccount|startRentalAutopay|chargeCardOnRental|inviteUserByEmail/);
  });
  it("creates rentals only through the transaction, behind Manager + typed confirmation", () => {
    expect(src).not.toMatch(/from\("rentals"\)\s*\.(insert|update|upsert)/);
    expect(src).toMatch(/record_existing_rental_tx/);
    expect(src).toMatch(/requireManager/);
    expect(src).toMatch(/RECORD_CONFIRM_PHRASE/);
  });
});
