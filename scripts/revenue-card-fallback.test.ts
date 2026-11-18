import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { displayRevenue, consolidatedRevenue } from "../src/lib/stripe-collections";

const unavailable = { amount: null, coverage: "Unavailable" as const };
describe("Revenue card always shows recorded numbers", () => {
  it("falls back to recorded payments when Stripe cannot be verified", () => {
    expect(displayRevenue({ consolidated: unavailable, recorded: 850 })).toEqual({ amount: 850, coverage: "Partial", fellBack: true });
  });
  it("falls back when consolidation cannot compute (incomplete report)", () => {
    const c = consolidatedRevenue({ internalNonStripe: 0, report: { collectionsComplete: false, totals: null } as never });
    expect(displayRevenue({ consolidated: c, recorded: 850 }).amount).toBe(850);
  });
  it("zero revenue is $0, not unavailable", () => {
    expect(displayRevenue({ consolidated: unavailable, recorded: 0 }).amount).toBe(0);
    expect(displayRevenue({ consolidated: null, recorded: 0 }).amount).toBe(0);
  });
  it("prefers the verified consolidated number", () => {
    expect(displayRevenue({ consolidated: { amount: 900, coverage: "Partial" }, recorded: 850 })).toEqual({ amount: 900, coverage: "Partial", fellBack: false });
  });
  it("only shows no number when the payments read itself failed", () => {
    expect(displayRevenue({ consolidated: unavailable, recorded: null }).amount).toBeNull();
  });
  it("card wires displayRevenue and no longer blanks on Stripe failure", () => {
    const src = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
    expect(src).toContain("displayRevenue(");
    expect(src).not.toContain("shownAmount = c ? c.amount : amount");
  });
});
