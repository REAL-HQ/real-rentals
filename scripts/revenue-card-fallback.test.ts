import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { consolidatedRevenue } from "../src/lib/stripe-collections";
import { readWithRetry, recordedRevenueTotal, revenueCardDisplay } from "../src/lib/revenue-card";

// Production payments for Nov 12 – Nov 18 2026 as the card reads them
// (status paid/refunded, revenue types, paid_date in range).
const prodLast7 = [
  { net_collected: 350, stripe_invoice_id: "in_x", stripe_payment_intent_id: "pi_a", failure_reason: null }, // rent Nov 12
  { net_collected: 350, stripe_invoice_id: "in_y", stripe_payment_intent_id: null, failure_reason: null }, // rent Nov 14
  { net_collected: 50, stripe_payment_intent_id: "pi_b" }, // Reservation Fee Nov 16
  { net_collected: "50.00", stripe_payment_intent_id: "pi_c" }, // Reservation Fee Nov 17
  { net_collected: 50, stripe_payment_intent_id: "pi_03733dbe" }, // Jonathon's Reservation Fee Nov 18
];

describe("Revenue card always shows a number", () => {
  it("shows the recorded total when Stripe is off, loading or failed", () => {
    const recorded = recordedRevenueTotal({ data: prodLast7, error: null, count: 5 });
    expect(recorded).toBe(850);
    expect(revenueCardDisplay({ consolidated: null, recorded })).toEqual({ amount: 850, badge: "Recorded", source: "recorded" });
    expect(revenueCardDisplay({ consolidated: { amount: null }, recorded }).amount).toBe(850);
  });

  it("falls back when Stripe consolidation is incomplete", () => {
    const c = consolidatedRevenue({ internalNonStripe: 0, report: { collectionsComplete: false, totals: null } as never });
    expect(revenueCardDisplay({ consolidated: c, recorded: 850 })).toEqual({ amount: 850, badge: "Recorded", source: "recorded" });
  });

  it("prefers a verified Stripe figure when there is one", () => {
    expect(revenueCardDisplay({ consolidated: { amount: 900 }, recorded: 850 })).toEqual({ amount: 900, badge: "Partial", source: "stripe" });
  });

  it("an empty range is $0, never unavailable", () => {
    const recorded = recordedRevenueTotal({ data: [], error: null, count: 0 });
    expect(recorded).toBe(0);
    expect(revenueCardDisplay({ consolidated: { amount: null }, recorded })).toEqual({ amount: 0, badge: "Recorded", source: "recorded" });
  });

  it("one odd row or a missing count does not blank the card", () => {
    expect(recordedRevenueTotal({ data: [{ net_collected: 100 }, { net_collected: null }, { net_collected: "abc" }], error: null, count: null })).toBe(100);
    expect(recordedRevenueTotal({ data: [{ net_collected: 100 }], error: null, count: 7 })).toBe(100);
  });

  it("only a failed read has no number, and it says Couldn't Load, not Unavailable", () => {
    expect(recordedRevenueTotal({ data: null, error: { message: "denied" } })).toBeNull();
    expect(revenueCardDisplay({ consolidated: null, recorded: null, recordedFailed: true })).toEqual({ amount: null, badge: "Couldn't Load", source: "none" });
    expect(revenueCardDisplay({ consolidated: null, recorded: null }).badge).toBe("Loading");
  });

  it("retries a failed payments read before giving up", async () => {
    let calls = 0;
    const result = await readWithRetry(
      async () => (++calls < 3 ? { data: null, error: { message: "blip" } } : { data: prodLast7, error: null }),
      (r) => !!r.error,
      { sleep: async () => {} },
    );
    expect(calls).toBe(3);
    expect(recordedRevenueTotal(result)).toBe(850);
    let thrown = 0;
    const failed = await readWithRetry(async () => { thrown++; throw new Error("network"); }, () => false, { sleep: async () => {} });
    expect(thrown).toBe(3);
    expect(recordedRevenueTotal(failed as never)).toBeNull();
  });

  it("card is wired to the recorded floor and never labels itself Unavailable", () => {
    const src = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
    const card = src.slice(src.indexOf("function RevenueCard("), src.indexOf("function RevenueCard(") + 6000);
    expect(card).toContain("revenueCardDisplay(");
    expect(card).not.toContain('"Unavailable"');
    expect(src).toContain("recordedRevenueTotal(cur)");
    expect(src).toContain("readWithRetry(");
  });
});
