import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import {
  DEPOSIT_LEDGER_INCOMPLETE,
  STANDING_GAPS,
  buildDepositLedger,
  depositLedgerToCsv,
  type LedgerDeduction,
  type LedgerName,
  type LedgerPayment,
  type LedgerRental,
} from "../src/lib/finance-deposit-ledger";
import { DEPOSIT_LEDGER_OFF } from "../src/lib/finance-deposit-ledger-flag";
import {
  loadDepositLedgerDirectory,
  runDepositLedger,
  type DepositLedgerClient,
} from "../src/lib/finance-deposit-ledger.server";

it("shows collected amount, date, method, held, applied, refunded, and the balance still held", () => {
  const built = buildDepositLedger({
    rentals: [rental({
      depositHeld: true,
      depositStatus: "held",
      depositAmount: 500,
      depositRefundAmount: 75,
      depositSettledAt: "2026-10-21T03:30:00Z",
    })],
    payments: [payment({ amount: 500, netCollected: 425, paidDate: "2026-10-21", method: "cash", refundedAmount: 75, refundedAt: "2026-10-20" })],
    deductions: [deduction({ amount: 125 })],
    refunds: [],
    names: names(),
  });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.report.rows).toHaveLength(1);
  expect(built.report.rows[0]).toMatchObject({
    renterName: "Ada Lovelace",
    rentalLabel: "Rental",
    rentalHref: "/admin?tab=bookings&id=r1",
    collected: 50000,
    collectedDate: "2026-10-21",
    method: "Cash",
    held: "Yes · Held",
    applied: 12500,
    refunded: 7500,
    balance: 30000,
    settledDate: "2026-10-20",
    gaps: [],
  });
  expect(built.report.totals).toMatchObject({
    rentals: 1, collected: 50000, applied: 12500, refunded: 7500, balance: 30000, gapRows: 0,
  });
  expect(built.report.standingGaps).toEqual(STANDING_GAPS);
  const csv = depositLedgerToCsv(built.report);
  expect(csv).toContain("2026-10-21");
  expect(csv).toContain("2026-10-20");
  expect(csv).toContain("/admin?tab=bookings&id=r1");
  expect(csv).toContain("$500.00");
  expect(csv).toContain("$125.00");
  expect(csv).toContain("$75.00");
  expect(csv).toContain("$300.00");
  expect(csv).toContain("No column stores the balance still held");
});

it("keeps a stored calendar date and converts a timestamp to Eastern Time", () => {
  const stored = buildDepositLedger({
    rentals: [rental({ depositRefundAmount: 0 })],
    payments: [payment({ paidDate: "2026-10-21" })],
    deductions: [deduction()],
    refunds: [],
    names: names(),
  });
  expect(stored.ok && stored.report.rows[0].collectedDate).toBe("2026-10-21");

  const stamped = buildDepositLedger({
    rentals: [rental({ depositRefundAmount: 0, depositSettledAt: "2026-10-21T04:00:00Z" })],
    payments: [payment({ paidDate: "2026-10-21T03:30:00Z" })],
    deductions: [deduction()],
    refunds: [],
    names: names(),
  });
  expect(stamped.ok).toBe(true);
  if (!stamped.ok) return;
  expect(stamped.report.rows[0].collectedDate).toBe("2026-10-20");
  expect(stamped.report.rows[0].settledDate).toBe("2026-10-21");
  expect(stamped.report.rows[0].gaps.join(" ")).toContain("Eastern Time day");
});

it("uses zero for a fully applied deposit when the refund amount is stored as zero", () => {
  const built = buildDepositLedger({
    rentals: [rental({ depositHeld: false, depositStatus: "held", depositRefundAmount: 0 })],
    payments: [payment({ amount: 200, netCollected: 200, method: "cash_app" })],
    deductions: [deduction({ amount: 200 })],
    refunds: [],
    names: names(),
  });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.report.rows[0]).toMatchObject({
    collected: 20000,
    method: "Cash App",
    held: "No · Held",
    applied: 20000,
    refunded: 0,
    balance: 0,
    gaps: [],
  });
  expect(built.report.totals.balance).toBe(0);
});

it("lists a gap where collected, held, applied, or refunded is not stored", () => {
  const built = buildDepositLedger({
    rentals: [rental({ depositAmount: 400, depositHeld: null, depositStatus: "none" })],
    payments: [],
    deductions: [],
    refunds: [],
    names: names(),
  });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  const row = built.report.rows[0];
  expect(row.collected).toBeNull();
  expect(row.collectedDate).toBeNull();
  expect(row.method).toBeNull();
  expect(row.held).toBeNull();
  expect(row.applied).toBeNull();
  expect(row.refunded).toBe(0);
  expect(row.balance).toBeNull();
  const text = row.gaps.join(" ");
  expect(text).toContain("Collected amount is not recorded");
  expect(text).toContain("amount required, not cash collected");
  expect(text).toContain("Held is not recorded.");
  expect(text).toContain("No deduction row is not the same as zero.");
  expect(text).toContain("Refunded amount is not stored, so this row uses zero.");
  expect(built.report.totals.collected).toBeNull();
  expect(built.report.totals.applied).toBeNull();
  expect(built.report.totals.balance).toBeNull();
});

it("does not treat a missing deduction list as zero, including a forfeited deposit", () => {
  const forfeited = buildDepositLedger({
    rentals: [rental({ depositStatus: "forfeited", depositHeld: true, depositRefundAmount: 0 })],
    payments: [payment()],
    deductions: [],
    refunds: [],
    names: names(),
  });
  expect(forfeited.ok).toBe(true);
  if (!forfeited.ok) return;
  expect(forfeited.report.rows[0].applied).toBeNull();
  expect(forfeited.report.rows[0].balance).toBeNull();
  expect(forfeited.report.rows[0].gaps.join(" ")).toContain("Forfeited is recorded and no deduction rows say what was applied.");
});

it("shows the rental refund amount when the payment refund disagrees", () => {
  const built = buildDepositLedger({
    rentals: [rental({ depositRefundAmount: 25 })],
    payments: [payment({ refundedAmount: 10, refundedAt: "2026-10-02" })],
    deductions: [deduction({ amount: 50 })],
    refunds: [{ id: "rf1", amount: 10, paymentIds: ["p1"], status: "succeeded" }],
    names: names(),
  });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.report.rows[0].refunded).toBe(2500);
  expect(built.report.rows[0].gaps.join(" ")).toContain("does not match the deposit payment refunds");
});

it("leaves a negative derived balance blank and still returns the row", () => {
  const built = buildDepositLedger({
    rentals: [rental({ depositRefundAmount: 50 })],
    payments: [payment({ amount: 100 })],
    deductions: [deduction({ amount: 80 })],
    refunds: [],
    names: names(),
  });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.report.rows[0].balance).toBeNull();
  expect(built.report.rows[0].collected).toBe(10000);
  expect(built.report.rows[0].applied).toBe(8000);
  expect(built.report.rows[0].refunded).toBe(5000);
  expect(built.report.rows[0].gaps.join(" ")).toContain("below zero");
});

it("omits a rental with no deposit signal and a rent payment", () => {
  const built = buildDepositLedger({
    rentals: [rental({ id: "plain", depositHeld: false, depositStatus: "none" }), rental({ id: "signaled", depositAmount: 10 })],
    payments: [payment({ id: "rent", type: "rent", rentalId: "plain", status: "paid", amount: 90 })],
    deductions: [],
    refunds: [],
    names: names(),
  });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.report.rows.map((row) => row.id)).toEqual(["signaled"]);
});

it("withholds unreadable or negative money", () => {
  expect(buildDepositLedger({
    rentals: [rental()],
    payments: [payment({ amount: Number.NaN })],
    deductions: [deduction()],
    refunds: [],
    names: names(),
  }).ok).toBe(false);
  expect(buildDepositLedger({
    rentals: [rental({ depositRefundAmount: 0 })],
    payments: [payment({ amount: -5 })],
    deductions: [deduction()],
    refunds: [],
    names: names(),
  }).ok).toBe(false);
});

it("escapes a spreadsheet formula in the CSV", () => {
  const built = buildDepositLedger({
    rentals: [rental({ depositRefundAmount: 0 })],
    payments: [payment()],
    deductions: [deduction()],
    refunds: [],
    names: names([["app-1", { applicationId: "app-1", renterName: "=Ada" }]]),
  });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(depositLedgerToCsv(built.report)).toContain(`"'=Ada"`);
});

it("resolves the renter from the rental user when the payment has no driver", async () => {
  const loaded = await loadDepositLedgerDirectory(client({
    rentals: [{
      id: "r-linked", application_id: null, driver_id: "user-1",
      deposit_amount: 100, deposit_held: true, deposit_status: "held",
      deposit_refund_amount: 0, deposit_settled_at: null,
    }],
    payments: [{
      id: "p-dep", status: "paid", type: "deposit", amount: 100, net_collected: 100,
      paid_date: "2026-10-01", payment_method: "zelle", refunded_amount: 0, refunded_at: null,
      rental_id: "r-linked", driver_id: null,
    }],
    deposit_deductions: [{ id: "d1", rental_id: "r-linked", amount: 20, reason: "toll" }],
    payment_refunds: [],
    applications: [{ id: "app-1", full_name: "Ada Lovelace", user_id: "user-1" }],
  }));
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const built = buildDepositLedger(loaded);
  expect(built.ok && built.report.rows[0]).toMatchObject({
    renterName: "Ada Lovelace",
    collected: 10000,
    collectedDate: "2026-10-01",
    method: "Zelle",
    applied: 2000,
    balance: 8000,
  });
});

it("throws while the flag is off and refuses a coordinator before the load", async () => {
  const load = vi.fn(async () => ({ ok: true as const, rentals: [], payments: [], deductions: [], refunds: [], names: new Map() }));
  await expect(runDepositLedger({ enabled: false, userId: "owner-1", tier: "owner", load })).rejects.toThrow(DEPOSIT_LEDGER_OFF);
  expect(load).not.toHaveBeenCalled();
  const blocked = vi.fn(load);
  await expect(runDepositLedger({ enabled: true, userId: "coord-1", tier: "coordinator", load: blocked })).rejects.toThrow("Forbidden");
  expect(blocked).not.toHaveBeenCalled();
  const owner = await runDepositLedger({ enabled: true, userId: "owner-1", tier: "owner", load });
  expect(owner.status).toBe("ready");
});

it("withholds the report when a read is capped, fails, or money cannot be read", async () => {
  let pages = 0;
  const capped: DepositLedgerClient = {
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
  const cappedResult = await runDepositLedger({
    enabled: true, userId: "manager-1", tier: "manager",
    load: () => loadDepositLedgerDirectory(capped),
  });
  expect(pages).toBe(100);
  expect(cappedResult).toEqual({ status: "unavailable", reason: DEPOSIT_LEDGER_INCOMPLETE, report: null });

  const failed = await runDepositLedger({
    enabled: true, userId: "manager-1", tier: "manager",
    load: () => loadDepositLedgerDirectory(client({ rentals: [rawRental()] }, ["payments"])),
  });
  expect(failed).toEqual({ status: "unavailable", reason: DEPOSIT_LEDGER_INCOMPLETE, report: null });

  const unread = await loadDepositLedgerDirectory(client({
    rentals: [rawRental()],
    payments: [rawPayment({ amount: "nope" })],
  }));
  expect(unread).toEqual({ ok: false });
});

it("keeps the flag off, the tab out of the rail, and the throw ahead of the role check", () => {
  const flag = readFileSync("src/lib/finance-deposit-ledger-flag.ts", "utf8");
  const fn = readFileSync("src/lib/finance-deposit-ledger.functions.ts", "utf8");
  const server = readFileSync("src/lib/finance-deposit-ledger.server.ts", "utf8");
  const pure = readFileSync("src/lib/finance-deposit-ledger.ts", "utf8");
  const panel = readFileSync("src/components/admin/FinanceDepositLedgerPanel.tsx", "utf8");
  const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
  const admin = readFileSync("src/routes/admin.tsx", "utf8");
  const tabs = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
  const handler = fn.slice(fn.indexOf("export const getFinanceDepositLedger"));
  const thrown = handler.indexOf("throw new Error(DEPOSIT_LEDGER_OFF)");
  const role = handler.indexOf("await requireManager(context.userId)");
  const load = handler.indexOf("loadDepositLedgerDirectory");
  expect(flag).toContain("export const FINANCE_DEPOSIT_LEDGER_ENABLED = false");
  expect(thrown).toBeGreaterThan(-1);
  expect(role).toBeGreaterThan(thrown);
  expect(load).toBeGreaterThan(role);
  expect(handler).not.toContain("createStripeClient");
  expect(handler).not.toContain("createReadOnlyStripe");
  expect(`${fn}\n${server}\n${pure}`).not.toMatch(/\.(insert|update|delete|upsert|or)\(/);
  expect(`${fn}\n${server}\n${pure}`).not.toMatch(/\.(or|filter)\(\s*`[^`]*\$\{/);
  expect(server).toContain("id,application_id,driver_id,deposit_amount,deposit_held,deposit_status,deposit_refund_amount,deposit_settled_at");
  expect(panel).not.toContain("finance-deposit-ledger.server");
  expect(tabs).toMatch(/id: "deposits_ledger"/);
  expect(tabs).not.toMatch(/id: "finance_deposit_ledger"/);
  expect(tabs).not.toMatch(/id: "deposit_ledger"/);
  expect(nav).toContain('!FINANCE_DEPOSIT_LEDGER_ENABLED || !tierAllows(tier, "manager")');
  expect(admin).toContain('urlTab === "finance_deposit_ledger"');
  expect(admin).toContain('if (!FINANCE_DEPOSIT_LEDGER_ENABLED || (tier && !tierAllows(tier, "manager"))) return "overview"');
  expect(admin).toContain('FINANCE_DEPOSIT_LEDGER_ENABLED && tab === "finance_deposit_ledger"');
  expect(admin).toContain('tab === "deposits_ledger"');
  const overviewAt = admin.indexOf('if (!urlTab || !TABS.some((t) => t.id === urlTab)) return "overview"');
  expect(admin.indexOf('urlTab === "finance_deposit_ledger"')).toBeLessThan(overviewAt);
});

type Row = Record<string, unknown>;

function rental(over: Partial<LedgerRental> = {}): LedgerRental {
  return {
    id: "r1",
    applicationId: "app-1",
    driverId: "user-1",
    depositAmount: null,
    depositHeld: true,
    depositStatus: "held",
    depositRefundAmount: null,
    depositSettledAt: null,
    ...over,
  };
}

function payment(over: Partial<LedgerPayment> = {}): LedgerPayment {
  return {
    id: "p1",
    rentalId: "r1",
    driverId: "app-1",
    type: "deposit",
    status: "paid",
    amount: 100,
    netCollected: 100,
    paidDate: "2026-10-01",
    method: "cash",
    refundedAmount: 0,
    refundedAt: null,
    ...over,
  };
}

function deduction(over: Partial<LedgerDeduction> = {}): LedgerDeduction {
  return { id: "d1", rentalId: "r1", amount: 100, reason: "toll", ...over };
}

function names(entries: Array<[string, LedgerName]> = [["app-1", { applicationId: "app-1", renterName: "Ada Lovelace" }]]): Map<string, LedgerName> {
  return new Map(entries);
}

function rawRental(over: Row = {}): Row {
  return {
    id: "r1", application_id: "app-1", driver_id: "user-1",
    deposit_amount: null, deposit_held: false, deposit_status: "none",
    deposit_refund_amount: null, deposit_settled_at: null,
    ...over,
  };
}

function rawPayment(over: Row = {}): Row {
  return {
    id: "p1", status: "paid", type: "deposit", amount: 100, net_collected: 100,
    paid_date: "2026-10-01", payment_method: "cash", refunded_amount: 0, refunded_at: null,
    rental_id: "r1", driver_id: "app-1",
    ...over,
  };
}

function client(tables: Record<string, Row[]>, fail: string[] = []): DepositLedgerClient {
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
