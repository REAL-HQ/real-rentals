import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visibleTabs, railEntries } from "../src/components/admin/nav-config";
import { PARTNER_STATEMENT_ENABLED } from "../src/lib/partner-statement-flag";
import {
  buildPartnerStatement,
  partnerStatementCsv,
  periodWindow,
  type PartnerStatementDirectory,
} from "../src/lib/partner-statement";
import { runPartnerStatement } from "../src/lib/partner-statement.server";

const NOW = new Date("2026-10-21T15:00:00Z");

function directory(split: number | string | null): PartnerStatementDirectory {
  return {
    partners: [
      { id: "p1", name: "North Lot", revenueSplitPct: split },
      { id: "p2", name: "Other Lot", revenueSplitPct: 25 },
    ],
    vehicles: [
      { id: "v1", year: 2020, make: "Honda", model: "Civic", licensePlate: "ABC123", partnerId: "p1" },
      { id: "v2", year: 2019, make: "Toyota", model: "Camry", licensePlate: "OTHER", partnerId: "p2" },
      { id: "v3", year: null, make: "=cmd", model: null, licensePlate: null, partnerId: "p1" },
    ],
    expenses: [
      { id: "e1", vehicleId: "v1", category: "repair", amount: "100.50", incurredOn: "2026-10-15", maintenanceRecordId: "m1" },
    ],
    maintenance: [
      { id: "m1", vehicleId: "v1", category: "repair", companyShare: "100.50", performedOn: "2026-10-15", completedAt: null, createdAt: null },
    ],
    rentals: [],
    payments: [
      { id: "pay1", vehicleId: "v1", type: "rent", paymentIntentId: "pi_v1", invoiceId: null, subscriptionId: null },
      { id: "pay2", vehicleId: "v2", type: "rent", paymentIntentId: "pi_v2", invoiceId: null, subscriptionId: null },
      { id: "pay3", vehicleId: "v1", type: "deposit", paymentIntentId: "pi_dep", invoiceId: null, subscriptionId: null },
    ],
  };
}

function charges(created: number) {
  const succeeded = { currency: "usd", succeeded: true, customerId: null, invoiceId: null, subscriptionId: null };
  return [
    { id: "ch_v1", ...succeeded, paymentIntentId: "pi_v1", amountCents: 35000, created },
    { id: "ch_v2", ...succeeded, paymentIntentId: "pi_v2", amountCents: 8000, created },
    { id: "ch_none", ...succeeded, paymentIntentId: "pi_none", amountCents: 5000, created },
    { id: "ch_dep", ...succeeded, paymentIntentId: "pi_dep", amountCents: 20000, created },
  ];
}

describe("partner statement", () => {
  it("dates the periods on Eastern Time", () => {
    expect(periodWindow("this_month", NOW)).toMatchObject({ from: "2026-10-01", to: "2026-11-01" });
    expect(periodWindow("last_month", NOW)).toMatchObject({ from: "2026-09-01", to: "2026-10-01" });
    expect(periodWindow("last_90", NOW)).toMatchObject({ from: "2026-07-24", to: "2026-10-22" });
  });

  it("splits attributed revenue and keeps a linked service as one expense", () => {
    const window = periodWindow("this_month", NOW)!;
    const statement = buildPartnerStatement({
      ...directory(50),
      partnerId: "p1",
      period: "this_month",
      now: NOW,
      charges: charges(window.gte + 10),
    });
    expect(statement).toMatchObject({
      partnerName: "North Lot",
      from: "2026-10-01",
      through: "2026-10-31",
      split: "configured",
      splitLabel: "50%",
      revenueCents: 35000,
      expenseCents: 10050,
      netCents: 24950,
      partnerShareCents: 17500,
      unattributedStripeRevenueCents: 5000,
      depositsExcludedCents: 20000,
      revenueComplete: true,
    });
    expect(statement?.vehicles.map((vehicle) => vehicle.vehicleId).sort()).toEqual(["v1", "v3"]);
    expect(statement?.vehicles.find((vehicle) => vehicle.vehicleId === "v1")).toMatchObject({
      revenueCents: 35000, expenseCents: 10050, netCents: 24950, partnerShareCents: 17500,
    });
    expect(statement?.vehicles.find((vehicle) => vehicle.vehicleId === "v2")).toBeUndefined();
    const csv = partnerStatementCsv(statement!);
    expect(csv).toContain("350.00,100.50,249.50,175.00");
    expect(csv).toContain("Unattributed Revenue,50.00");
    expect(csv).toContain("'=cmd");
    expect(csv).not.toContain("80.00");
  });

  it("rounds a fractional split per vehicle", () => {
    const window = periodWindow("this_month", NOW)!;
    const statement = buildPartnerStatement({
      ...directory("33.33"),
      partnerId: "p1",
      period: "this_month",
      now: NOW,
      charges: [{ id: "ch", currency: "usd", succeeded: true, customerId: null, invoiceId: null, subscriptionId: null, paymentIntentId: "pi_v1", amountCents: 100, created: window.gte + 1 }],
    });
    expect(statement?.vehicles.find((vehicle) => vehicle.vehicleId === "v1")?.partnerShareCents).toBe(33);
    expect(statement?.splitLabel).toBe("33.33%");
  });

  it("treats zero as a configured split and an unusable percent as missing", () => {
    const window = periodWindow("this_month", NOW)!;
    const base = {
      partnerId: "p1",
      period: "this_month" as const,
      now: NOW,
      charges: charges(window.gte + 10),
    };
    const zero = buildPartnerStatement({ ...directory(0), ...base });
    expect(zero?.split).toBe("configured");
    expect(zero?.partnerShareCents).toBe(0);
    expect(zero?.revenueCents).toBe(35000);
    for (const missing of [null, "101", "50.555", ""]) {
      const statement = buildPartnerStatement({ ...directory(missing), ...base });
      expect(statement?.split).toBe("not_configured");
      expect(statement?.splitLabel).toBe("Split not configured");
      expect(statement?.partnerShareCents).toBeNull();
      expect(statement?.revenueCents).toBe(35000);
      expect(statement?.netCents).toBe(24950);
    }
  });

  it("returns disabled before any load when the flag is off", async () => {
    let loaded = 0;
    let read = 0;
    const result = await runPartnerStatement({
      enabled: false,
      userId: "owner-1",
      tier: "owner",
      partnerId: "p1",
      period: "this_month",
      now: NOW,
      load: async () => { loaded += 1; return directory(50); },
      readCharges: async () => { read += 1; return { ok: true, charges: [] }; },
    });
    expect(result).toEqual({ status: "disabled", partners: [], statement: null });
    expect(loaded).toBe(0);
    expect(read).toBe(0);
    expect(PARTNER_STATEMENT_ENABLED).toBe(false);
  });

  it("refuses a manager before reading, and lists partners without Stripe", async () => {
    let loaded = 0;
    let read = 0;
    const load = async () => { loaded += 1; return directory(50); };
    const readCharges = async () => { read += 1; return { ok: true as const, charges: [] }; };
    await expect(runPartnerStatement({
      enabled: true, userId: "manager-1", tier: "manager", partnerId: "p1", period: "this_month", now: NOW, load, readCharges,
    })).rejects.toThrow("Forbidden");
    expect(loaded).toBe(0);
    expect(read).toBe(0);
    const listed = await runPartnerStatement({
      enabled: true, userId: "owner-1", tier: "owner", partnerId: null, period: "this_month", now: NOW, load, readCharges,
    });
    expect(listed.status).toBe("ready");
    if (listed.status === "ready") {
      expect(listed.statement).toBeNull();
      expect(listed.partners.map((partner) => partner.name)).toEqual(["North Lot", "Other Lot"]);
    }
    expect(loaded).toBe(1);
    expect(read).toBe(0);
  });

  it("keeps the screen and the owner check behind the constant", () => {
    expect(visibleTabs("owner").some((tab) => tab.id === "partner_statement")).toBe(false);
    expect(railEntries("owner").some((tab) => tab.id === "partner_statement")).toBe(false);
    const handler = readFileSync(new URL("../src/lib/partner-statement.functions.ts", import.meta.url), "utf8");
    const flagAt = handler.indexOf("if (!PARTNER_STATEMENT_ENABLED) return DISABLED");
    const ownerAt = handler.indexOf("requireOwner");
    expect(flagAt).toBeGreaterThan(-1);
    expect(ownerAt).toBeGreaterThan(flagAt);
    const reader = readFileSync(new URL("../src/lib/partner-statement-read.server.ts", import.meta.url), "utf8");
    expect(reader).toContain("charges.list");
    expect(reader).toContain('createReadOnlyStripe("live", { cache: true })');
    expect(reader).not.toContain("createStripeClient");
    expect(reader).not.toMatch(/\.create\(|\.update\(|refunds|paymentIntents|checkout\.sessions/);
    const nav = readFileSync(new URL("../src/components/admin/nav-config.ts", import.meta.url), "utf8");
    expect(nav).toContain('if (!PARTNER_STATEMENT_ENABLED || !tierAllows(tier, "owner")) return tabs');
    const tabsBlock = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
    expect(tabsBlock).not.toContain("partner_statement");
  });
});
