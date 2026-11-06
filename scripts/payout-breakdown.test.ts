import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { railEntries, visibleTabs } from "../src/components/admin/nav-config";
import { PAYOUT_BREAKDOWN_ENABLED } from "../src/lib/payout-breakdown-flag";
import { PAYOUT_PAGE_CAP, buildPayoutBreakdown, payoutBreakdownCsv, payoutWindow, type PayoutTxn } from "../src/lib/payout-breakdown";
import { readPayoutBreakdown, type PayoutStripeGateway } from "../src/lib/payout-breakdown-read.server";
import { runPayoutBreakdown } from "../src/lib/payout-breakdown.server";
import type { MatchDirectory } from "../src/lib/stripe-match.server";

const charge = (extra: Partial<PayoutTxn> = {}): PayoutTxn => ({
  id: "txn_charge",
  type: "charge",
  amount: 10000,
  fee: 300,
  net: 9700,
  currency: "usd",
  sourceId: "ch_1",
  customerId: "cus_1",
  ...extra,
});

function directory(): MatchDirectory {
  return {
    applications: [{
      id: "app1", fullName: "Ada Lovelace", email: "ada@example.com", phone: null,
      stripeCustomerId: "cus_1", vehicleId: "v1", userId: null, deletedAt: null, status: "approved",
    }],
    rentals: [{ id: "rent1", applicationId: "app1", driverId: null, vehicleId: "v1", stripeCustomerId: "cus_1" }],
    vehicles: [{ id: "v1", year: 2020, make: "Honda", model: "Civic", licensePlate: "ABC123" }],
  };
}

describe("stripe payout breakdown", () => {
  it("returns disabled before any Stripe or table read when the flag is off", async () => {
    let reads = 0;
    let loaded = 0;
    const result = await runPayoutBreakdown({
      enabled: false,
      userId: "owner-1",
      tier: "owner",
      from: "2026-10-01",
      through: "2026-10-21",
      loadDirectory: async () => { loaded += 1; return directory(); },
      readStripe: async () => { reads += 1; return { ok: true, payouts: [], customers: [], capped: false }; },
    });
    expect(result).toEqual({ status: "disabled", report: null });
    expect(reads).toBe(0);
    expect(loaded).toBe(0);
    expect(PAYOUT_BREAKDOWN_ENABLED).toBe(false);
  });

  it("refuses a manager before any Stripe or table read", async () => {
    let reads = 0;
    let loaded = 0;
    await expect(runPayoutBreakdown({
      enabled: true,
      userId: "manager-1",
      tier: "manager",
      from: "2026-10-01",
      through: "2026-10-21",
      loadDirectory: async () => { loaded += 1; return directory(); },
      readStripe: async () => { reads += 1; return { ok: true, payouts: [], customers: [], capped: false }; },
    })).rejects.toThrow("Forbidden");
    expect(reads).toBe(0);
    expect(loaded).toBe(0);
  });

  it("flags a payout whose parts do not sum to the payout amount", () => {
    const report = buildPayoutBreakdown({
      from: "2026-10-01",
      through: "2026-10-21",
      applications: directory().applications,
      rentals: directory().rentals,
      vehicles: directory().vehicles,
      customers: [{ id: "cus_1", name: "Ada", email: "ada@example.com", phone: null }],
      payouts: [
        {
          id: "po_short", amount: 10000, currency: "usd", status: "paid", created: 1_700_000_000, arrival: 1_700_086_400,
          transactionsCapped: false,
          transactions: [charge(), { id: "txn_po", type: "payout", amount: -9700, fee: 0, net: -9700, currency: "usd", sourceId: "po_short", customerId: null }],
        },
        {
          id: "po_ok", amount: 9700, currency: "usd", status: "in_transit", created: 1_700_000_000, arrival: 1_700_086_400,
          transactionsCapped: false,
          transactions: [charge({ id: "txn_ok", sourceId: "ch_2" })],
        },
      ],
    });
    const short = report.payouts.find((payout) => payout.id === "po_short");
    const ok = report.payouts.find((payout) => payout.id === "po_ok");
    expect(short?.groups).toEqual({ chargesCents: 10000, refundsCents: 0, feesCents: -300, disputesCents: 0, otherCents: 0 });
    expect(short?.sumCents).toBe(9700);
    expect(short?.sumsToPayout).toBe(false);
    expect(ok?.sumsToPayout).toBe(true);
    expect(ok?.sumCents).toBe(9700);
    expect(short?.charges[0]).toMatchObject({ driverName: "Ada Lovelace", rentalExists: true, matchReason: "Stripe Customer Id" });
    expect(short?.charges[0]?.vehicleLabel).toContain("Civic");
    const csv = payoutBreakdownCsv(report);
    expect(csv).toContain("Mismatch");
    expect(csv).toContain("Sums To The Payout");
    expect(csv).toContain("100.00");
    expect(csv).toContain("97.00");
  });

  it("stops at the shared page cap and shows that warning without a table read", async () => {
    let loaded = 0;
    const warned = await runPayoutBreakdown({
      enabled: true,
      userId: "owner-1",
      tier: "owner",
      from: "2026-10-01",
      through: "2026-10-21",
      loadDirectory: async () => { loaded += 1; return directory(); },
      readStripe: async (window) => {
        expect(window).toEqual({ gte: payoutWindow("2026-10-01", "2026-10-21")!.gte, lt: payoutWindow("2026-10-01", "2026-10-21")!.lt });
        return { ok: false, reason: "Stripe reader page cap reached", capped: true };
      },
    });
    expect(warned).toEqual({ status: "ready", report: { from: "2026-10-01", through: "2026-10-21", payouts: [], warnings: [PAYOUT_PAGE_CAP] } });
    expect(loaded).toBe(0);
    let payoutCalls = 0;
    let balanceCalls = 0;
    const gateway: PayoutStripeGateway = {
      payouts: {
        list: async () => {
          payoutCalls += 1;
          return {
            has_more: true,
            data: [{ id: `po_${payoutCalls}`, amount: 100, currency: "usd", status: "paid", created: 1_700_000_000, arrival_date: 1_700_086_400, livemode: true }],
          };
        },
      },
      balanceTransactions: { list: async () => { balanceCalls += 1; return { has_more: false, data: [] }; } },
      charges: { retrieve: async () => ({ id: "ch", livemode: true }) },
      customers: { retrieve: async () => ({ id: "cus", livemode: true }) },
    };
    const limited = await readPayoutBreakdown(gateway, { gte: 1, lt: 2 }, { timeoutMs: 60_000, now: () => 0 });
    expect(payoutCalls).toBe(100);
    expect(balanceCalls).toBe(0);
    expect(limited).toEqual({ ok: false, reason: "Stripe reader page cap reached", capped: true });
  });

  it("keeps the screen, the owner check, and Stripe behind the constant", () => {
    expect(visibleTabs("owner").some((tab) => tab.id === "payout_breakdown")).toBe(false);
    expect(railEntries("owner").some((tab) => tab.id === "payout_breakdown")).toBe(false);
    expect(visibleTabs("manager").some((tab) => tab.id === "payout_breakdown")).toBe(false);
    const handler = readFileSync(new URL("../src/lib/payout-breakdown.functions.ts", import.meta.url), "utf8");
    const flagAt = handler.indexOf("if (!PAYOUT_BREAKDOWN_ENABLED) return DISABLED");
    const ownerAt = handler.indexOf("await requireOwner(context.userId)");
    const stripeAt = handler.indexOf("readLivePayoutBreakdown(window)");
    expect(flagAt).toBeGreaterThan(-1);
    expect(ownerAt).toBeGreaterThan(flagAt);
    expect(stripeAt).toBeGreaterThan(ownerAt);
    const reader = readFileSync(new URL("../src/lib/payout-breakdown-read.server.ts", import.meta.url), "utf8");
    expect(reader).toContain('createReadOnlyStripe("live", { cache: true })');
    expect(reader).toContain("STRIPE_READER_MAX_PAGES");
    expect(reader).not.toMatch(/\.(create|update|capture|confirm|cancel|del)\(/);
    for (const name of ["payout-breakdown.ts", "payout-breakdown.server.ts", "payout-breakdown.functions.ts", "payout-breakdown-flag.ts"]) {
      const source = readFileSync(new URL(`../src/lib/${name}`, import.meta.url), "utf8");
      expect(source).not.toContain("createStripeClient");
      expect(source).not.toMatch(/\.(create|update|capture|confirm|cancel|del)\(/);
    }
    const nav = readFileSync(new URL("../src/components/admin/nav-config.ts", import.meta.url), "utf8");
    expect(nav).toContain('if (PAYOUT_BREAKDOWN_ENABLED && tierAllows(tier, "owner"))');
    const tabsBlock = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
    expect(tabsBlock).not.toContain("payout_breakdown");
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    expect(admin).toContain('if (urlTab === "payout_breakdown")');
    expect(admin).toContain("!PAYOUT_BREAKDOWN_ENABLED || (tier && !tierAllows(tier, \"owner\"))");
    expect(admin).toContain("PAYOUT_BREAKDOWN_ENABLED && tab === \"payout_breakdown\"");
  });
});
