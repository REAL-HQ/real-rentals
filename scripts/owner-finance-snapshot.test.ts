import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { railEntries, TABS, visibleTabs } from "../src/components/admin/nav-config";
import { NOT_AVAILABLE, ownerFinanceSnapshotToCsv, type OwnerFinanceSnapshotReport } from "../src/lib/owner-finance-snapshot";
import { OWNER_FINANCE_SNAPSHOT_OFF } from "../src/lib/owner-finance-snapshot-flag";
import { rentCollectedCents, runOwnerFinanceSnapshot } from "../src/lib/owner-finance-snapshot.server";
import {
  RENT_CATEGORIES,
  type RentCategory,
  type RentReconciliationReport,
  type RentTotals,
} from "../src/lib/rent-reconciliation";
import type { RentReconciliationResponse } from "../src/lib/rent-reconciliation.server";

const NOW = new Date("2026-10-21T15:00:00Z");
const WEEK = { from: "2026-10-12", through: "2026-10-18" };

function readyReport(counts: Partial<Record<RentCategory, number>>, over: Partial<RentReconciliationReport> = {}): RentReconciliationResponse {
  const totals = Object.fromEntries(RENT_CATEGORIES.map((category) => [category, { count: counts[category] ?? 0, cents: 0 }])) as RentTotals;
  return {
    status: "ready",
    report: {
      from: WEEK.from,
      through: WEEK.through,
      rows: [],
      totals,
      stripeCheck: "ready",
      warnings: [],
      omitted: [],
      ...over,
    },
  };
}

function tile(report: OwnerFinanceSnapshotReport, id: OwnerFinanceSnapshotReport["tiles"][number]["id"]) {
  const found = report.tiles.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

it("throws before any read when the flag is off", async () => {
  const rent = vi.fn(async () => 100);
  const reconciliation = vi.fn(async () => readyReport({}));
  await expect(runOwnerFinanceSnapshot({
    enabled: false,
    userId: "owner",
    tier: "owner",
    now: NOW,
    weekStart: null,
    rentCollected: rent,
    reconciliation,
  })).rejects.toThrow(OWNER_FINANCE_SNAPSHOT_OFF);
  expect(rent).not.toHaveBeenCalled();
  expect(reconciliation).not.toHaveBeenCalled();
});

it("refuses a manager, a coordinator, and a missing user before any read", async () => {
  const rent = vi.fn(async () => 100);
  const reconciliation = vi.fn(async () => readyReport({}));
  for (const actor of [
    { userId: "manager", tier: "manager" as const },
    { userId: "coord", tier: "coordinator" as const },
    { userId: null, tier: "owner" as const },
  ]) {
    await expect(runOwnerFinanceSnapshot({
      enabled: true,
      userId: actor.userId,
      tier: actor.tier,
      now: NOW,
      weekStart: WEEK.from,
      rentCollected: rent,
      reconciliation,
    })).rejects.toThrow("Forbidden");
  }
  expect(rent).not.toHaveBeenCalled();
  expect(reconciliation).not.toHaveBeenCalled();
});

it("defaults to the last full week and snaps a chosen day to Monday", async () => {
  const seen: string[] = [];
  const rent = vi.fn(async (week: { from: string }) => {
    seen.push(week.from);
    return 0;
  });
  const reconciliation = vi.fn(async () => readyReport({}));
  const def = await runOwnerFinanceSnapshot({
    enabled: true,
    userId: "owner",
    tier: "owner",
    now: NOW,
    weekStart: null,
    rentCollected: rent,
    reconciliation,
  });
  const chosen = await runOwnerFinanceSnapshot({
    enabled: true,
    userId: "owner",
    tier: "owner",
    now: NOW,
    weekStart: "2026-10-14",
    rentCollected: rent,
    reconciliation,
  });
  expect(def.status).toBe("ready");
  expect(chosen.status).toBe("ready");
  if (def.status !== "ready" || chosen.status !== "ready") return;
  expect(def.report.from).toBe("2026-10-12");
  expect(def.report.through).toBe("2026-10-18");
  expect(chosen.report.from).toBe("2026-10-12");
  expect(seen).toEqual(["2026-10-12", "2026-10-12"]);
});

it("sums collections revenue for the week and leaves absent sections unavailable", async () => {
  expect(rentCollectedCents([
    { status: "paid", type: "rent", net_collected: 100, refunded_amount: 0, paid_date: "2026-10-14" },
    { status: "paid", type: "deposit", net_collected: 500, refunded_amount: 0, paid_date: "2026-10-14" },
    { status: "paid", type: "late_fee", net_collected: 15, refunded_amount: 2, paid_date: "2026-10-12T15:00:00Z" },
    { status: "paid", type: "rent", net_collected: 80, refunded_amount: 0, paid_date: "2026-10-01" },
    { status: "unpaid", type: "rent", net_collected: null, paid_date: "2026-10-14", amount: 40 },
  ], WEEK)).toBe(11500);
  const result = await runOwnerFinanceSnapshot({
    enabled: true,
    userId: "owner",
    tier: "owner",
    now: NOW,
    weekStart: "2026-10-14",
    rentCollected: async () => 11500,
    reconciliation: async () => readyReport({ matched: 5, missing_or_failed: 1, amount_mismatch: 2, stripe_only: 1 }),
  });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") return;
  expect(tile(result.report, "rent_collected").value).toBe("$115.00");
  expect(tile(result.report, "rent_collected").tab).toBe("payments");
  expect(tile(result.report, "reconciliation_exceptions").value).toBe("4");
  expect(tile(result.report, "reconciliation_exceptions").tab).toBe("rent_reconciliation");
  for (const id of ["outstanding_balance", "deposits_held", "refunds_due", "revenue_forecast", "vehicle_utilization"] as const) {
    expect(tile(result.report, id).value).toBe(NOT_AVAILABLE);
    expect(tile(result.report, id).tab).toBeNull();
  }
});

it("keeps the other tiles when one read fails", async () => {
  const result = await runOwnerFinanceSnapshot({
    enabled: true,
    userId: "owner",
    tier: "owner",
    now: NOW,
    weekStart: WEEK.from,
    rentCollected: async () => {
      throw new Error("payments unread");
    },
    reconciliation: async () => readyReport({ missing_or_failed: 2 }),
  });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") return;
  expect(tile(result.report, "rent_collected").value).toBe(NOT_AVAILABLE);
  expect(tile(result.report, "reconciliation_exceptions").value).toBe("2");
  expect(tile(result.report, "deposits_held").value).toBe(NOT_AVAILABLE);
});

it("withholds the exception count when the Stripe check or the page cap fails", async () => {
  const stripeDown = await runOwnerFinanceSnapshot({
    enabled: true,
    userId: "owner",
    tier: "owner",
    now: NOW,
    weekStart: WEEK.from,
    rentCollected: async () => 2500,
    reconciliation: async () => readyReport({}, { stripeCheck: "unavailable", totals: null }),
  });
  const capped = await runOwnerFinanceSnapshot({
    enabled: true,
    userId: "owner",
    tier: "owner",
    now: NOW,
    weekStart: WEEK.from,
    rentCollected: async () => 2500,
    reconciliation: async () => readyReport({}, { warnings: ["Rent payment records hit the page cap."], totals: null }),
  });
  const thrown = await runOwnerFinanceSnapshot({
    enabled: true,
    userId: "owner",
    tier: "owner",
    now: NOW,
    weekStart: WEEK.from,
    rentCollected: async () => 2500,
    reconciliation: async () => {
      throw new Error("stripe");
    },
  });
  for (const result of [stripeDown, capped, thrown]) {
    expect(result.status).toBe("ready");
    if (result.status !== "ready") continue;
    expect(tile(result.report, "rent_collected").value).toBe("$25.00");
    expect(tile(result.report, "reconciliation_exceptions").value).toBe(NOT_AVAILABLE);
  }
});

it("does not read an unusable week and still returns every tile", async () => {
  const rent = vi.fn(async () => 100);
  const reconciliation = vi.fn(async () => readyReport({}));
  const result = await runOwnerFinanceSnapshot({
    enabled: true,
    userId: "owner",
    tier: "owner",
    now: NOW,
    weekStart: "not-a-day",
    rentCollected: rent,
    reconciliation,
  });
  expect(rent).not.toHaveBeenCalled();
  expect(reconciliation).not.toHaveBeenCalled();
  expect(result.status).toBe("ready");
  if (result.status !== "ready") return;
  expect(result.report.from).toBeNull();
  expect(result.report.tiles.every((item) => item.value === NOT_AVAILABLE)).toBe(true);
});

it("rejects an invalid collection row instead of inventing a total", () => {
  expect(() => rentCollectedCents([
    { status: "paid", type: "rent", net_collected: null, refunded_amount: 0, paid_date: "2026-10-14" },
  ], WEEK)).toThrow("Invalid collection record");
});

it("escapes commas, quotes, and formula prefixes in the tile CSV", () => {
  const report: OwnerFinanceSnapshotReport = {
    from: WEEK.from,
    through: WEEK.through,
    tiles: [
      { id: "rent_collected", label: 'Say "hi", now', value: "=1+1", screen: "Payments", tab: "payments" },
      { id: "outstanding_balance", label: "Outstanding Balance", value: NOT_AVAILABLE, screen: null, tab: null },
      { id: "deposits_held", label: "Deposits Held", value: NOT_AVAILABLE, screen: null, tab: null },
      { id: "refunds_due", label: "Refunds Due", value: NOT_AVAILABLE, screen: null, tab: null },
      { id: "reconciliation_exceptions", label: "Reconciliation Exceptions", value: "$1,234.56", screen: "Rent Reconciliation", tab: "rent_reconciliation" },
      { id: "revenue_forecast", label: "4-Week Forecast", value: NOT_AVAILABLE, screen: null, tab: null },
      { id: "vehicle_utilization", label: "Vehicle Utilization", value: NOT_AVAILABLE, screen: null, tab: null },
    ],
  };
  const csv = ownerFinanceSnapshotToCsv(report);
  expect(csv).toContain('"Say ""hi"", now"');
  expect(csv).toContain(`"'=1+1"`);
  expect(csv).toContain('"$1,234.56"');
  expect(csv).toContain(NOT_AVAILABLE);
  expect(csv.startsWith("Owner Weekly Finance Snapshot\r\n")).toBe(true);
});

it("keeps the snapshot out of the dark nav and behind the throw", () => {
  const flag = readFileSync("src/lib/owner-finance-snapshot-flag.ts", "utf8");
  const fn = readFileSync("src/lib/owner-finance-snapshot.functions.ts", "utf8");
  const server = readFileSync("src/lib/owner-finance-snapshot.server.ts", "utf8");
  const pure = readFileSync("src/lib/owner-finance-snapshot.ts", "utf8");
  const panel = readFileSync("src/components/admin/OwnerFinanceSnapshotPanel.tsx", "utf8");
  const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
  const admin = readFileSync("src/routes/admin.tsx", "utf8");
  const rentFlag = readFileSync("src/lib/rent-reconciliation-flag.ts", "utf8");
  const tabs = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
  const disabled = fn.indexOf("if (!OWNER_FINANCE_SNAPSHOT_ENABLED) throw new Error(OWNER_FINANCE_SNAPSHOT_OFF);");
  const owner = fn.indexOf("await requireOwner(context.userId)");
  expect(flag).toContain("export const OWNER_FINANCE_SNAPSHOT_ENABLED = false");
  expect(disabled).toBeGreaterThan(-1);
  expect(owner).toBeGreaterThan(disabled);
  expect(fn.indexOf("readPaymentReport(")).toBeGreaterThan(owner);
  expect(fn.indexOf("runRentReconciliation(")).toBeGreaterThan(owner);
  expect(fn.indexOf("readLiveRentStripe(")).toBeGreaterThan(owner);
  expect(fn.indexOf('import("./revenue-report")')).toBeGreaterThan(owner);
  expect(fn.indexOf('import("./rent-reconciliation-stripe.server")')).toBeGreaterThan(owner);
  expect(fn.indexOf('import("@/integrations/supabase/client.server")')).toBeGreaterThan(owner);
  expect(fn).not.toContain("requireManager");
  expect(fn).toContain("enabled: true");
  expect(fn).not.toContain("RENT_RECONCILIATION_ENABLED");
  expect(rentFlag).toContain("export const RENT_RECONCILIATION_ENABLED = false");
  expect(tabs).not.toMatch(/id: "owner_finance_snapshot"/);
  expect(TABS.some((tab) => tab.id === "owner_finance_snapshot")).toBe(false);
  for (const tier of ["owner", "manager", "coordinator"] as const) {
    expect(visibleTabs(tier).some((tab) => tab.id === "owner_finance_snapshot")).toBe(false);
    expect(railEntries(tier).some((entry) => entry.id === "owner_finance_snapshot")).toBe(false);
  }
  expect(admin.indexOf('urlTab === "owner_finance_snapshot"')).toBeGreaterThan(-1);
  expect(admin.indexOf('urlTab === "owner_finance_snapshot"')).toBeLessThan(admin.indexOf("TABS.some"));
  expect(admin).toContain('OWNER_FINANCE_SNAPSHOT_ENABLED && tab === "owner_finance_snapshot"');
  expect(panel).toContain("NOT_AVAILABLE");
  expect(panel).toContain("Week Starting");
  expect(panel).toContain("Download CSV");
  expect(pure).toContain('export const NOT_AVAILABLE = "Not available"');
  expect(server).toContain("collectionSummary");
  expect(server).not.toContain("createReadOnlyStripe");
  expect(server).not.toContain("createStripeClient");
  for (const source of [flag, fn, server, pure, panel]) {
    expect(source).not.toMatch(/\.from\(/);
    expect(source).not.toMatch(/\.(or|filter)\(\s*`[^`]*\$\{/);
    expect(source).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(source).not.toContain("createReadOnlyStripe");
    expect(source).not.toContain("createStripeClient");
  }
});
