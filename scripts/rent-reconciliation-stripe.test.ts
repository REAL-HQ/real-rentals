import { beforeEach, expect, it, vi } from "vitest";
import { STRIPE_CHECK_UNAVAILABLE, rentReconciliationToCsv, type RentPayment } from "../src/lib/rent-reconciliation";
import { RENT_RECONCILIATION_OFF } from "../src/lib/rent-reconciliation-flag";
import { readLiveRentStripe } from "../src/lib/rent-reconciliation-stripe.server";
import { runRentReconciliation } from "../src/lib/rent-reconciliation.server";

const stripeMock = vi.hoisted(() => {
  const chargesList = vi.fn();
  const chargesRetrieve = vi.fn();
  const chargesCreate = vi.fn();
  const refundsList = vi.fn();
  const refundsCreate = vi.fn();
  const paymentIntentsRetrieve = vi.fn();
  const invoicesRetrieve = vi.fn();
  const createStripeClient = vi.fn(() => ({
    charges: { list: chargesList, retrieve: chargesRetrieve, create: chargesCreate },
    refunds: { list: refundsList, create: refundsCreate },
    paymentIntents: { retrieve: paymentIntentsRetrieve },
    invoices: { retrieve: invoicesRetrieve },
  }));
  return { chargesList, chargesRetrieve, chargesCreate, refundsList, refundsCreate, paymentIntentsRetrieve, invoicesRetrieve, createStripeClient };
});

vi.mock("../src/lib/stripe.server", () => ({ createStripeClient: stripeMock.createStripeClient }));

import { clearStripeReaderCache, createReadOnlyStripe } from "../src/lib/stripe-reader.server";

const applications = [{ id: "driver-1", name: "Ada", stripeCustomerId: "cus_1" }];
const rentals = [{ id: "rental-1", applicationId: "driver-1", vehicleId: "vehicle-1", stripeCustomerId: "cus_1" }];
const vehicles = [{ id: "vehicle-1", label: "Unit 7" }];

function payment(over: Partial<RentPayment> = {}): RentPayment {
  return {
    id: "pay-1",
    rentalId: "rental-1",
    applicationId: "driver-1",
    vehicleId: "vehicle-1",
    type: "rent",
    status: "paid",
    amountCents: 10000,
    netCollectedCents: 10000,
    unreadable: false,
    paidDate: "2026-10-14",
    dueDate: null,
    stripePaymentIntentId: "pi_1",
    stripeInvoiceId: null,
    stripeSubscriptionId: null,
    ...over,
  };
}

function succeededCharge(over: Record<string, unknown> = {}) {
  return {
    id: "ch_1",
    amount: 10000,
    amount_captured: 10000,
    amount_refunded: 0,
    currency: "usd",
    status: "succeeded",
    customer: "cus_1",
    payment_intent: "pi_1",
    ...over,
  };
}

beforeEach(() => {
  clearStripeReaderCache();
  stripeMock.chargesList.mockReset();
  stripeMock.chargesRetrieve.mockReset();
  stripeMock.chargesCreate.mockReset();
  stripeMock.refundsList.mockReset();
  stripeMock.refundsCreate.mockReset();
  stripeMock.paymentIntentsRetrieve.mockReset();
  stripeMock.invoicesRetrieve.mockReset();
  stripeMock.createStripeClient.mockClear();
});

async function crossCheck(payments: RentPayment[]) {
  const before = structuredClone(payments);
  const result = await runRentReconciliation({
    enabled: true,
    userId: "owner",
    tier: "owner",
    now: new Date("2026-10-21T15:00:00Z"),
    weekStart: "2026-10-12",
    load: async () => ({ ok: true as const, directory: { payments, applications, rentals, vehicles } }),
    stripe: (request) => readLiveRentStripe(request),
  });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("expected a report");
  return { report: result.report, before, payments };
}

it("matches a listed charge without retrieving the payment intent again", async () => {
  stripeMock.chargesList.mockResolvedValue({ data: [succeededCharge()], has_more: false });
  stripeMock.refundsList.mockResolvedValue({ data: [], has_more: false });
  const { report, before, payments } = await crossCheck([payment()]);
  expect(payments).toEqual(before);
  expect(report.stripeCheck).toBe("ready");
  expect(report.rows[0].category).toBe("matched");
  expect(report.rows[0].stripeCapturedCents).toBe(10000);
  expect(report.rows[0].stripeRefundedCents).toBe(0);
  expect(report.totals?.matched.cents).toBe(10000);
  expect(stripeMock.createStripeClient).toHaveBeenCalledWith("live", { timeout: 20_000 });
  expect(stripeMock.chargesList).toHaveBeenCalledWith(
    expect.objectContaining({ limit: 100, created: expect.objectContaining({ gte: expect.any(Number), lt: expect.any(Number) }) }),
    expect.objectContaining({ timeout: expect.any(Number) }),
  );
  expect(stripeMock.refundsList).toHaveBeenCalled();
  expect(stripeMock.paymentIntentsRetrieve).not.toHaveBeenCalled();
  expect(stripeMock.chargesCreate).not.toHaveBeenCalled();
  expect(stripeMock.refundsCreate).not.toHaveBeenCalled();
  expect(rentReconciliationToCsv(report)).not.toContain(STRIPE_CHECK_UNAVAILABLE);
});

it("retrieves an invoice the database references and the charge behind it", async () => {
  stripeMock.chargesList.mockResolvedValue({ data: [], has_more: false });
  stripeMock.refundsList.mockResolvedValue({ data: [], has_more: false });
  stripeMock.invoicesRetrieve.mockResolvedValue({ id: "in_1", status: "paid", payment_intent: "pi_1", currency: "usd", amount_paid: 10000 });
  stripeMock.paymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", status: "succeeded", latest_charge: "ch_1", currency: "usd", amount_received: 10000 });
  stripeMock.chargesRetrieve.mockResolvedValue(succeededCharge());
  const { report } = await crossCheck([payment({ stripePaymentIntentId: null, stripeInvoiceId: "in_1" })]);
  expect(report.rows[0].category).toBe("matched");
  expect(report.rows[0].stripeCapturedCents).toBe(10000);
  expect(stripeMock.invoicesRetrieve).toHaveBeenCalledWith("in_1", {}, expect.objectContaining({ timeout: expect.any(Number) }));
  expect(stripeMock.paymentIntentsRetrieve).toHaveBeenCalledWith("pi_1", {}, expect.objectContaining({ timeout: expect.any(Number) }));
  expect(stripeMock.chargesRetrieve).toHaveBeenCalledWith("ch_1", {}, expect.objectContaining({ timeout: expect.any(Number) }));
});

it("treats a missing Stripe payment as missing and keeps the database view when Stripe errors", async () => {
  stripeMock.chargesList.mockResolvedValue({ data: [], has_more: false });
  stripeMock.refundsList.mockResolvedValue({ data: [], has_more: false });
  stripeMock.paymentIntentsRetrieve.mockRejectedValue({ statusCode: 404, code: "resource_missing" });
  const missing = await crossCheck([payment()]);
  expect(missing.report.stripeCheck).toBe("ready");
  expect(missing.report.rows[0].category).toBe("missing_or_failed");
  expect(missing.report.rows[0].evidence[0]).toBe("Stripe has no captured charge for this payment. This is evidence only.");
  expect(missing.report.rows[0].amountCents).toBe(10000);

  clearStripeReaderCache();
  stripeMock.chargesList.mockResolvedValue({ data: [], has_more: false });
  stripeMock.refundsList.mockResolvedValue({ data: [], has_more: false });
  stripeMock.paymentIntentsRetrieve.mockRejectedValue(new Error("Stripe unavailable"));
  const failed = await crossCheck([payment()]);
  expect(failed.report.stripeCheck).toBe("unavailable");
  expect(failed.report.rows[0].category).toBeNull();
  expect(failed.report.rows[0].amountCents).toBe(10000);
  expect(failed.report.rows[0].statusLabel).toBe("Paid");
  expect(failed.report.totals).toBeNull();
  expect(failed.report.warnings).toEqual([]);
  expect(rentReconciliationToCsv(failed.report)).toContain(STRIPE_CHECK_UNAVAILABLE);
});

it("shows Stripe check unavailable and keeps the database payment when the charge list is capped", async () => {
  let page = 0;
  stripeMock.chargesList.mockImplementation(async () => ({
    data: [{ id: `ch_${++page}`, amount: 10000, amount_captured: 10000, amount_refunded: 0, currency: "usd", status: "succeeded", customer: "cus_1", payment_intent: `pi_${page}` }],
    has_more: true,
  }));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { report } = await crossCheck([payment()]);
  expect(report.stripeCheck).toBe("unavailable");
  expect(report.rows).toHaveLength(1);
  expect(report.rows[0].amountCents).toBe(10000);
  expect(report.rows[0].category).toBeNull();
  expect(report.totals).toBeNull();
  expect(rentReconciliationToCsv(report)).toContain(STRIPE_CHECK_UNAVAILABLE);
  expect(warn).toHaveBeenCalledWith("Stripe reader page cap reached (100) for rent charges");
  expect(stripeMock.refundsList).not.toHaveBeenCalled();
  warn.mockRestore();
});

it("refuses a charge write and a refund write before the Stripe client runs", () => {
  const stripe = createReadOnlyStripe("live", { cache: true });
  expect(() => stripe.charges.create({ amount: 1 })).toThrow("Stripe reader refuses charges.create");
  expect(() => stripe.refunds.create({ charge: "ch_1" })).toThrow("Stripe reader refuses refunds.create");
  expect(stripeMock.chargesCreate).not.toHaveBeenCalled();
  expect(stripeMock.refundsCreate).not.toHaveBeenCalled();
});

it("throws before Stripe when the flag is off", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  const stripe = vi.fn(async () => readLiveRentStripe({ gte: 1, lt: 2, paymentIntentIds: ["pi_1"], invoiceIds: [] }));
  await expect(runRentReconciliation({
    enabled: false,
    userId: "owner",
    tier: "owner",
    now: new Date("2026-10-21T15:00:00Z"),
    weekStart: null,
    load,
    stripe,
  })).rejects.toThrow(RENT_RECONCILIATION_OFF);
  expect(load).not.toHaveBeenCalled();
  expect(stripe).not.toHaveBeenCalled();
  expect(stripeMock.createStripeClient).not.toHaveBeenCalled();
  expect(stripeMock.chargesList).not.toHaveBeenCalled();
});
