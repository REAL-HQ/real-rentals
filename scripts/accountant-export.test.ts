import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { railEntries, visibleTabs } from "../src/components/admin/nav-config";
import { ACCOUNTANT_EXPORT_ENABLED } from "../src/lib/accountant-export-flag";
import {
  accountantDetailCsv,
  accountantMonthlyCsv,
  buildAccountantYear,
  type ExpenseDetailSource,
} from "../src/lib/accountant-export";
import { runAccountantExport, type AccountantLoad } from "../src/lib/accountant-export.server";
import { monthWindow, type OwnerPnlDirectory } from "../src/lib/owner-pnl";
import { readPartnerCharges, STRIPE_CHARGE_PAGE_CAP, type ReadOnlyStripeGateway } from "../src/lib/partner-statement-read.server";

const NOW = new Date("2026-10-21T15:00:00Z");

function directory(): OwnerPnlDirectory {
  return {
    payments: [
      { id: "pay1", vehicleId: "v1", type: "rent", paymentIntentId: "pi_v1", invoiceId: null, subscriptionId: null },
      { id: "pay2", vehicleId: "v2", type: "rent", paymentIntentId: "pi_v2", invoiceId: null, subscriptionId: null },
      { id: "pay3", vehicleId: "v1", type: "deposit", paymentIntentId: "pi_dep", invoiceId: null, subscriptionId: null },
    ],
    rentals: [],
    expenses: [
      { id: "e-jan", vehicleId: "v1", category: "insurance", amount: "10.00", incurredOn: "2026-01-02", maintenanceRecordId: null },
      { id: "e-sep", vehicleId: "v2", category: 'pads, "front"', amount: "1.00", incurredOn: "2026-09-15", maintenanceRecordId: null },
      { id: "e-oct", vehicleId: "v1", category: "repair", amount: "100.50", incurredOn: "2026-10-15", maintenanceRecordId: "m1" },
      { id: "e-ins", vehicleId: "v1", category: "insurance", amount: "10.00", incurredOn: "2026-10-02", maintenanceRecordId: null },
      { id: "e-old", vehicleId: "v1", category: "fuel", amount: "4.00", incurredOn: "2025-12-15", maintenanceRecordId: null },
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

function details(): ExpenseDetailSource[] {
  return [
    { incurredOn: "2026-01-02", vehicleId: "v1", category: "insurance", vendorId: null, description: "Policy", amount: "10.00", receiptOnFile: true },
    { incurredOn: "2026-09-15", vehicleId: "v2", category: 'pads, "front"', vendorId: "vendor-1", description: 'Brake, "front"', amount: "1.00", receiptOnFile: false },
    { incurredOn: "2026-10-15", vehicleId: "v1", category: "repair", vendorId: null, description: "Brake pads", amount: "100.50", receiptOnFile: false },
    { incurredOn: "2026-10-02", vehicleId: "v1", category: "insurance", vendorId: null, description: "October premium", amount: "10.00", receiptOnFile: false },
    { incurredOn: "2025-12-15", vehicleId: "v1", category: "fuel", vendorId: null, description: "Last year", amount: "4.00", receiptOnFile: false },
  ];
}

function charge(id: string, paymentIntentId: string, amountCents: number, created: number) {
  return {
    id, paymentIntentId, amountCents, created, currency: "usd", succeeded: true,
    customerId: null, invoiceId: null, subscriptionId: null,
  };
}

function charges() {
  const january = monthWindow("2026-01")!;
  const october = monthWindow("2026-10")!;
  return [
    charge("ch-jan", "pi_v1", 10000, january.gte + 10),
    charge("ch-none-jan", "pi_none", 3000, january.gte + 10),
    charge("ch-oct-1", "pi_v1", 35000, october.gte + 10),
    charge("ch-oct-2", "pi_v2", 8000, october.gte + 10),
    charge("ch-none", "pi_none", 5000, october.gte + 10),
    charge("ch-dep", "pi_dep", 20000, october.gte + 10),
  ];
}

function yearInput(extra: { blankRevenue?: boolean; warnings?: string[] } = {}) {
  return {
    year: "2026",
    now: NOW,
    directory: directory(),
    charges: extra.blankRevenue ? [] : charges(),
    detailRows: details(),
    vehicles: [
      { id: "v1", label: "Unit 4 · 2020 Honda Civic" },
      { id: "v2", label: 'Camry, "LE"' },
    ],
    vendors: [{ id: "vendor-1", name: 'Shop, "A"' }],
    ...extra,
  };
}

function loaded(): AccountantLoad {
  return {
    directory: directory(),
    detailRows: details(),
    vehicles: [
      { id: "v1", label: "Unit 4 · 2020 Honda Civic" },
      { id: "v2", label: 'Camry, "LE"' },
    ],
    vendors: [{ id: "vendor-1", name: 'Shop, "A"' }],
    ledgerCapped: false,
    namesCapped: false,
  };
}

describe("accountant year export", () => {
  it("returns disabled before any load or Stripe read when the flag is off", async () => {
    let loadedCount = 0;
    let reads = 0;
    const result = await runAccountantExport({
      enabled: false,
      userId: "owner-1",
      tier: "owner",
      year: "2026",
      now: NOW,
      load: async () => { loadedCount += 1; return loaded(); },
      readCharges: async () => { reads += 1; return { ok: true, charges: [] }; },
    });
    expect(result).toEqual({ status: "disabled", report: null });
    expect(loadedCount).toBe(0);
    expect(reads).toBe(0);
    expect(ACCOUNTANT_EXPORT_ENABLED).toBe(false);
  });

  it("refuses a manager and a future year before any load or Stripe read", async () => {
    let loadedCount = 0;
    let reads = 0;
    const load = async () => { loadedCount += 1; return loaded(); };
    const readCharges = async () => { reads += 1; return { ok: true as const, charges: [] }; };
    await expect(runAccountantExport({
      enabled: true, userId: "manager-1", tier: "manager", year: "2026", now: NOW, load, readCharges,
    })).rejects.toThrow("Forbidden");
    const future = await runAccountantExport({
      enabled: true, userId: "owner-1", tier: "owner", year: "2027", now: NOW, load, readCharges,
    });
    expect(future).toEqual({ status: "unavailable", reason: "Choose a year through the current year", report: null });
    expect(loadedCount).toBe(0);
    expect(reads).toBe(0);
  });

  it("sums each month into the year total and keeps deposits out of net", () => {
    const report = buildAccountantYear(yearInput());
    expect(report).not.toBeNull();
    const months = report!.months;
    expect(months.map((month) => month.month)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    const sum = (key: "revenueCents" | "unattributedCents" | "refundsCents" | "depositsCollectedCents" | "depositsRefundedCents" | "expenseCents" | "netCents") =>
      months.reduce((acc, month) => acc + (month[key] ?? 0), 0);
    expect(report!.ytd.revenueCents).toBe(sum("revenueCents"));
    expect(report!.ytd.unattributedCents).toBe(sum("unattributedCents"));
    expect(report!.ytd.refundsCents).toBe(sum("refundsCents"));
    expect(report!.ytd.depositsCollectedCents).toBe(sum("depositsCollectedCents"));
    expect(report!.ytd.depositsRefundedCents).toBe(sum("depositsRefundedCents"));
    expect(report!.ytd.expenseCents).toBe(sum("expenseCents"));
    expect(report!.ytd.netCents).toBe(sum("netCents"));
    expect(report!.ytd.netCents).toBe(report!.ytd.revenueCents! - report!.ytd.refundsCents! - report!.ytd.expenseCents!);
    expect(report!.ytd).toMatchObject({
      revenueCents: 53000,
      unattributedCents: 8000,
      refundsCents: 2500,
      depositsCollectedCents: 20000,
      depositsRefundedCents: 500,
      expenseCents: 12150,
      netCents: 38350,
    });
    expect(months.find((month) => month.month === "2026-02")).toMatchObject({ revenueCents: 0, expenseCents: 0, netCents: 0, depositsCollectedCents: 0 });
    expect(months.find((month) => month.month === "2026-10")).toMatchObject({
      revenueCents: 43000, refundsCents: 2500, depositsCollectedCents: 20000, depositsRefundedCents: 500, expenseCents: 11050, netCents: 29450,
    });
    expect(report!.details.map((row) => row.date)).toEqual(["2026-01-02", "2026-09-15", "2026-10-02", "2026-10-15"]);
    expect(report!.details.reduce((acc, row) => acc + row.amountCents, 0)).toBe(report!.ytd.expenseCents);
  });

  it("quotes commas and quotes in both CSVs and never writes a receipt url", () => {
    const report = buildAccountantYear(yearInput())!;
    const monthly = accountantMonthlyCsv(report);
    const detail = accountantDetailCsv(report);
    expect(monthly).toContain('"Pads, ""front"""');
    expect(monthly).toContain("Year To Date,530.00,80.00,25.00,200.00,5.00");
    expect(detail).toContain('"Brake, ""front"""');
    expect(detail).toContain('"Shop, ""A"""');
    expect(detail).toContain('"Camry, ""LE"""');
    expect(detail).toContain(",Yes");
    expect(detail).toContain(",No");
    expect(detail).not.toContain("http");
    expect(detail).not.toContain("receipts/");
    expect(JSON.stringify(report.details)).not.toContain("receipt_path");
  });

  it("asks the existing charge reader once and blanks revenue when that reader hits its page cap", async () => {
    const windows: { gte: number; lt: number }[] = [];
    const ready = await runAccountantExport({
      enabled: true,
      userId: "owner-1",
      tier: "owner",
      year: "2026",
      now: NOW,
      load: async () => loaded(),
      readCharges: async (window) => { windows.push(window); return { ok: true, charges: charges() }; },
    });
    expect(ready.status).toBe("ready");
    expect(windows).toEqual([{ gte: monthWindow("2026-01")!.gte, lt: monthWindow("2026-10")!.lt }]);
    const capped = await runAccountantExport({
      enabled: true,
      userId: "owner-1",
      tier: "owner",
      year: "2026",
      now: NOW,
      load: async () => loaded(),
      readCharges: async () => ({ ok: false, reason: STRIPE_CHARGE_PAGE_CAP, capped: true }),
    });
    expect(capped.status).toBe("ready");
    if (capped.status !== "ready") return;
    expect(capped.report.warnings.some((warning) => warning.includes("Page Limit"))).toBe(true);
    expect(capped.report.months.every((month) => month.revenueCents === null && month.netCents === null && month.depositsCollectedCents === null)).toBe(true);
    expect(capped.report.ytd.revenueCents).toBeNull();
    expect(capped.report.ytd.netCents).toBeNull();
    expect(capped.report.ytd.expenseCents).toBe(12150);
    let calls = 0;
    const gateway: ReadOnlyStripeGateway = {
      charges: {
        list: async () => {
          calls += 1;
          return {
            has_more: true,
            data: [{
              id: `ch_${calls}`, amount_captured: 100, currency: "usd", status: "succeeded",
              paid: true, captured: true, created: 1_700_000_000, livemode: true,
            }],
          };
        },
      },
    };
    const limited = await readPartnerCharges(gateway, { gte: 1, lt: 2 }, { timeoutMs: 60_000, now: () => 0 });
    expect(calls).toBe(100);
    expect(limited).toEqual({ ok: false, reason: STRIPE_CHARGE_PAGE_CAP, capped: true });
  });

  it("keeps the screen, the owner check, and Stripe behind the constant", () => {
    expect(visibleTabs("owner").some((tab) => tab.id === "accountant_export")).toBe(false);
    expect(railEntries("owner").some((tab) => tab.id === "accountant_export")).toBe(false);
    expect(visibleTabs("manager").some((tab) => tab.id === "accountant_export")).toBe(false);
    const handler = readFileSync(new URL("../src/lib/accountant-export.functions.ts", import.meta.url), "utf8");
    const flagAt = handler.indexOf("if (!ACCOUNTANT_EXPORT_ENABLED) return DISABLED");
    const ownerAt = handler.indexOf("await requireOwner(context.userId)");
    const stripeAt = handler.indexOf("readLivePartnerCharges(window)");
    expect(flagAt).toBeGreaterThan(-1);
    expect(ownerAt).toBeGreaterThan(flagAt);
    expect(stripeAt).toBeGreaterThan(ownerAt);
    expect(handler.match(/readLivePartnerCharges\(/g)).toHaveLength(1);
    for (const name of ["accountant-export.ts", "accountant-export.server.ts", "accountant-export.functions.ts", "accountant-export-flag.ts"]) {
      const source = readFileSync(new URL(`../src/lib/${name}`, import.meta.url), "utf8");
      expect(source).not.toContain("charges.list");
      expect(source).not.toContain(".insert(");
      expect(source).not.toContain(".update(");
      expect(source).not.toContain(".delete(");
    }
    const server = readFileSync(new URL("../src/lib/accountant-export.server.ts", import.meta.url), "utf8");
    expect(server).toContain("OWNER_DIRECTORY_PAGE");
    expect(server).toContain("OWNER_DIRECTORY_MAX_PAGES");
    expect(server).toContain("receiptOnFile");
    const nav = readFileSync(new URL("../src/components/admin/nav-config.ts", import.meta.url), "utf8");
    expect(nav).toContain('if (!ACCOUNTANT_EXPORT_ENABLED || !tierAllows(tier, "owner")) return tabs');
    const tabsBlock = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
    expect(tabsBlock).not.toContain("accountant_export");
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    expect(admin).toContain('if (urlTab === "accountant_export")');
    expect(admin).toContain("!ACCOUNTANT_EXPORT_ENABLED || (tier && !tierAllows(tier, \"owner\"))");
    expect(admin).toContain("ACCOUNTANT_EXPORT_ENABLED && tab === \"accountant_export\"");
  });
});
