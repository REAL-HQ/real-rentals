import { beforeEach, expect, it, vi } from "vitest";
import { STRIPE_CHECK_UNAVAILABLE, depositLedgerToCsv, type LedgerPayment, type LedgerRental } from "../src/lib/deposit-ledger";
import { DEPOSIT_LEDGER_OFF } from "../src/lib/deposit-ledger-flag";
import { readLiveDepositStripe } from "../src/lib/deposit-ledger-stripe.server";
import { runDepositLedger } from "../src/lib/deposit-ledger.server";

const stripeMock = vi.hoisted(() => {
  const paymentIntentsRetrieve = vi.fn();
  const chargesRetrieve = vi.fn();
  const chargesCreate = vi.fn();
  const refundsList = vi.fn();
  const refundsCreate = vi.fn();
  const createStripeClient = vi.fn(() => ({
    paymentIntents: { retrieve: paymentIntentsRetrieve },
    charges: { retrieve: chargesRetrieve, create: chargesCreate },
    refunds: { list: refundsList, create: refundsCreate },
  }));
  return { paymentIntentsRetrieve, chargesRetrieve, chargesCreate, refundsList, refundsCreate, createStripeClient };
});

vi.mock("../src/lib/stripe.server", () => ({ createStripeClient: stripeMock.createStripeClient }));

import { clearStripeReaderCache, createReadOnlyStripe } from "../src/lib/stripe-reader.server";

const TODAY = "2026-10-21";

function rental(over: Partial<LedgerRental> = {}): LedgerRental {
  return {
    id: "rental-1",
    applicationId: "driver-1",
    vehicleId: "vehicle-1",
    status: "active",
    endDate: "2026-12-01",
    expectedCents: 10000,
    expectedUnreadable: false,
    depositHeld: true,
    depositHeldUnreadable: false,
    depositStatus: "held",
    refundCents: null,
    refundUnreadable: false,
    settledAt: null,
    ...over,
  };
}

function payment(over: Partial<LedgerPayment> = {}): LedgerPayment {
  return {
    id: "pay-1",
    rentalId: "rental-1",
    applicationId: "driver-1",
    type: "deposit",
    status: "paid",
    amountCents: 10000,
    netCollectedCents: 10000,
    refundedCents: 0,
    unreadable: false,
    stripePaymentIntentId: "pi_1",
    stripeInvoiceId: null,
    stripeSubscriptionId: null,
    ...over,
  };
}

beforeEach(() => {
  clearStripeReaderCache();
  stripeMock.paymentIntentsRetrieve.mockReset();
  stripeMock.chargesRetrieve.mockReset();
  stripeMock.chargesCreate.mockReset();
  stripeMock.refundsList.mockReset();
  stripeMock.refundsCreate.mockReset();
  stripeMock.createStripeClient.mockClear();
});

async function crossCheck(payments: LedgerPayment[], rentals: LedgerRental[] = [rental()]) {
  const before = structuredClone(payments);
  const result = await runDepositLedger({
    enabled: true,
    userId: "owner",
    tier: "owner",
    today: TODAY,
    load: async () => ({
      ok: true as const,
      rentals,
      payments,
      deductions: [],
      people: [{ id: "driver-1", name: "Ada" }],
      vehicles: [{ id: "vehicle-1", label: "Unit 7" }],
    }),
    stripe: (rows) => readLiveDepositStripe(rows),
  });
  return { result, before, payments };
}

function ready(result: Awaited<ReturnType<typeof crossCheck>>["result"]) {
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("expected a report");
  return result.report;
}

it("matches a captured charge and a zero refund to the payment row", async () => {
  stripeMock.paymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", latest_charge: "ch_1" });
  stripeMock.chargesRetrieve.mockResolvedValue({ id: "ch_1", amount: 10000, amount_captured: 10000, amount_refunded: 0 });
  stripeMock.refundsList.mockResolvedValue({ data: [], has_more: false });
  const { result, before, payments } = await crossCheck([payment()]);
  const report = ready(result);
  expect(payments).toEqual(before);
  expect(report.stripeCheck).toBe("ready");
  expect(report.rows[0].stripeCapturedCents).toBe(10000);
  expect(report.rows[0].stripeRefundedCents).toBe(0);
  expect(report.rows[0].evidence.join(" ")).not.toContain("Stripe captured");
  expect(report.rows[0].evidence.join(" ")).not.toContain("Stripe refunded");
  expect(report.heldCents).toBe(10000);
  expect(report.dueBackCents).toBe(0);
  expect(report.warnings).toEqual([]);
  expect(stripeMock.createStripeClient).toHaveBeenCalledWith("live", { timeout: 20_000 });
  expect(stripeMock.paymentIntentsRetrieve).toHaveBeenCalledWith("pi_1", {}, expect.objectContaining({ timeout: expect.any(Number) }));
  expect(stripeMock.chargesRetrieve).toHaveBeenCalledWith("ch_1", {}, expect.objectContaining({ timeout: expect.any(Number) }));
  expect(stripeMock.refundsList).toHaveBeenCalledWith({ payment_intent: "pi_1", limit: 100 }, expect.objectContaining({ timeout: expect.any(Number) }));
  expect(stripeMock.chargesCreate).not.toHaveBeenCalled();
  expect(stripeMock.refundsCreate).not.toHaveBeenCalled();
  expect(depositLedgerToCsv(report)).not.toContain(STRIPE_CHECK_UNAVAILABLE);
  expect(depositLedgerToCsv(report)).toContain("Held,100.00,0.00");
  expect(depositLedgerToCsv(report)).not.toContain("Days Since Close");
});

it("keeps the database totals when Stripe captured a different amount", async () => {
  stripeMock.paymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", latest_charge: "ch_1" });
  stripeMock.chargesRetrieve.mockResolvedValue({ id: "ch_1", amount: 8000, amount_captured: 8000, amount_refunded: 0 });
  stripeMock.refundsList.mockResolvedValue({ data: [], has_more: false });
  const { result, before, payments } = await crossCheck([payment()]);
  const report = ready(result);
  expect(payments).toEqual(before);
  const evidence = report.rows[0].evidence.join(" ");
  expect(evidence).toContain("Stripe captured $80.00 and the payment amount is $100.00. This is evidence only.");
  expect(evidence).not.toContain("Stripe refunded");
  expect(report.rows[0].stripeCapturedCents).toBe(8000);
  expect(report.rows[0].collectedCents).toBe(10000);
  expect(report.rows[0].state).toBe("held");
  expect(report.heldCents).toBe(10000);
  expect(report.stripeCheck).toBe("ready");
});

it("records a Stripe refund that matches the payment refund amount", async () => {
  stripeMock.paymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", latest_charge: "ch_1" });
  stripeMock.chargesRetrieve.mockResolvedValue({ id: "ch_1", amount: 10000, amount_captured: 10000, amount_refunded: 4000 });
  stripeMock.refundsList.mockResolvedValue({ data: [{ id: "re_1", amount: 4000 }], has_more: false });
  const { result, before, payments } = await crossCheck([
    payment({ amountCents: 10000, netCollectedCents: 6000, refundedCents: 4000 }),
  ]);
  const report = ready(result);
  expect(payments).toEqual(before);
  const evidence = report.rows[0].evidence.join(" ");
  expect(evidence).not.toContain("Stripe captured");
  expect(evidence).not.toContain("Stripe refunded");
  expect(report.rows[0].stripeCapturedCents).toBe(10000);
  expect(report.rows[0].stripeRefundedCents).toBe(4000);
  expect(report.rows[0].collectedCents).toBe(6000);
  expect(report.heldCents).toBe(6000);
  expect(stripeMock.refundsList).toHaveBeenCalledTimes(1);
});

it("names a Stripe refund that differs from the payment refund amount", async () => {
  stripeMock.paymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", latest_charge: "ch_1" });
  stripeMock.chargesRetrieve.mockResolvedValue({ id: "ch_1", amount: 10000, amount_captured: 10000, amount_refunded: 4000 });
  stripeMock.refundsList.mockResolvedValue({ data: [{ id: "re_1", amount: 4000 }], has_more: false });
  const { result, before, payments } = await crossCheck([payment({ refundedCents: 0, netCollectedCents: 10000 })]);
  const report = ready(result);
  expect(payments).toEqual(before);
  expect(report.rows[0].evidence.join(" ")).toContain("Stripe refunded $40.00 and the payment refund amount is $0.00. This is evidence only.");
  expect(report.rows[0].evidence.join(" ")).not.toContain("Stripe captured");
  expect(report.rows[0].stripeRefundedCents).toBe(4000);
  expect(report.rows[0].collectedCents).toBe(10000);
  expect(report.heldCents).toBe(10000);
  expect(report.stripeCheck).toBe("ready");
});

it("shows Stripe check unavailable and keeps the database view when Stripe errors or the refund list is capped", async () => {
  stripeMock.paymentIntentsRetrieve.mockRejectedValue(new Error("Stripe unavailable"));
  const failed = ready((await crossCheck([payment()])).result);
  expect(failed.stripeCheck).toBe("unavailable");
  expect(failed.rows).toHaveLength(1);
  expect(failed.rows[0].collectedCents).toBe(10000);
  expect(failed.rows[0].state).toBe("held");
  expect(failed.rows[0].stripeCapturedCents).toBeNull();
  expect(failed.rows[0].stripeRefundedCents).toBeNull();
  expect(failed.heldCents).toBe(10000);
  expect(failed.warnings).toEqual([]);
  expect(failed.rows[0].evidence.join(" ")).not.toContain("Stripe captured");
  expect(depositLedgerToCsv(failed)).toContain(STRIPE_CHECK_UNAVAILABLE);
  expect(await readLiveDepositStripe([payment()])).toEqual({ ok: false });

  const thrown = vi.fn(async () => {
    throw new Error("boom");
  });
  const thrownResult = ready(await runDepositLedger({
    enabled: true,
    userId: "manager",
    tier: "manager",
    today: TODAY,
    load: async () => ({
      ok: true as const,
      rentals: [rental()],
      payments: [payment()],
      deductions: [],
      people: [{ id: "driver-1", name: "Ada" }],
      vehicles: [{ id: "vehicle-1", label: "Unit 7" }],
    }),
    stripe: thrown,
  }));
  expect(thrown).toHaveBeenCalledTimes(1);
  expect(thrownResult.stripeCheck).toBe("unavailable");
  expect(thrownResult.heldCents).toBe(10000);
  expect(thrownResult.rows[0].collectedCents).toBe(10000);

  clearStripeReaderCache();
  stripeMock.paymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", livemode: false, latest_charge: "ch_1" });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await readLiveDepositStripe([payment()])).toEqual({ ok: false });
  expect(stripeMock.refundsList).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  const testMode = ready((await crossCheck([payment()])).result);
  expect(testMode.stripeCheck).toBe("unavailable");
  expect(testMode.rows[0].state).toBe("held");
  expect(testMode.rows[0].collectedCents).toBe(10000);
  expect(testMode.heldCents).toBe(10000);
  expect(testMode.rows[0].stripeCapturedCents).toBeNull();
  expect(testMode.warnings).toEqual([]);
  expect(depositLedgerToCsv(testMode)).toContain(STRIPE_CHECK_UNAVAILABLE);

  clearStripeReaderCache();
  stripeMock.paymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", latest_charge: "ch_1" });
  stripeMock.chargesRetrieve.mockResolvedValue({ id: "ch_1", amount: 10000, amount_captured: 10000, amount_refunded: 0 });
  let page = 0;
  stripeMock.refundsList.mockImplementation(async () => ({ data: [{ id: `re_${++page}` }], has_more: true }));
  expect(await readLiveDepositStripe([payment()])).toEqual({ ok: false });
  const capped = ready((await crossCheck([payment()])).result);
  expect(capped.stripeCheck).toBe("unavailable");
  expect(capped.rows[0].state).toBe("held");
  expect(capped.rows[0].collectedCents).toBe(10000);
  expect(capped.heldCents).toBe(10000);
  expect(capped.rows[0].stripeCapturedCents).toBeNull();
  expect(capped.warnings).toEqual([]);
  expect(depositLedgerToCsv(capped)).toContain(STRIPE_CHECK_UNAVAILABLE);
  expect(warn).toHaveBeenCalledWith("Stripe reader page cap reached (100) for deposit refunds");
  warn.mockRestore();
});

it("refuses a charge write and a refund write before the Stripe client runs", () => {
  const stripe = createReadOnlyStripe("live", { cache: true });
  expect(() => stripe.charges.create({ amount: 1 })).toThrow("Stripe reader refuses charges.create");
  expect(() => stripe.refunds.create({ charge: "ch_1" })).toThrow("Stripe reader refuses refunds.create");
  expect(stripeMock.chargesCreate).not.toHaveBeenCalled();
  expect(stripeMock.refundsCreate).not.toHaveBeenCalled();
});

it("throws before the manager path and before Stripe when the flag is off", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  const stripe = vi.fn(async () => readLiveDepositStripe([payment()]));
  await expect(runDepositLedger({
    enabled: false,
    userId: "owner",
    tier: "owner",
    today: TODAY,
    load,
    stripe,
  })).rejects.toThrow(DEPOSIT_LEDGER_OFF);
  expect(load).not.toHaveBeenCalled();
  expect(stripe).not.toHaveBeenCalled();
  expect(stripeMock.createStripeClient).not.toHaveBeenCalled();
  expect(stripeMock.paymentIntentsRetrieve).not.toHaveBeenCalled();
});
