import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { RENT_AGING_OFF } from "../src/lib/rent-aging-flag";
import {
  AGING_BUCKETS,
  RENT_AGING_INCOMPLETE,
  buildRentAging,
  etYmd,
  rentAgingToCsv,
  type AgingCharge,
  type AgingName,
} from "../src/lib/rent-aging";
import { loadRentAgingDirectory, runRentAging, type RentAgingClient } from "../src/lib/rent-aging.server";

const EVENING = new Date("2026-10-21T03:30:00Z");
const MIDNIGHT = new Date("2026-10-21T04:00:00Z");

function charge(over: Partial<AgingCharge> = {}): AgingCharge {
  return {
    id: "p1", rentalId: "r1", driverId: "app-1", type: "rent", status: "pending",
    balanceDue: 100, amount: 100, dueDate: "2026-10-20", paidDate: null, ...over,
  };
}

function names(extra: Array<[string, AgingName]> = []): Map<string, AgingName> {
  return new Map<string, AgingName>([
    ["app-1", { applicationId: "app-1", renterName: "Ada Lovelace" }],
    ["app-2", { applicationId: "app-2", renterName: "Grace Hopper" }],
    ...extra,
  ]);
}

function bucketAmount(report: { totals: Array<{ id: string; amount: number; count: number }> }, id: string) {
  return report.totals.find((row) => row.id === id);
}

it("ages balances from the Eastern Time date, not UTC", () => {
  expect(etYmd(EVENING)).toBe("2026-10-20");
  expect(etYmd(MIDNIGHT)).toBe("2026-10-21");
  const dueToday = buildRentAging({ asOf: EVENING, charges: [charge({ dueDate: "2026-10-20" })], names: names() });
  const nextMorning = buildRentAging({ asOf: MIDNIGHT, charges: [charge({ dueDate: "2026-10-20" })], names: names() });
  expect(dueToday.ok && dueToday.report.rows[0]?.bucket).toBe("current");
  expect(nextMorning.ok && nextMorning.report.rows[0]?.bucket).toBe("d1_7");
});

it("buckets outstanding invoice and payment balances and keeps the edges", () => {
  const built = buildRentAging({
    asOf: EVENING,
    names: names(),
    charges: [
      charge({ id: "future", rentalId: "r-future", dueDate: "2026-10-21", balanceDue: 10 }),
      charge({ id: "today", rentalId: "r-today", dueDate: "2026-10-20", balanceDue: 20 }),
      charge({ id: "day1", rentalId: "r-1", dueDate: "2026-10-19", balanceDue: 1 }),
      charge({ id: "day7", rentalId: "r-7", dueDate: "2026-10-13", balanceDue: 7, amount: 350 }),
      charge({ id: "day8", rentalId: "r-8", dueDate: "2026-10-12", balanceDue: 8 }),
      charge({ id: "day14", rentalId: "r-14", dueDate: "2026-10-06", balanceDue: 14 }),
      charge({ id: "day15", rentalId: "r-15", dueDate: "2026-10-05", balanceDue: 15 }),
      charge({ id: "day30", rentalId: "r-30", dueDate: "2026-09-20", balanceDue: 30 }),
      charge({ id: "day31", rentalId: "r-31", dueDate: "2026-09-19", balanceDue: 31 }),
      charge({ id: "older", rentalId: "r-sum", dueDate: "2026-10-01", balanceDue: 20 }),
      charge({ id: "newer", rentalId: "r-sum", dueDate: "2026-10-19", balanceDue: 10 }),
      charge({ id: "paid", rentalId: "r-sum", status: "paid", balanceDue: 0, amount: 350, dueDate: "2026-09-01", paidDate: "2026-09-01" }),
      charge({ id: "paid-later", rentalId: "r-sum", status: "paid", balanceDue: 0, dueDate: "2026-10-02", paidDate: "2026-10-02" }),
      charge({ id: "deposit", rentalId: "r-7", type: "deposit", balanceDue: 500, dueDate: "2026-01-01" }),
      charge({ id: "voided", rentalId: "r-31", status: "void", balanceDue: 999, dueDate: "2026-01-01" }),
      charge({ id: "waived", rentalId: "r-31", status: "waived", balanceDue: 999, dueDate: "2026-01-01" }),
      charge({ id: "stale-paid", rentalId: "r-paid", status: "paid", balanceDue: 350, dueDate: "2026-01-01", paidDate: "2026-01-02" }),
      charge({ id: "zero", rentalId: "r-zero", status: "overdue", balanceDue: 0, dueDate: "2026-01-01" }),
      charge({ id: "blank-balance", rentalId: "r-blank", balanceDue: null, amount: 40, dueDate: "2026-10-19" }),
      charge({ id: "no-rental", rentalId: null, driverId: "app-2", balanceDue: 5, dueDate: "2026-09-19" }),
      charge({ id: "invoice", rentalId: "r-invoice", status: "pending", balanceDue: 25, dueDate: "2026-10-20" }),
    ],
  });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  const report = built.report;
  expect(report.asOf).toBe("2026-10-20");
  const row = (id: string) => report.rows.find((item) => item.id === id);
  expect(row("rental:r-future")?.bucket).toBe("current");
  expect(row("rental:r-today")?.bucket).toBe("current");
  expect(row("rental:r-1")?.bucket).toBe("d1_7");
  expect(row("rental:r-7")).toMatchObject({ bucket: "d1_7", amountDue: 7 });
  expect(row("rental:r-8")?.bucket).toBe("d8_14");
  expect(row("rental:r-14")?.bucket).toBe("d8_14");
  expect(row("rental:r-15")?.bucket).toBe("d15_30");
  expect(row("rental:r-30")?.bucket).toBe("d15_30");
  expect(row("rental:r-31")?.bucket).toBe("d30_plus");
  expect(row("rental:r-sum")).toMatchObject({
    bucket: "d15_30", amountDue: 30, oldestUnpaid: "2026-10-01", lastPayment: "2026-10-02",
    renterName: "Ada Lovelace", renterHref: "/admin?tab=drivers&id=app-1", rentalHref: "/admin?tab=bookings&id=r-sum",
  });
  expect(row("rental:r-blank")).toMatchObject({ amountDue: 40, bucket: "d1_7" });
  expect(row("rental:r-paid")).toBeUndefined();
  expect(row("rental:r-zero")).toBeUndefined();
  expect(row("driver:app-2")).toMatchObject({ bucket: "d30_plus", rentalLabel: "No Rental", rentalHref: null, renterName: "Grace Hopper" });
  expect(row("rental:r-invoice")).toMatchObject({ bucket: "current", amountDue: 25 });
  expect(bucketAmount(report, "current")).toMatchObject({ count: 3, amount: 55 });
  expect(bucketAmount(report, "d1_7")).toMatchObject({ count: 3, amount: 48 });
  expect(bucketAmount(report, "d8_14")).toMatchObject({ count: 2, amount: 22 });
  expect(bucketAmount(report, "d15_30")).toMatchObject({ count: 3, amount: 75 });
  expect(bucketAmount(report, "d30_plus")).toMatchObject({ count: 2, amount: 36 });
  expect(report.totalAmount).toBe(236);
  const csv = rentAgingToCsv(report);
  expect(csv).toContain("1–7 Days,3,$48.00");
  expect(csv).toContain("30+ Days,2,$36.00");
  expect(csv).toContain("/admin?tab=bookings&id=r-sum");
  expect(csv).toContain("2026-10-01");
  expect(csv).toContain("2026-10-02");
});

it("reports zero when every balance is settled", () => {
  const built = buildRentAging({
    asOf: EVENING,
    names: names(),
    charges: [
      charge({ status: "paid", balanceDue: 0, paidDate: "2026-10-01", dueDate: "2026-10-01" }),
      charge({ id: "refunded", rentalId: "r2", status: "refunded", balanceDue: 0, paidDate: "2026-09-15", dueDate: "2026-09-01" }),
      charge({ id: "deposit", type: "deposit", status: "pending", balanceDue: 200, dueDate: "2026-01-01" }),
    ],
  });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.report.rows).toEqual([]);
  expect(built.report.totals.map((row) => row.amount)).toEqual(AGING_BUCKETS.map(() => 0));
  expect(built.report.totalAmount).toBe(0);
  const csv = rentAgingToCsv(built.report);
  for (const bucket of AGING_BUCKETS) expect(csv).toContain(`${bucket.label},0,$0.00`);
});

it("withholds an outstanding row that has no due date or a negative balance", () => {
  expect(buildRentAging({ asOf: EVENING, names: names(), charges: [charge({ dueDate: null })] }).ok).toBe(false);
  expect(buildRentAging({ asOf: EVENING, names: names(), charges: [charge({ dueDate: "not-a-date" })] }).ok).toBe(false);
  expect(buildRentAging({ asOf: EVENING, names: names(), charges: [charge({ balanceDue: -5 })] }).ok).toBe(false);
});

it("resolves the renter from the rental when the payment has no driver", async () => {
  const loaded = await loadRentAgingDirectory(client({
    payments: [{
      id: "p-invoice", status: "pending", type: "rent", amount: 80, balance_due: 80,
      due_date: "2026-10-13", paid_date: null, driver_id: null, rental_id: "r-linked", stripe_invoice_id: "in_1",
    }],
    rentals: [{ id: "r-linked", application_id: "app-1", driver_id: "user-1" }],
    applications: [{ id: "app-1", full_name: "Ada Lovelace", user_id: "user-1" }],
  }));
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const built = buildRentAging({ asOf: EVENING, charges: loaded.charges, names: loaded.names });
  expect(built.ok && built.report.rows[0]).toMatchObject({
    renterName: "Ada Lovelace", rentalHref: "/admin?tab=bookings&id=r-linked", bucket: "d1_7", amountDue: 80,
  });
});

it("throws while the flag is off and refuses a coordinator before the load", async () => {
  const load = vi.fn(async () => ({ ok: true as const, charges: [], names: new Map() }));
  await expect(runRentAging({ enabled: false, userId: "owner-1", tier: "owner", asOf: EVENING, load })).rejects.toThrow(RENT_AGING_OFF);
  expect(load).not.toHaveBeenCalled();
  const blocked = vi.fn(load);
  await expect(runRentAging({ enabled: true, userId: "coord-1", tier: "coordinator", asOf: EVENING, load: blocked })).rejects.toThrow("Forbidden");
  expect(blocked).not.toHaveBeenCalled();
  const owner = await runRentAging({ enabled: true, userId: "owner-1", tier: "owner", asOf: EVENING, load });
  expect(owner.status).toBe("ready");
});

it("withholds the report when a read is capped, fails, or a balance cannot be read", async () => {
  let pages = 0;
  const capped: RentAgingClient = {
    from() {
      return {
        select() {
          let after = "";
          const query = {
            order() { return query; },
            limit() { return query; },
            gt(_column: string, value: string) { after = value; return query; },
            in() { return query; },
            then(resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown) {
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
  const cappedResult = await runRentAging({
    enabled: true, userId: "manager-1", tier: "manager", asOf: EVENING,
    load: () => loadRentAgingDirectory(capped),
  });
  expect(pages).toBe(100);
  expect(cappedResult).toEqual({ status: "unavailable", reason: RENT_AGING_INCOMPLETE, report: null });

  const failed = await runRentAging({
    enabled: true, userId: "manager-1", tier: "manager", asOf: EVENING,
    load: () => loadRentAgingDirectory(client({ payments: [rawPayment()] }, ["payments"])),
  });
  expect(failed).toEqual({ status: "unavailable", reason: RENT_AGING_INCOMPLETE, report: null });

  const unread = await loadRentAgingDirectory(client({
    payments: [rawPayment({ balance_due: "nope" })],
  }));
  expect(unread).toEqual({ ok: false });
});

it("escapes a spreadsheet formula in the CSV", () => {
  const built = buildRentAging({
    asOf: EVENING,
    names: names([["app-1", { applicationId: "app-1", renterName: "=Ada" }]]),
    charges: [charge()],
  });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(rentAgingToCsv(built.report)).toContain(`"'=Ada"`);
});

it("keeps the flag off, the tab out of the rail, and the throw ahead of the role check", () => {
  const flag = readFileSync("src/lib/rent-aging-flag.ts", "utf8");
  const fn = readFileSync("src/lib/rent-aging.functions.ts", "utf8");
  const server = readFileSync("src/lib/rent-aging.server.ts", "utf8");
  const pure = readFileSync("src/lib/rent-aging.ts", "utf8");
  const panel = readFileSync("src/components/admin/RentAgingPanel.tsx", "utf8");
  const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
  const admin = readFileSync("src/routes/admin.tsx", "utf8");
  const tabs = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
  const handler = fn.slice(fn.indexOf("export const getRentAging"));
  const thrown = handler.indexOf("throw new Error(RENT_AGING_OFF)");
  const role = handler.indexOf("await requireManager(context.userId)");
  const load = handler.indexOf("loadRentAgingDirectory");
  expect(flag).toContain("export const FINANCE_AR_AGING_ENABLED = false");
  expect(thrown).toBeGreaterThan(-1);
  expect(role).toBeGreaterThan(thrown);
  expect(load).toBeGreaterThan(role);
  expect(handler).not.toContain("createStripeClient");
  expect(handler).not.toContain("createReadOnlyStripe");
  expect(`${fn}\n${server}\n${pure}`).not.toMatch(/\.(insert|update|delete|upsert|or)\(/);
  expect(`${fn}\n${server}\n${pure}`).not.toMatch(/\.(or|filter)\(\s*`[^`]*\$\{/);
  expect(server).toContain("id,status,type,amount,balance_due,due_date,paid_date,driver_id,rental_id,stripe_invoice_id");
  expect(panel).not.toContain("rent-aging.server");
  expect(tabs).not.toMatch(/id: "rent_aging"/);
  expect(nav).toContain('!FINANCE_AR_AGING_ENABLED || !tierAllows(tier, "manager")');
  expect(admin).toContain('urlTab === "rent_aging"');
  expect(admin).toContain('if (!FINANCE_AR_AGING_ENABLED || (tier && !tierAllows(tier, "manager"))) return "overview"');
  expect(admin).toContain('FINANCE_AR_AGING_ENABLED && tab === "rent_aging"');
  const overviewAt = admin.indexOf('if (!urlTab || !TABS.some((t) => t.id === urlTab)) return "overview"');
  expect(admin.indexOf('urlTab === "rent_aging"')).toBeLessThan(overviewAt);
});

type Row = Record<string, unknown>;

function rawPayment(over: Row = {}): Row {
  return {
    id: "p1", status: "pending", type: "rent", amount: 100, balance_due: 100,
    due_date: "2026-10-20", paid_date: null, driver_id: "app-1", rental_id: "r1", stripe_invoice_id: null,
    ...over,
  };
}

function client(tables: Record<string, Row[]>, fail: string[] = []): RentAgingClient {
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
