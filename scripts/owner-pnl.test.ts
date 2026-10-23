import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { railEntries, visibleTabs } from "../src/components/admin/nav-config";
import { OWNER_PNL_ENABLED } from "../src/lib/owner-pnl-flag";
import {
  buildOwnerPnl,
  monthWindow,
  ownerPnlCsv,
  type OwnerPnlDirectory,
} from "../src/lib/owner-pnl";
import { runOwnerPnl } from "../src/lib/owner-pnl.server";

const NOW = new Date("2026-10-21T15:00:00Z");

function directory(): OwnerPnlDirectory {
  return {
    payments: [
      { id: "pay1", vehicleId: "v1", type: "rent", paymentIntentId: "pi_v1", invoiceId: null, subscriptionId: null },
      { id: "pay2", vehicleId: "v2", type: "rent", paymentIntentId: "pi_v2", invoiceId: null, subscriptionId: null },
      { id: "pay3", vehicleId: "v1", type: "deposit", paymentIntentId: "pi_dep", invoiceId: null, subscriptionId: null },
      { id: "pay4", vehicleId: "v1", type: "rent", paymentIntentId: "pi_old", invoiceId: null, subscriptionId: null },
    ],
    rentals: [],
    expenses: [
      { id: "e1", vehicleId: "v1", category: "repair", amount: "100.50", incurredOn: "2026-10-15", maintenanceRecordId: "m1" },
      { id: "e2", vehicleId: "v1", category: "insurance", amount: "10.00", incurredOn: "2026-10-02", maintenanceRecordId: null },
      { id: "e3", vehicleId: "v2", category: "=cmd", amount: "1.00", incurredOn: "2026-09-15", maintenanceRecordId: null },
    ],
    maintenance: [
      { id: "m1", vehicleId: "v1", category: "repair", companyShare: "100.50", performedOn: "2026-10-15", completedAt: null, createdAt: null },
    ],
    refunds: [
      { id: "r1", amount: "25.00", status: "succeeded", createdAt: "2026-10-16T15:00:00.000Z", paymentIds: ["pay1"] },
      { id: "r2", amount: "5.00", status: "succeeded", createdAt: "2026-10-16T15:00:00.000Z", paymentIds: ["pay3"] },
      { id: "r3", amount: "9.00", status: "pending", createdAt: "2026-10-16T15:00:00.000Z", paymentIds: ["pay1"] },
    ],
  };
}

function charge(id: string, paymentIntentId: string, amountCents: number, created: number) {
  return {
    id, paymentIntentId, amountCents, created, currency: "usd", succeeded: true,
    customerId: null, invoiceId: null, subscriptionId: null,
  };
}

describe("monthly owner p&l", () => {
  it("dates an Eastern Time month and the month before it", () => {
    expect(monthWindow("2026-10")).toMatchObject({ from: "2026-10-01", to: "2026-11-01", through: "2026-10-31" });
    expect(monthWindow("2026-09")).toMatchObject({ from: "2026-09-01", to: "2026-10-01", through: "2026-09-30" });
  });

  it("builds revenue, category expenses, excluded deposits, refunds, and the previous month", () => {
    const october = monthWindow("2026-10")!;
    const september = monthWindow("2026-09")!;
    const report = buildOwnerPnl({
      ...directory(),
      month: "2026-10",
      currentCharges: [
        charge("ch1", "pi_v1", 35000, october.gte + 10),
        charge("ch2", "pi_v2", 8000, october.gte + 10),
        charge("ch3", "pi_none", 5000, october.gte + 10),
        charge("ch4", "pi_dep", 20000, october.gte + 10),
      ],
      previousCharges: [charge("ch5", "pi_old", 10000, september.gte + 10)],
    });
    expect(report?.current).toMatchObject({
      revenueCents: 43000,
      unattributedRevenueCents: 5000,
      depositsExcludedCents: 20000,
      depositRefundsExcludedCents: 500,
      refundsCents: 2500,
      expenseCents: 11050,
      netCents: 29450,
      revenueComplete: true,
      expensesComplete: true,
      refundsComplete: true,
    });
    expect(report?.current.expenses).toEqual([
      { category: "insurance", label: "Insurance Premium", cents: 1000 },
      { category: "repair", label: "Repair", cents: 10050 },
    ]);
    expect(report?.previous).toMatchObject({ revenueCents: 10000, expenseCents: 100, refundsCents: 0, netCents: 9900 });
    expect(report?.change).toMatchObject({ revenueCents: 33000, expenseCents: 10950, refundsCents: 2500, netCents: 19550 });
    const csv = ownerPnlCsv(report!);
    expect(csv).toContain("Revenue,430.00,100.00,330.00");
    expect(csv).toContain("Net,294.50,99.00,195.50");
    expect(csv).toContain("Deposits Excluded,200.00");
    expect(csv).toContain("'=cmd");
  });

  it("blanks refunds and net when a refund cannot be classified, and still keeps revenue", () => {
    const october = monthWindow("2026-10")!;
    const report = buildOwnerPnl({
      ...directory(),
      refunds: [{ id: "r", amount: "10.00", status: null, createdAt: "2026-10-02T12:00:00.000Z", paymentIds: ["pay1"] }],
      month: "2026-10",
      currentCharges: [charge("ch1", "pi_v1", 35000, october.gte + 1)],
      previousCharges: [],
    });
    expect(report?.current.refundsComplete).toBe(false);
    expect(report?.current.refundsCents).toBeNull();
    expect(report?.current.netCents).toBeNull();
    expect(report?.current.revenueCents).toBe(35000);
  });

  it("returns disabled before any load when the flag is off", async () => {
    let loaded = 0;
    let reads = 0;
    const result = await runOwnerPnl({
      enabled: false,
      userId: "owner-1",
      tier: "owner",
      month: "2026-10",
      now: NOW,
      load: async () => { loaded += 1; return directory(); },
      readCharges: async () => { reads += 1; return { ok: true, charges: [] }; },
    });
    expect(result).toEqual({ status: "disabled", report: null });
    expect(loaded).toBe(0);
    expect(reads).toBe(0);
    expect(OWNER_PNL_ENABLED).toBe(false);
  });

  it("refuses a manager before reading, and asks the existing charge reader for both months", async () => {
    let loaded = 0;
    const windows: { gte: number; lt: number }[] = [];
    const load = async () => { loaded += 1; return directory(); };
    const readCharges = async (window: { gte: number; lt: number }) => {
      windows.push(window);
      return { ok: true as const, charges: [] };
    };
    await expect(runOwnerPnl({
      enabled: true, userId: "manager-1", tier: "manager", month: "2026-10", now: NOW, load, readCharges,
    })).rejects.toThrow("Forbidden");
    expect(loaded).toBe(0);
    expect(windows).toEqual([]);
    const future = await runOwnerPnl({
      enabled: true, userId: "owner-1", tier: "owner", month: "2026-11", now: NOW, load, readCharges,
    });
    expect(future).toMatchObject({ status: "unavailable" });
    expect(loaded).toBe(0);
    const ready = await runOwnerPnl({
      enabled: true, userId: "owner-1", tier: "owner", month: "2026-10", now: NOW, load, readCharges,
    });
    expect(ready.status).toBe("ready");
    expect(loaded).toBe(1);
    expect(windows).toEqual([
      { gte: monthWindow("2026-10")!.gte, lt: monthWindow("2026-10")!.lt },
      { gte: monthWindow("2026-09")!.gte, lt: monthWindow("2026-09")!.lt },
    ]);
  });

  it("keeps the screen, the owner check, and Stripe behind the constant", () => {
    expect(visibleTabs("owner").some((tab) => tab.id === "owner_pnl")).toBe(false);
    expect(railEntries("owner").some((tab) => tab.id === "owner_pnl")).toBe(false);
    expect(visibleTabs("manager").some((tab) => tab.id === "owner_pnl")).toBe(false);
    const handler = readFileSync(new URL("../src/lib/owner-pnl.functions.ts", import.meta.url), "utf8");
    const flagAt = handler.indexOf("if (!OWNER_PNL_ENABLED) return DISABLED");
    const ownerAt = handler.indexOf("requireOwner");
    const stripeAt = handler.indexOf("readLivePartnerCharges(window)");
    expect(flagAt).toBeGreaterThan(-1);
    expect(ownerAt).toBeGreaterThan(flagAt);
    expect(stripeAt).toBeGreaterThan(ownerAt);
    for (const name of ["owner-pnl.ts", "owner-pnl.server.ts", "owner-pnl.functions.ts", "owner-pnl-flag.ts"]) {
      const source = readFileSync(new URL(`../src/lib/${name}`, import.meta.url), "utf8");
      expect(source).not.toContain("charges.list");
      expect(source).not.toContain("refunds.list");
    }
    const nav = readFileSync(new URL("../src/components/admin/nav-config.ts", import.meta.url), "utf8");
    expect(nav).toContain('if (!OWNER_PNL_ENABLED || !tierAllows(tier, "owner")) return tabs');
    const tabsBlock = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
    expect(tabsBlock).not.toContain("owner_pnl");
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    expect(admin).toContain('if (urlTab === "owner_pnl")');
    expect(admin).toContain('return "overview"');
    expect(admin).toContain("OWNER_PNL_ENABLED && tab === \"owner_pnl\"");
  });
});
