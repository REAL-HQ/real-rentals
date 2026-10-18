import { describe, it, expect } from "vitest";
import { aggregateCollections, assertCollectionsAccess, collectionsWindow, formatStripeAmount, readAllPages, type CollectionCharge, type CollectionSubscription } from "../src/lib/stripe-collections";

const window = { gte: 100, lt: 200 };
const sub: CollectionSubscription = { id: "sub_mock", customerId: "cus_mock", name: "Synthetic Renter", status: "active", cancelAtPeriodEnd: false, nextAt: 300, currency: "usd", scheduledAmount: 35000 };
const charge: CollectionCharge = { id: "ch_mock", customerId: "cus_mock", created: 150, currency: "usd", amount: 35000, paid: true, status: "succeeded", fee: 1045 };
const run = (overrides = {}) => aggregateCollections({ charges: [charge], refunds: [], subscriptions: [sub], window, now: 180, ...overrides });
describe("Stripe Collections rules", () => {
  it("allows Owner and Manager only", () => { expect(() => assertCollectionsAccess(["admin"])).not.toThrow(); expect(() => assertCollectionsAccess(["team"])).not.toThrow(); });
  it.each([[], ["coordinator"], ["driver"], ["user"]])("denies unauthorized roles %j", (...roles) => { expect(() => assertCollectionsAccess(roles as string[])).toThrow("Forbidden"); });
  it("counts each charge once, not invoice or payment intent amounts", () => { expect(run({ charges: [charge, charge] }).totals[0].gross).toBe(35000); expect(run({ charges: [charge, charge] }).successful).toBe(1); });
  it("subtracts Stripe fees in minor units", () => { expect(run().totals[0].net).toBe(33955); });
  it("subtracts successful partial refunds once", () => { const r = { id: "re_mock", chargeId: charge.id, created: 170, amount: 5000, currency: "usd", status: "succeeded", fee: 0 }; const t = run({ refunds: [r, r] }).totals[0]; expect(t.refunds).toBe(5000); expect(t.net).toBe(28955); });
  it("ignores failed and pending refunds", () => { expect(run({ refunds: [{ id: "re_mock", chargeId: charge.id, created: 170, amount: 35000, currency: "usd", status: "failed", fee: 0 }] }).totals[0].refunds).toBe(0); });
  it("counts failures without adding revenue or fees", () => { const r = run({ charges: [{ ...charge, paid: false, status: "failed" }] }); expect(r.failed).toBe(1); expect(r.totals[0].gross).toBe(0); expect(r.totals[0].fees).toBe(0); });
  it("does not collect future renewals", () => { expect(run({ charges: [] }).totals).toEqual([]); expect(run({ charges: [] }).activeSubscriptions).toBe(1); });
  it("excludes canceled subscriptions from active counts", () => { expect(run({ subscriptions: [{ ...sub, status: "canceled", nextAt: null }] }).activeSubscriptions).toBe(0); });
  it("uses an inclusive start and exclusive end", () => { expect(run({ charges: [{ ...charge, created: 100 }] }).successful).toBe(1); expect(run({ charges: [{ ...charge, created: 200 }] }).successful).toBe(0); });
  it("counts a current refund against an older charge", () => { const r = run({ charges: [{ ...charge, created: 50 }], refunds: [{ id: "re_old", chargeId: charge.id, created: 150, amount: 5000, currency: "usd", status: "succeeded", fee: 0 }] }); expect(r.totals[0].gross).toBe(0); expect(r.totals[0].net).toBe(-5000); });
  it("keeps unknown fees and net unavailable", () => { const t = run({ charges: [{ ...charge, fee: null }] }).totals[0]; expect(t.fees).toBeNull(); expect(t.net).toBeNull(); expect(formatStripeAmount(null, "usd")).toBe("—"); });
  it("does not sum different currencies", () => { expect(run({ charges: [charge, { ...charge, id: "ch_jpy", currency: "jpy", amount: 350, fee: 10 }] }).totals).toHaveLength(2); expect(formatStripeAmount(350, "jpy")).toBe("¥350"); expect(formatStripeAmount(35000, "usd")).toBe("$350.00"); });
  it("validates range and preserves offset boundaries", () => { const r = collectionsWindow({ from: "2026-10-15T00:00:00-04:00", to: "2026-10-16T00:00:00-04:00" }); expect(r.lt - r.gte).toBe(86400); expect(new Date(r.gte * 1000).toISOString()).toBe("2026-10-15T04:00:00.000Z"); expect(() => collectionsWindow({ from: "bad", to: "bad" })).toThrow(); });
  it("rejects reversed and oversized ranges", () => { expect(() => collectionsWindow({ from: "2026-10-16T00:00:00Z", to: "2026-10-15T00:00:00Z" })).toThrow(); expect(() => collectionsWindow({ from: "2024-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z" })).toThrow(); });
  it("reads every page and deduplicates rows", async () => { const cursors: (string | undefined)[] = []; const rows = await readAllPages(async c => { cursors.push(c); return c ? { data: [{ id: "a" }, { id: "b" }], has_more: false } : { data: [{ id: "a" }], has_more: true }; }); expect(cursors).toEqual([undefined, "a"]); expect(rows).toEqual([{ id: "a" }, { id: "b" }]); });
  it("fails closed on API errors and stalled pagination", async () => { await expect(readAllPages(async () => { throw new Error("API unavailable"); })).rejects.toThrow("API unavailable"); await expect(readAllPages(async () => ({ data: [{ id: "a" }], has_more: true }))).rejects.toThrow("incomplete"); });
});