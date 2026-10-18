import { beforeEach, describe, expect, it, vi } from "vitest";
const { client } = vi.hoisted(() => ({ client: {
  subscriptions: { list: vi.fn() }, invoices: { list: vi.fn() }, invoicePayments: { list: vi.fn() },
  charges: { list: vi.fn(), retrieve: vi.fn() }, refunds: { list: vi.fn() }, payouts: { list: vi.fn() },
} }));
vi.mock("../src/lib/stripe.server", () => ({ createStripeClient: () => client }));
import { loadStripeCollections } from "../src/lib/stripe-collections.server";
const range = { from: "2026-10-15T00:00:00Z", to: "2026-10-17T00:00:00Z" };
const created = Date.parse("2026-10-15T12:00:00Z") / 1000;
const page = (data: unknown[]) => ({ data, has_more: false });
beforeEach(() => {
  vi.resetAllMocks();
  client.subscriptions.list.mockResolvedValue(page([{ id: "sub_test", customer: { id: "cus_test", name: "Synthetic Renter" }, currency: "usd", status: "active", cancel_at_period_end: false, items: { has_more: false, data: [{ current_period_end: created + 604800, quantity: 1, price: { currency: "usd", unit_amount: 35000, recurring: { usage_type: "licensed" } } }] } }]));
  client.invoices.list.mockResolvedValue(page([{ id: "in_test", customer: "cus_test", amount_paid: 35000, parent: { subscription_details: { subscription: "sub_test" } } }]));
  client.invoicePayments.list.mockResolvedValue(page([{ id: "ip_test", invoice: "in_test", payment: { payment_intent: "pi_test" } }]));
  client.charges.list.mockResolvedValue(page([{ id: "ch_test", customer: "cus_test", payment_intent: "pi_test", created, currency: "usd", amount_captured: 35000, paid: true, status: "succeeded", balance_transaction: { currency: "usd", fee: 1045 } }]));
  client.refunds.list.mockResolvedValue(page([])); client.payouts.list.mockResolvedValue(page([{ id: "po_test", currency: "usd", amount: 10000 }]));
});
describe("read-only Stripe reporting service", () => {
  it("uses list/retrieve only and never adds invoice amounts", async () => { const r = await loadStripeCollections("live", range); expect(r.totals[0].gross).toBe(35000); expect(r.totals[0].net).toBe(33955); expect(r.customers[0].name).toBe("Synthetic Renter"); expect(r.payouts?.[0].amount).toBe(10000); expect(client.charges.list).toHaveBeenCalledWith(expect.objectContaining({ created: { gte: 1792022400, lt: 1792195200 } })); });
  it("requires matching subscription and invoice customer", async () => { client.invoices.list.mockResolvedValue(page([{ id: "in_test", customer: "cus_other", parent: { subscription_details: { subscription: "sub_test" } } }])); expect((await loadStripeCollections("live", range)).totals).toEqual([]); });
  it("does not invent customer collections from unlinked charges", async () => { client.invoicePayments.list.mockResolvedValue(page([])); expect((await loadStripeCollections("live", range)).successful).toBe(0); });
  it("shows cancellation without a future billing event", async () => { const result = await client.subscriptions.list(); result.data[0].cancel_at_period_end = true; client.subscriptions.list.mockResolvedValue(result); const r = await loadStripeCollections("live", range); expect(r.subscriptions[0].nextAt).toBeNull(); expect(r.activeSubscriptions).toBe(1); });
  it("uses signed refund balance fees", async () => { client.refunds.list.mockResolvedValue(page([{ id: "re_test", charge: "ch_test", created, currency: "usd", amount: 5000, status: "succeeded", balance_transaction: { currency: "usd", fee: -100 } }])); const r = await loadStripeCollections("live", range); expect(r.totals[0].fees).toBe(945); expect(r.totals[0].net).toBe(29055); });
  it("keeps payout failures separate from calculated net", async () => { client.payouts.list.mockRejectedValue(new Error("Unavailable")); const r = await loadStripeCollections("live", range); expect(r.payouts).toBeNull(); expect(r.totals[0].net).toBe(33955); });
  it("does not return partial totals after API failure", async () => { client.charges.list.mockRejectedValue(new Error("Stripe unavailable")); await expect(loadStripeCollections("live", range)).rejects.toThrow("Stripe unavailable"); });
  it("marks foreign settlement fees unknown", async () => { const result = await client.charges.list(); result.data[0].balance_transaction.currency = "eur"; client.charges.list.mockResolvedValue(result); expect((await loadStripeCollections("live", range)).totals[0].net).toBeNull(); });
});