import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { FINANCE_DATA_QUALITY_OFF } from "../src/lib/finance-data-quality-flag";
import { FINANCE_RECORDS_INCOMPLETE, QUALITY_CATEGORIES, buildFinanceDataQuality, financeDataQualityToCsv } from "../src/lib/finance-data-quality";
import { loadFinanceDataQualityDirectory, runFinanceDataQuality, type FinanceDataQualityClient } from "../src/lib/finance-data-quality.server";

type Row = Record<string, unknown>;

function client(tables: Record<string, Row[]>, fail: string[] = []): FinanceDataQualityClient {
  return {
    from(table: string) {
      return {
        select() {
          const filters: Array<(row: Row) => boolean> = [];
          let cap = Number.POSITIVE_INFINITY;
          const execute = async () => {
            if (fail.includes(table)) return { data: null, error: { message: "read failed" } };
            let rows = (tables[table] ?? []).filter((row) => filters.every((keep) => keep(row)));
            rows = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
            if (Number.isFinite(cap)) rows = rows.slice(0, cap);
            return { data: rows, error: null };
          };
          const query = {
            order() { return query; },
            limit(count: number) { cap = count; return query; },
            gt(column: string, value: string) { filters.push((row) => String(row[column]) > value); return query; },
            in(column: string, values: string[]) {
              const allowed = new Set(values);
              filters.push((row) => allowed.has(String(row[column] ?? "")));
              return query;
            },
            then(resolve: (value: { data: Row[] | null; error: { message: string } | null }) => unknown, reject?: (error: unknown) => unknown) {
              return execute().then(resolve, reject);
            },
          };
          return query;
        },
      };
    },
  };
}

function payment(over: Row = {}): Row {
  return {
    id: "p-clean", status: "paid", payment_method: "cash", paid_date: "2026-10-01",
    refunded_amount: 0, refunded_at: null, stripe_payment_intent_id: null, driver_id: "app-1", rental_id: "r-clean",
    ...over,
  };
}

function rental(over: Row = {}): Row {
  return {
    id: "r-clean", status: "active", weekly_rate: 300, vehicle_id: "v-1", driver_id: "user-1",
    application_id: "app-1", deposit_held: false, deposit_amount: null,
    ...over,
  };
}

const directory = {
  applications: [{ id: "app-1", user_id: "user-1" }],
  vehicles: [{ id: "v-1", unit_number: "12", year: 2020, make: "Honda", model: "Civic" }],
};

function count(report: { counts: Array<{ id: string; count: number }> }, id: string) {
  return report.counts.find((row) => row.id === id)?.count;
}

it("flags each finance data problem and leaves sound rows out", async () => {
  const tables = {
    ...directory,
    payments: [
      payment({ id: "p-blank", payment_method: null }),
      payment({ id: "p-paypal", payment_method: "paypal" }),
      payment({ id: "p-credit", payment_method: " credit " }),
      payment({ id: "p-debit", payment_method: "Debit" }),
      payment({ id: "p-card", payment_method: "card", stripe_payment_intent_id: null }),
      payment({ id: "p-card-ok", payment_method: "card", stripe_payment_intent_id: "pi_only" }),
      payment({ id: "p-no-date", paid_date: "  " }),
      payment({ id: "p-refund-both", status: "refunded", payment_method: "zelle", refunded_at: null, refunded_amount: null }),
      payment({ id: "p-refund-date", status: "refunded", payment_method: "zelle", refunded_at: null, refunded_amount: 20 }),
      payment({ id: "p-refund-amount", status: "refunded", payment_method: "zelle", refunded_at: "2026-10-02", refunded_amount: "" }),
      payment({ id: "p-refund-zero", status: "refunded", payment_method: "zelle", refunded_at: "2026-10-02", refunded_amount: 0 }),
      payment({ id: "p-dup-a", stripe_payment_intent_id: "pi_dup" }),
      payment({ id: "p-dup-b", stripe_payment_intent_id: " pi_dup " }),
      payment({ id: "p-clean", payment_method: " Cash " }),
    ],
    rentals: [
      rental({ id: "r-rate", weekly_rate: 0 }),
      rental({ id: "r-vehicle", vehicle_id: "v-missing" }),
      rental({ id: "r-driver", application_id: null, driver_id: "user-missing" }),
      rental({ id: "r-user", application_id: null, driver_id: "user-1" }),
      rental({ id: "r-held", status: "ended", deposit_held: true, deposit_amount: null }),
      rental({ id: "r-held-zero", status: "ended", deposit_held: true, deposit_amount: 0 }),
      rental({ id: "r-ended", status: "ended", weekly_rate: null, vehicle_id: "", driver_id: "", application_id: null }),
      rental({ id: "r-clean", weekly_rate: "350", deposit_held: true, deposit_amount: "400" }),
    ],
    payment_refunds: [
      { id: "rf-missing", payment_ids: ["p-gone"] },
      { id: "rf-empty", payment_ids: [] },
      { id: "rf-partial", payment_ids: ["p-clean", "p-also-gone"] },
      { id: "rf-ok", payment_ids: ["p-clean"] },
    ],
  };
  const loaded = await loadFinanceDataQualityDirectory(client(tables));
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const report = buildFinanceDataQuality(loaded);
  expect(count(report, "method")).toBe(4);
  expect(count(report, "paid_date")).toBe(1);
  expect(count(report, "refund_fields")).toBe(3);
  expect(count(report, "stripe_intent")).toBe(3);
  expect(count(report, "duplicate_intent")).toBe(2);
  expect(count(report, "active_rental")).toBe(3);
  expect(count(report, "held_deposit")).toBe(1);
  expect(count(report, "orphan_refund")).toBe(3);
  expect(report.issues.map((row) => row.problem)).toEqual(expect.arrayContaining([
    "This payment has no method.",
    'This payment method "paypal" is not a known method.',
    "This paid payment has no paid date.",
    "This refunded payment has no refund date and no refund amount.",
    "This refunded payment has no refund date.",
    "This refunded payment has no refund amount.",
    "This card, credit, or debit payment has no Stripe payment id.",
    "Stripe payment pi_dup is on more than one payment.",
    "This active rental has no weekly rate.",
    "This active rental has no vehicle.",
    "This active rental has no driver.",
    "This deposit is marked held and the amount is blank.",
    "This refund points at p-gone, which is not in Payments.",
    "This refund does not point at a payment.",
  ]));
  const blank = report.issues.find((row) => row.id === "method:p-blank:blank");
  expect(blank).toMatchObject({ recordLabel: "Payment p-blank", recordHref: "/admin?tab=drivers&id=app-1", suggestedFix: expect.stringContaining("known method") });
  const rate = report.issues.find((row) => row.id === "active_rental:r-rate:rate");
  expect(rate).toMatchObject({ recordLabel: "Unit 12 · 2020 Honda Civic", recordHref: "/admin?tab=bookings&id=r-rate" });
  const refund = report.issues.find((row) => row.id === "orphan_refund:rf-missing:missing");
  expect(refund).toMatchObject({ recordLabel: "Refund rf-missing", recordHref: "/admin?tab=payments" });
  const ids = report.issues.map((row) => row.id).join(" ");
  for (const sound of ["p-card-ok", "p-refund-zero", "p-clean", "r-user", "r-held-zero", "r-ended", "r-clean", "rf-ok"]) {
    expect(ids).not.toContain(sound);
  }
  const csv = financeDataQualityToCsv(report);
  expect(csv).toContain("Payment Method,4");
  expect(csv).toContain("Refund Without Payment,3");
  expect(csv).toContain("/admin?tab=bookings&id=r-rate");
  expect(csv).toContain("Enter a weekly rate greater than zero.");
});

it("reports zero issues for a clean dataset", async () => {
  const tables = {
    ...directory,
    payments: [
      payment(),
      payment({ id: "p-card", payment_method: "card", stripe_payment_intent_id: "pi_card", driver_id: null, rental_id: "r-clean" }),
      payment({ id: "p-refunded", status: "refunded", payment_method: "zelle", paid_date: "2026-10-03", refunded_at: "2026-10-04", refunded_amount: 15 }),
    ],
    rentals: [rental({ deposit_held: true, deposit_amount: 500 })],
    payment_refunds: [{ id: "rf-ok", payment_ids: ["p-clean"] }],
  };
  const result = await runFinanceDataQuality({
    enabled: true,
    userId: "manager-1",
    tier: "manager",
    load: () => loadFinanceDataQualityDirectory(client(tables)),
  });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") return;
  expect(result.report.issues).toEqual([]);
  expect(result.report.counts.map((row) => row.count)).toEqual(QUALITY_CATEGORIES.map(() => 0));
  const csv = financeDataQualityToCsv(result.report);
  for (const category of QUALITY_CATEGORIES) expect(csv).toContain(`${category.label},0`);
  expect(csv).not.toContain("This payment");
});

it("lets an owner read and refuses a coordinator before the load", async () => {
  const load = vi.fn(async () => ({ ok: true as const, payments: [], rentals: [], refunds: [] }));
  const owner = await runFinanceDataQuality({ enabled: true, userId: "owner-1", tier: "owner", load });
  expect(owner.status).toBe("ready");
  expect(load).toHaveBeenCalledTimes(1);
  const blocked = vi.fn(load);
  await expect(runFinanceDataQuality({ enabled: true, userId: "coord-1", tier: "coordinator", load: blocked })).rejects.toThrow("Forbidden");
  expect(blocked).not.toHaveBeenCalled();
});

it("throws while the flag is off and does not read", async () => {
  const load = vi.fn(async () => ({ ok: true as const, payments: [], rentals: [], refunds: [] }));
  await expect(runFinanceDataQuality({ enabled: false, userId: "owner-1", tier: "owner", load })).rejects.toThrow(FINANCE_DATA_QUALITY_OFF);
  expect(load).not.toHaveBeenCalled();
});

it("withholds the report when a read is capped or fails", async () => {
  let pages = 0;
  const capped: FinanceDataQualityClient = {
    from() {
      return {
        select() {
          let after = "";
          const query = {
            order() { return query; },
            limit() { return query; },
            gt(_column: string, value: string) { after = value; return query; },
            in() { return query; },
            then(resolve: (value: { data: Row[]; error: null }) => unknown) {
              pages += 1;
              const start = after ? Number(after) + 1 : 1;
              const data = Array.from({ length: 1000 }, (_, index) => ({ id: String(start + index).padStart(7, "0") }));
              return Promise.resolve({ data, error: null }).then(resolve);
            },
          };
          return query;
        },
      };
    },
  };
  const cappedResult = await runFinanceDataQuality({
    enabled: true,
    userId: "manager-1",
    tier: "manager",
    load: () => loadFinanceDataQualityDirectory(capped),
  });
  expect(pages).toBe(100);
  expect(cappedResult).toEqual({ status: "unavailable", reason: FINANCE_RECORDS_INCOMPLETE, report: null });

  const failed = await runFinanceDataQuality({
    enabled: true,
    userId: "manager-1",
    tier: "manager",
    load: () => loadFinanceDataQualityDirectory(client({ payments: [payment()], payment_refunds: [] }, ["rentals"])),
  });
  expect(failed).toEqual({ status: "unavailable", reason: FINANCE_RECORDS_INCOMPLETE, report: null });
});

it("escapes a spreadsheet formula in the CSV", () => {
  const report = buildFinanceDataQuality({
    payments: [],
    rentals: [{
      id: "r-formula", status: "active", weeklyRate: null, vehicleId: null, vehicleFound: false,
      driverFound: true, depositHeld: false, depositAmount: null, label: "=Unit",
    }],
    refunds: [],
  });
  expect(financeDataQualityToCsv(report)).toContain(`"'=Unit"`);
});

it("keeps the flag off, the tab out of the rail, and the throw ahead of the role check", () => {
  const flag = readFileSync("src/lib/finance-data-quality-flag.ts", "utf8");
  const fn = readFileSync("src/lib/finance-data-quality.functions.ts", "utf8");
  const server = readFileSync("src/lib/finance-data-quality.server.ts", "utf8");
  const pure = readFileSync("src/lib/finance-data-quality.ts", "utf8");
  const panel = readFileSync("src/components/admin/FinanceDataQualityPanel.tsx", "utf8");
  const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
  const admin = readFileSync("src/routes/admin.tsx", "utf8");
  const tabs = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
  const handler = fn.slice(fn.indexOf("export const getFinanceDataQuality"));
  const thrown = handler.indexOf("throw new Error(FINANCE_DATA_QUALITY_OFF)");
  const role = handler.indexOf("await requireManager(context.userId)");
  const load = handler.indexOf("loadFinanceDataQualityDirectory");
  expect(flag).toContain("export const FINANCE_DATA_QUALITY_ENABLED = false");
  expect(thrown).toBeGreaterThan(-1);
  expect(role).toBeGreaterThan(thrown);
  expect(load).toBeGreaterThan(role);
  expect(handler).not.toContain("createStripeClient");
  expect(handler).not.toContain("createReadOnlyStripe");
  expect(`${fn}\n${server}\n${pure}`).not.toMatch(/\.(insert|update|delete|upsert|or)\(/);
  expect(`${fn}\n${server}\n${pure}`).not.toMatch(/\.(or|filter)\(\s*`[^`]*\$\{/);
  expect(server).toContain("id,status,payment_method,paid_date,refunded_amount,refunded_at,stripe_payment_intent_id,driver_id,rental_id");
  expect(server).toContain("id,status,weekly_rate,vehicle_id,driver_id,application_id,deposit_held,deposit_amount");
  expect(server).toContain("id,payment_ids");
  expect(panel).not.toContain("finance-data-quality.server");
  expect(tabs).not.toMatch(/id: "finance_data_quality"/);
  expect(nav).toContain('!FINANCE_DATA_QUALITY_ENABLED || !tierAllows(tier, "manager")');
  expect(admin).toContain('urlTab === "finance_data_quality"');
  expect(admin).toContain('if (!FINANCE_DATA_QUALITY_ENABLED || (tier && !tierAllows(tier, "manager"))) return "overview"');
  expect(admin).toContain('FINANCE_DATA_QUALITY_ENABLED && tab === "finance_data_quality"');
  const overviewAt = admin.indexOf('if (!urlTab || !TABS.some((t) => t.id === urlTab)) return "overview"');
  expect(admin.indexOf('urlTab === "finance_data_quality"')).toBeLessThan(overviewAt);
});
