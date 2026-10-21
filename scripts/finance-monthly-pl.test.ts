import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { MONTHLY_PL_OFF } from "../src/lib/finance-monthly-pl-flag";
import {
  MONTHLY_PL_INCOMPLETE,
  MONTHLY_PL_MONTH,
  STANDING_GAPS,
  buildMonthlyPl,
  monthlyPlToCsv,
  profitabilityCollectedCents,
  type PlExpense,
  type PlMaintenance,
  type PlPayment,
  type PlRental,
  type PlVehicle,
} from "../src/lib/finance-monthly-pl";
import { loadMonthlyPlDirectory, runMonthlyPl, type MonthlyPlClient } from "../src/lib/finance-monthly-pl.server";

const AS_OF = new Date("2026-10-21T16:00:00Z");

it("splits rent, late fees, and other, and keeps income minus refunds equal to collected revenue", () => {
  const built = buildMonthlyPl({
    month: "2026-10",
    vehicles: [vehicle()],
    rentals: [rental()],
    payments: [
      payment({ amount: 500, netCollected: 450, refundedAmount: 50, paidDate: "2026-10-21" }),
      payment({ id: "late", type: "late_fee", amount: 25, netCollected: 25, refundedAmount: 0, paidDate: "2026-10-02" }),
      payment({ id: "toll", type: "toll", amount: 15, netCollected: 15, refundedAmount: 0, paidDate: "2026-10-03" }),
      payment({ id: "deposit", type: "deposit", amount: 300, netCollected: 300, refundedAmount: 0, paidDate: "2026-10-01" }),
      payment({ id: "next", amount: 80, netCollected: 80, paidDate: "2026-11-01" }),
    ],
    expenses: [expense({ amount: 40, category: "repair", incurredOn: "2026-10-04" })],
    maintenance: [maintenance({ companyShare: 10, totalCost: 99, category: "oil_change", performedOn: "2026-10-05" })],
  });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.report.income).toEqual([
    { label: "Rent", cents: 50000 },
    { label: "Late Fees", cents: 2500 },
    { label: "Other", cents: 1500 },
  ]);
  expect(built.report.refundCents).toBe(5000);
  expect(built.report.fees).toBe("unavailable");
  expect(built.report.expenses).toEqual([{ label: "Repair", cents: 4000 }]);
  expect(built.report.maintenance).toEqual([{ label: "Oil Change", cents: 1000 }]);
  expect(built.report.expenseCents).toBe(4000);
  expect(built.report.maintenanceCents).toBe(1000);
  expect(built.report.depositsExcludedCents).toBe(30000);
  const collected = 45000 + 2500 + 1500;
  expect(50000 + 2500 + 1500 - 5000).toBe(collected);
  expect(built.report.netCents).toBe(collected - 4000 - 1000);
  expect(built.report.vehicles[0]).toMatchObject({
    label: "2020 Toyota Camry · ABC123",
    rentCents: 50000,
    lateFeeCents: 2500,
    otherCents: 1500,
    refundCents: 5000,
    expenseCents: 4000,
    maintenanceCents: 1000,
    netCents: built.report.netCents,
  });
  expect(profitabilityCollectedCents(payment({ amount: 500, netCollected: 450, refundedAmount: 50 }))).toBe(45000);
  expect(built.report.standingGaps).toEqual(STANDING_GAPS);
  const csv = monthlyPlToCsv(built.report);
  expect(csv).toContain("Unavailable");
  expect(csv).toContain("2026-10-01");
  expect(csv).toContain("2026-10-31");
  expect(csv).toContain("Stripe fees are Unavailable");
});

it("uses total cost when the maintenance share is blank and skips a linked service", () => {
  const built = buildMonthlyPl({
    month: "2026-10",
    vehicles: [vehicle()],
    rentals: [],
    payments: [],
    expenses: [expense({ amount: 30, maintenanceRecordId: "m1", incurredOn: "2026-10-08" })],
    maintenance: [
      maintenance({ id: "m1", companyShare: null, totalCost: 80, performedOn: "2026-10-08" }),
      maintenance({ id: "m2", companyShare: "", totalCost: 12, category: "brakes", performedOn: "2026-10-09" }),
    ],
  });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.report.expenseCents).toBe(3000);
  expect(built.report.maintenanceCents).toBe(1200);
  expect(built.report.maintenance.map((line) => line.label)).toEqual(["Brake Service"]);
  expect(built.report.netCents).toBe(-4200);
});

it("keeps a calendar date and converts a timestamp into Eastern Time", () => {
  const stored = buildMonthlyPl({
    month: "2026-10",
    vehicles: [vehicle()],
    rentals: [rental()],
    payments: [payment({ paidDate: "2026-10-01", amount: 10, netCollected: 10 })],
    expenses: [],
    maintenance: [],
  });
  expect(stored.ok && stored.report.income[0].cents).toBe(1000);

  const evening = buildMonthlyPl({
    month: "2026-10",
    vehicles: [vehicle()],
    rentals: [rental()],
    payments: [payment({ paidDate: "2026-11-01T03:30:00Z", amount: 10, netCollected: 10 })],
    expenses: [],
    maintenance: [],
  });
  expect(evening.ok && evening.report.income[0].cents).toBe(1000);

  const november = buildMonthlyPl({
    month: "2026-10",
    vehicles: [vehicle()],
    rentals: [rental()],
    payments: [payment({ paidDate: "2026-11-01T04:00:00Z", amount: 10, netCollected: 10 })],
    expenses: [],
    maintenance: [],
  });
  expect(november.ok && november.report.netCents).toBe(0);
});

it("lists a month with no activity as zero and still names the missing columns", () => {
  const built = buildMonthlyPl({
    month: "2026-10",
    vehicles: [vehicle()],
    rentals: [],
    payments: [payment({ status: "pending", amount: 90, paidDate: "2026-10-01" })],
    expenses: [],
    maintenance: [],
  });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.report.netCents).toBe(0);
  expect(built.report.fees).toBe("unavailable");
  expect(built.report.vehicles).toEqual([]);
  expect(built.report.standingGaps.join(" ")).toContain("Depreciation is not a vehicle column");
  expect(built.report.standingGaps.join(" ")).toContain("Stripe fees are Unavailable");
});

it("puts an unattributed payment on No Vehicle and omits a type profitability does not count", () => {
  const built = buildMonthlyPl({
    month: "2026-10",
    vehicles: [vehicle()],
    rentals: [],
    payments: [
      payment({ rentalId: null, vehicleId: null, amount: 20, netCollected: 20, paidDate: "2026-10-06" }),
      payment({ id: "tip", type: "tip", amount: 5, netCollected: 5, paidDate: "2026-10-06" }),
    ],
    expenses: [],
    maintenance: [],
  });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.report.vehicles.map((row) => row.label)).toEqual(["No Vehicle"]);
  expect(built.report.income[0].cents).toBe(2000);
  expect(built.report.gaps.join(" ")).toContain("Omitted payment types: Tip");
});

it("withholds unreadable money", () => {
  expect(buildMonthlyPl({
    month: "2026-10",
    vehicles: [vehicle()],
    rentals: [rental()],
    payments: [payment({ amount: -5, netCollected: null, paidDate: "2026-10-01" })],
    expenses: [],
    maintenance: [],
  }).ok).toBe(false);
});

it("escapes a spreadsheet formula in the CSV", () => {
  const built = buildMonthlyPl({
    month: "2026-10",
    vehicles: [vehicle({ year: null, make: "=Ada", model: null, licensePlate: null })],
    rentals: [rental()],
    payments: [payment()],
    expenses: [],
    maintenance: [],
  });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(monthlyPlToCsv(built.report)).toContain(`"'=Ada"`);
});

it("loads a month from the directory and attributes the rental vehicle", async () => {
  const loaded = await loadMonthlyPlDirectory(client({
    vehicles: [{ id: "v1", year: 2020, make: "Toyota", model: "Camry", license_plate: "ABC123" }],
    rentals: [{ id: "r1", vehicle_id: "v1" }],
    payments: [{
      id: "p1", status: "paid", type: "rent", amount: 100, net_collected: 100, refunded_amount: 0,
      paid_date: "2026-10-11", rental_id: "r1", vehicle_id: null,
    }],
    vehicle_expenses: [],
    maintenance_records: [],
  }));
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const built = buildMonthlyPl({ month: "2026-10", ...loaded });
  expect(built.ok && built.report.vehicles[0]).toMatchObject({ label: "2020 Toyota Camry · ABC123", rentCents: 10000, netCents: 10000 });
});

it("throws while the flag is off, refuses a coordinator, and does not read for a bad month", async () => {
  const load = vi.fn(async () => ({ ok: true as const, vehicles: [], rentals: [], payments: [], expenses: [], maintenance: [] }));
  await expect(runMonthlyPl({ enabled: false, userId: "owner-1", tier: "owner", month: "2026-10", asOf: AS_OF, load })).rejects.toThrow(MONTHLY_PL_OFF);
  expect(load).not.toHaveBeenCalled();
  const blocked = vi.fn(load);
  await expect(runMonthlyPl({ enabled: true, userId: "coord-1", tier: "coordinator", month: "2026-10", asOf: AS_OF, load: blocked })).rejects.toThrow("Forbidden");
  expect(blocked).not.toHaveBeenCalled();
  const badMonth = vi.fn(load);
  const refused = await runMonthlyPl({ enabled: true, userId: "manager-1", tier: "manager", month: "2026-13", asOf: AS_OF, load: badMonth });
  expect(refused).toEqual({ status: "unavailable", reason: MONTHLY_PL_MONTH, report: null });
  expect(badMonth).not.toHaveBeenCalled();
  const ready = await runMonthlyPl({ enabled: true, userId: "owner-1", tier: "owner", month: null, asOf: AS_OF, load });
  expect(ready.status === "ready" && ready.report.month).toBe("2026-10");
});

it("withholds the report when a read is capped, fails, or money cannot be read", async () => {
  let pages = 0;
  const capped: MonthlyPlClient = {
    from() {
      return {
        select() {
          let after = "";
          const query = {
            order() { return query; },
            limit() { return query; },
            gt(_column: string, value: string) { after = value; return query; },
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
  const cappedResult = await runMonthlyPl({
    enabled: true, userId: "manager-1", tier: "manager", month: "2026-10", asOf: AS_OF,
    load: () => loadMonthlyPlDirectory(capped),
  });
  expect(pages).toBe(100);
  expect(cappedResult).toEqual({ status: "unavailable", reason: MONTHLY_PL_INCOMPLETE, report: null });

  const failed = await runMonthlyPl({
    enabled: true, userId: "manager-1", tier: "manager", month: "2026-10", asOf: AS_OF,
    load: () => loadMonthlyPlDirectory(client({ vehicles: [rawVehicle()] }, ["payments"])),
  });
  expect(failed).toEqual({ status: "unavailable", reason: MONTHLY_PL_INCOMPLETE, report: null });

  const unread = await loadMonthlyPlDirectory(client({
    vehicles: [rawVehicle()],
    payments: [rawPayment({ amount: "nope" })],
  }));
  expect(unread).toEqual({ ok: false });
});

it("keeps the flag off, the tab out of the rail, and the throw ahead of the role check", () => {
  const flag = readFileSync("src/lib/finance-monthly-pl-flag.ts", "utf8");
  const fn = readFileSync("src/lib/finance-monthly-pl.functions.ts", "utf8");
  const server = readFileSync("src/lib/finance-monthly-pl.server.ts", "utf8");
  const pure = readFileSync("src/lib/finance-monthly-pl.ts", "utf8");
  const panel = readFileSync("src/components/admin/FinanceMonthlyPlPanel.tsx", "utf8");
  const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
  const admin = readFileSync("src/routes/admin.tsx", "utf8");
  const tabs = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
  const handler = fn.slice(fn.indexOf("export const getFinanceMonthlyPl"));
  const thrown = handler.indexOf("throw new Error(MONTHLY_PL_OFF)");
  const role = handler.indexOf("await requireManager(context.userId)");
  const load = handler.indexOf("loadMonthlyPlDirectory");
  expect(flag).toContain("export const FINANCE_MONTHLY_PL_ENABLED = false");
  expect(thrown).toBeGreaterThan(-1);
  expect(role).toBeGreaterThan(thrown);
  expect(load).toBeGreaterThan(role);
  expect(`${fn}\n${server}\n${pure}\n${panel}`).not.toContain("createStripeClient");
  expect(`${fn}\n${server}\n${pure}\n${panel}`).not.toContain("createReadOnlyStripe");
  expect(`${fn}\n${server}\n${pure}`).not.toMatch(/\.(insert|update|delete|upsert|or)\(/);
  expect(`${fn}\n${server}\n${pure}`).not.toMatch(/\.(or|filter)\(\s*`[^`]*\$\{/);
  expect(server).toContain("id,status,type,amount,net_collected,refunded_amount,paid_date,rental_id,vehicle_id");
  expect(server).not.toContain("late_fees");
  expect(pure).toContain("net collected when stored");
  expect(panel).not.toContain("finance-monthly-pl.server");
  expect(panel).toContain("Print");
  expect(panel).not.toContain("text-transform");
  expect(tabs).toMatch(/id: "deposits_ledger"/);
  expect(tabs).not.toMatch(/id: "finance_monthly_pl"/);
  expect(nav).toContain('!FINANCE_MONTHLY_PL_ENABLED || !tierAllows(tier, "manager")');
  expect(admin).toContain('urlTab === "finance_monthly_pl"');
  expect(admin).toContain('if (!FINANCE_MONTHLY_PL_ENABLED || (tier && !tierAllows(tier, "manager"))) return "overview"');
  expect(admin).toContain('FINANCE_MONTHLY_PL_ENABLED && tab === "finance_monthly_pl"');
  const overviewAt = admin.indexOf('if (!urlTab || !TABS.some((t) => t.id === urlTab)) return "overview"');
  expect(admin.indexOf('urlTab === "finance_monthly_pl"')).toBeLessThan(overviewAt);
});

type Row = Record<string, unknown>;

function vehicle(over: Partial<PlVehicle> = {}): PlVehicle {
  return { id: "v1", year: 2020, make: "Toyota", model: "Camry", licensePlate: "ABC123", ...over };
}

function rental(over: Partial<PlRental> = {}): PlRental {
  return { id: "r1", vehicleId: "v1", ...over };
}

function payment(over: Partial<PlPayment> = {}): PlPayment {
  return {
    id: "p1", rentalId: "r1", vehicleId: null, status: "paid", type: "rent",
    amount: 100, netCollected: 100, refundedAmount: 0, paidDate: "2026-10-15",
    ...over,
  };
}

function expense(over: Partial<PlExpense> = {}): PlExpense {
  return { id: "e1", vehicleId: "v1", amount: 10, category: "other", incurredOn: "2026-10-10", maintenanceRecordId: null, ...over };
}

function maintenance(over: Partial<PlMaintenance> = {}): PlMaintenance {
  return {
    id: "m1", vehicleId: "v1", category: "oil_change", companyShare: 10, totalCost: 10,
    performedOn: "2026-10-10", completedAt: null, createdAt: null, ...over,
  };
}

function rawVehicle(over: Row = {}): Row {
  return { id: "v1", year: 2020, make: "Toyota", model: "Camry", license_plate: "ABC123", ...over };
}

function rawPayment(over: Row = {}): Row {
  return {
    id: "p1", status: "paid", type: "rent", amount: 100, net_collected: 100, refunded_amount: 0,
    paid_date: "2026-10-11", rental_id: "r1", vehicle_id: null, ...over,
  };
}

function client(tables: Record<string, Row[]>, fail: string[] = []): MonthlyPlClient {
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
