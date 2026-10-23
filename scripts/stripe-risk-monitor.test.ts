import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { railEntries, TABS, visibleTabs } from "../src/components/admin/nav-config";
import { STRIPE_READER_MAX_PAGES } from "../src/lib/stripe-reader";
import {
  DIRECTORY_INCOMPLETE,
  STRIPE_CHECK_UNAVAILABLE,
  buildStripeRiskMonitor,
  formatEt,
  riskWindow,
  stripeRiskMonitorToCsv,
  type RiskReport,
} from "../src/lib/stripe-risk-monitor";
import { STRIPE_RISK_MONITOR_OFF } from "../src/lib/stripe-risk-monitor-flag";
import { readStripeRisk, type RiskStripeGateway } from "../src/lib/stripe-risk-monitor-read.server";
import { runStripeRiskMonitor } from "../src/lib/stripe-risk-monitor.server";

const stripeMock = vi.hoisted(() => {
  const update = vi.fn();
  const create = vi.fn();
  const confirm = vi.fn();
  const createStripeClient = vi.fn(() => ({
    disputes: { list: vi.fn(), update },
    charges: { list: vi.fn(), create },
    paymentIntents: { list: vi.fn(), confirm },
    subscriptions: { list: vi.fn() },
  }));
  return { update, create, confirm, createStripeClient };
});
vi.mock("../src/lib/stripe.server", () => ({ createStripeClient: stripeMock.createStripeClient }));
import { createReadOnlyStripe } from "../src/lib/stripe-reader.server";

const NOW = new Date("2026-10-21T15:00:00Z");
const WINDOW = riskWindow(NOW)!;
const DUE_SOON = Math.floor(Date.parse("2026-10-22T15:00:00Z") / 1000);
const DUE_LATER = Math.floor(Date.parse("2026-10-28T15:00:00Z") / 1000);
const FAILED_AT = Math.floor(Date.parse("2026-10-20T15:00:00Z") / 1000);
const PERIOD_END = Math.floor(Date.parse("2026-10-19T15:00:00Z") / 1000);

const applications = [
  { id: "app-1", name: 'Ada, "Bee"', stripeCustomerId: "cus_1", deleted: false },
  { id: "app-2", name: "Grace Hopper", stripeCustomerId: "cus_2", deleted: false },
];
const rentals = [
  { id: "rental-1", applicationId: "app-2", stripeCustomerId: "cus_2", stripeSubscriptionId: "sub_1" },
];
const payments = [
  { id: "pay-1", driverId: "app-1", stripePaymentIntentId: "pi_1", stripeSubscriptionId: null },
];

function emptyStripe() {
  return { ok: true as const, disputes: [], failures: [], subscriptions: [] };
}

it("throws before any read when the flag is off", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  const readStripe = vi.fn(async () => emptyStripe());
  await expect(runStripeRiskMonitor({
    enabled: false,
    userId: "owner",
    tier: "owner",
    now: NOW,
    load,
    readStripe,
  })).rejects.toThrow(STRIPE_RISK_MONITOR_OFF);
  expect(load).not.toHaveBeenCalled();
  expect(readStripe).not.toHaveBeenCalled();
});

it("refuses a coordinator and a missing user before any read, and lets an owner and a manager read", async () => {
  const load = vi.fn(async () => ({ ok: true as const, directory: { applications: [], rentals: [], payments: [] } }));
  const readStripe = vi.fn(async () => emptyStripe());
  await expect(runStripeRiskMonitor({
    enabled: true, userId: "coord", tier: "coordinator", now: NOW, load, readStripe,
  })).rejects.toThrow("Forbidden");
  await expect(runStripeRiskMonitor({
    enabled: true, userId: null, tier: "manager", now: NOW, load, readStripe,
  })).rejects.toThrow("Forbidden");
  expect(load).not.toHaveBeenCalled();
  expect(readStripe).not.toHaveBeenCalled();
  const owner = await runStripeRiskMonitor({
    enabled: true, userId: "owner", tier: "owner", now: NOW, load, readStripe,
  });
  const manager = await runStripeRiskMonitor({
    enabled: true, userId: "manager", tier: "manager", now: NOW, load, readStripe,
  });
  expect(owner.status).toBe("ready");
  expect(manager.status).toBe("ready");
  expect(readStripe).toHaveBeenCalledTimes(2);
});

it("sorts a dispute deadline ahead of past_due, unpaid, and a decline", () => {
  expect(WINDOW.lt - WINDOW.gte).toBe(14 * 86400);
  expect(formatEt(Math.floor(Date.parse("2026-10-21T15:00:00Z") / 1000))).toBe("Oct 21, 2026, 11:00 AM EDT");
  const report = buildStripeRiskMonitor({
    window: WINDOW,
    applications,
    rentals,
    payments,
    disputes: [
      { id: "dp_later", status: "needs_response", dueBy: DUE_LATER, created: DUE_LATER, customerId: "cus_2", paymentIntentId: null },
      { id: "dp_soon", status: "warning_needs_response", dueBy: DUE_SOON, created: DUE_SOON, customerId: null, paymentIntentId: "pi_1" },
      { id: "dp_won", status: "won", dueBy: DUE_SOON, created: DUE_SOON, customerId: "cus_1", paymentIntentId: "pi_1" },
    ],
    failures: [
      { id: "ch_fail", created: FAILED_AT, customerId: "cus_1", paymentIntentId: "pi_fail", declineCode: "insufficient_funds" },
      { id: "pi_fail", created: FAILED_AT, customerId: "cus_1", paymentIntentId: "pi_fail", declineCode: null },
    ],
    subscriptions: [
      { id: "sub_1", status: "past_due", customerId: "cus_2", currentPeriodEnd: PERIOD_END },
      { id: "sub_unpaid", status: "unpaid", customerId: "cus_2", currentPeriodEnd: PERIOD_END },
      { id: "sub_active", status: "active", customerId: "cus_2", currentPeriodEnd: PERIOD_END },
    ],
  });
  expect(report.rows.map((row) => [row.id, row.kind, row.status, row.declineCode, row.applicationId])).toEqual([
    ["dp_soon", "dispute", "Warning Needs Response", null, "app-1"],
    ["dp_later", "dispute", "Needs Response", null, "app-2"],
    ["sub_1", "subscription", "Past Due", null, "app-2"],
    ["sub_unpaid", "subscription", "Unpaid", null, "app-2"],
    ["ch_fail", "failed_payment", "Failed", "insufficient_funds", "app-1"],
  ]);
  expect(report.rows[0]?.driverName).toBe('Ada, "Bee"');
  expect(report.rows[0]?.whenEt).toBe("Oct 22, 2026, 11:00 AM EDT");
  const csv = stripeRiskMonitorToCsv({
    ...report,
    rows: [{ ...report.rows[4]!, declineCode: "=1+1" }],
  });
  expect(csv).toContain('"Ada, ""Bee"""');
  expect(csv).toContain(`"'=1+1"`);
  expect(csv).toContain("/admin?tab=drivers&id=app-1");
  expect(csv).toContain("/admin?tab=payments");
});

it("leaves a driver unmatched when two applications share the customer", () => {
  const report = buildStripeRiskMonitor({
    window: WINDOW,
    applications: [
      { id: "app-a", name: "A", stripeCustomerId: "cus_shared", deleted: false },
      { id: "app-b", name: "B", stripeCustomerId: "cus_shared", deleted: false },
    ],
    rentals: [],
    payments: [],
    disputes: [],
    failures: [{ id: "ch_1", created: FAILED_AT, customerId: "cus_shared", paymentIntentId: null, declineCode: "do_not_honor" }],
    subscriptions: [],
  });
  expect(report.rows).toEqual([
    expect.objectContaining({ id: "ch_1", declineCode: "do_not_honor", applicationId: null, driverName: null }),
  ]);
});

it("shows Stripe check unavailable on a Stripe error and does not read the database", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  const gateway: RiskStripeGateway = {
    disputes: { list: async () => { throw new Error("stripe down"); } },
    charges: { list: async () => ({ data: [], has_more: false }) },
    paymentIntents: { list: async () => ({ data: [], has_more: false }) },
    subscriptions: { list: async () => ({ data: [], has_more: false }) },
  };
  const result = await runStripeRiskMonitor({
    enabled: true,
    userId: "manager",
    tier: "manager",
    now: NOW,
    load,
    readStripe: (window) => readStripeRisk(gateway, window),
  });
  expect(load).not.toHaveBeenCalled();
  expect(result.report.stripeCheck).toBe("unavailable");
  expect(result.report.rows).toEqual([]);
  expect(result.report.directory).toBe("skipped");
  expect(STRIPE_CHECK_UNAVAILABLE).toBe("Stripe check unavailable");
});

it("shows Stripe check unavailable on the page cap and does not keep partial rows", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  let disputePages = 0;
  let chargeCalls = 0;
  const gateway: RiskStripeGateway = {
    disputes: {
      list: async () => {
        disputePages += 1;
        return { data: [{ id: `dp_${disputePages}`, status: "needs_response", livemode: true, evidence_details: { due_by: DUE_SOON } }], has_more: true };
      },
    },
    charges: { list: async () => { chargeCalls += 1; return { data: [], has_more: false }; } },
    paymentIntents: { list: async () => ({ data: [], has_more: false }) },
    subscriptions: { list: async () => ({ data: [], has_more: false }) },
  };
  const load = vi.fn(async () => ({ ok: true as const, directory: { applications, rentals, payments } }));
  const result = await runStripeRiskMonitor({
    enabled: true,
    userId: "owner",
    tier: "owner",
    now: NOW,
    load,
    readStripe: (window) => readStripeRisk(gateway, window),
  });
  expect(disputePages).toBe(STRIPE_READER_MAX_PAGES);
  expect(chargeCalls).toBe(0);
  expect(load).not.toHaveBeenCalled();
  expect(result.report).toMatchObject({ stripeCheck: "unavailable", rows: [], directory: "skipped" });
  warn.mockRestore();
});

it("reads a dispute, a decline, and a past_due subscription without calling a write", async () => {
  const update = vi.fn();
  const create = vi.fn();
  const confirm = vi.fn();
  const seen: string[] = [];
  const gateway: RiskStripeGateway & {
    disputes: { update: typeof update };
    charges: { create: typeof create };
    paymentIntents: { confirm: typeof confirm };
  } = {
    disputes: {
      update,
      list: async () => {
        seen.push("disputes");
        return {
          has_more: false,
          data: [
            { id: "dp_1", status: "needs_response", livemode: true, created: DUE_SOON, customer: "cus_1", payment_intent: "pi_1", evidence_details: { due_by: DUE_SOON } },
            { id: "dp_won", status: "won", livemode: true, created: DUE_SOON, evidence_details: { due_by: DUE_SOON } },
          ],
        };
      },
    },
    charges: {
      create,
      list: async (params) => {
        seen.push("charges");
        expect(params.created).toEqual({ gte: WINDOW.gte, lt: WINDOW.lt });
        return {
          has_more: false,
          data: [
            { id: "ch_fail", status: "failed", livemode: true, created: FAILED_AT, customer: "cus_1", payment_intent: "pi_fail", outcome: { decline_code: "insufficient_funds" } },
            { id: "ch_ok", status: "succeeded", livemode: true, created: FAILED_AT, customer: "cus_1" },
            { id: "ch_old", status: "failed", livemode: true, created: WINDOW.gte - 10, customer: "cus_1", failure_code: "card_declined" },
          ],
        };
      },
    },
    paymentIntents: {
      confirm,
      list: async () => ({
        has_more: false,
        data: [
          { id: "pi_fail", status: "requires_payment_method", livemode: true, created: FAILED_AT, customer: "cus_1", last_payment_error: { decline_code: "insufficient_funds" } },
          { id: "pi_ok", status: "succeeded", livemode: true, created: FAILED_AT, customer: "cus_1" },
        ],
      }),
    },
    subscriptions: {
      list: async (params) => ({
        has_more: false,
        data: params.status === "past_due"
          ? [{ id: "sub_1", status: "past_due", livemode: true, customer: "cus_2", current_period_end: PERIOD_END }, { id: "sub_active", status: "active", livemode: true, customer: "cus_2" }]
          : [{ id: "sub_unpaid", status: "unpaid", livemode: true, customer: "cus_2", current_period_end: PERIOD_END }],
      }),
    },
  };
  const read = await readStripeRisk(gateway, WINDOW);
  expect(update).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(read.ok).toBe(true);
  if (!read.ok) return;
  expect(read.disputes.map((row) => row.id)).toEqual(["dp_1"]);
  expect(read.disputes[0]?.dueBy).toBe(DUE_SOON);
  expect(read.failures.map((row) => [row.id, row.declineCode])).toEqual([
    ["ch_fail", "insufficient_funds"],
    ["pi_fail", "insufficient_funds"],
  ]);
  expect(read.subscriptions.map((row) => [row.id, row.status])).toEqual([
    ["sub_1", "past_due"],
    ["sub_unpaid", "unpaid"],
  ]);
  expect(seen).toEqual(["disputes", "charges"]);
  const stripe = createReadOnlyStripe("live", { cache: true });
  expect(() => stripe.disputes.update("dp_1", {})).toThrow("Stripe reader refuses disputes.update");
  expect(() => stripe.charges.create({ amount: 1 })).toThrow("Stripe reader refuses charges.create");
  expect(() => stripe.paymentIntents.confirm("pi_1")).toThrow("Stripe reader refuses paymentIntents.confirm");
  expect(stripeMock.update).not.toHaveBeenCalled();
  expect(stripeMock.create).not.toHaveBeenCalled();
  expect(stripeMock.confirm).not.toHaveBeenCalled();
});

it("withholds rows when driver records are incomplete", async () => {
  const result = await runStripeRiskMonitor({
    enabled: true,
    userId: "manager",
    tier: "manager",
    now: NOW,
    load: async () => ({ ok: false, capped: true }),
    readStripe: async () => ({
      ok: true,
      disputes: [{ id: "dp_1", status: "needs_response", dueBy: DUE_SOON, created: DUE_SOON, customerId: "cus_1", paymentIntentId: null }],
      failures: [],
      subscriptions: [],
    }),
  });
  expect(result.report.rows).toEqual([]);
  expect(result.report.directory).toBe("unavailable");
  expect(result.report.stripeCheck).toBe("ready");
  expect(DIRECTORY_INCOMPLETE).toBe("Driver records were incomplete");
});

it("keeps the monitor out of the dark nav and behind the throw", () => {
  const flag = readFileSync("src/lib/stripe-risk-monitor-flag.ts", "utf8");
  const fn = readFileSync("src/lib/stripe-risk-monitor.functions.ts", "utf8");
  const server = readFileSync("src/lib/stripe-risk-monitor.server.ts", "utf8");
  const reader = readFileSync("src/lib/stripe-risk-monitor-read.server.ts", "utf8");
  const pure = readFileSync("src/lib/stripe-risk-monitor.ts", "utf8");
  const panel = readFileSync("src/components/admin/StripeRiskMonitorPanel.tsx", "utf8");
  const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
  const admin = readFileSync("src/routes/admin.tsx", "utf8");
  const tabs = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
  const disabled = fn.indexOf("if (!STRIPE_RISK_MONITOR_ENABLED) throw new Error(STRIPE_RISK_MONITOR_OFF);");
  const manager = fn.indexOf("await requireManager(context.userId)");
  expect(flag).toContain("export const STRIPE_RISK_MONITOR_ENABLED = false");
  expect(disabled).toBeGreaterThan(-1);
  expect(manager).toBeGreaterThan(disabled);
  expect(fn.indexOf("loadRiskDirectory(")).toBeGreaterThan(manager);
  expect(fn.indexOf("readLiveStripeRisk(")).toBeGreaterThan(manager);
  expect(fn.indexOf('import("./stripe-risk-monitor-read.server")')).toBeGreaterThan(manager);
  expect(fn.indexOf('import("@/integrations/supabase/client.server")')).toBeGreaterThan(manager);
  expect(tabs).not.toMatch(/id: "stripe_risk_monitor"/);
  expect(TABS.some((tab) => tab.id === "stripe_risk_monitor")).toBe(false);
  for (const tier of ["owner", "manager", "coordinator"] as const) {
    expect(visibleTabs(tier).some((tab) => tab.id === "stripe_risk_monitor")).toBe(false);
    expect(railEntries(tier).some((entry) => entry.id === "stripe_risk_monitor")).toBe(false);
  }
  expect(admin.indexOf('urlTab === "stripe_risk_monitor"')).toBeGreaterThan(-1);
  expect(admin.indexOf('urlTab === "stripe_risk_monitor"')).toBeLessThan(admin.indexOf("TABS.some"));
  expect(admin).toContain('STRIPE_RISK_MONITOR_ENABLED && tab === "stripe_risk_monitor"');
  expect(panel).toContain("STRIPE_CHECK_UNAVAILABLE");
  expect(panel).toContain("Download CSV");
  expect(pure).toContain('export const STRIPE_CHECK_UNAVAILABLE = "Stripe check unavailable"');
  expect(reader).toContain('createReadOnlyStripe("live", { cache: true })');
  expect(reader).not.toContain("createStripeClient");
  expect(server).not.toContain("createReadOnlyStripe");
  for (const source of [flag, fn, server, reader, pure, panel]) {
    expect(source).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(source).not.toMatch(/\.(or|filter)\(\s*`[^`]*\$\{/);
    expect(source).not.toContain("createStripeClient");
    expect(source).not.toMatch(/disputes\s*\.\s*update\s*\(/);
    expect(source).not.toMatch(/charges\s*\.\s*create\s*\(/);
    expect(source).not.toMatch(/paymentIntents\s*\.\s*confirm\s*\(/);
  }
  const report: RiskReport = { rows: [], stripeCheck: "unavailable", directory: "skipped", gte: WINDOW.gte, lt: WINDOW.lt };
  expect(report.stripeCheck).toBe("unavailable");
});
