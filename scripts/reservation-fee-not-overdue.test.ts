// An unpaid Reservation Fee is a pending hold, not overdue debt.
// Run: bun test scripts/reservation-fee-not-overdue.test.ts
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  awaitingReservationFee,
  buildPaymentsSummary,
  countsAsOwed,
  isOverdueRow,
  isUnpaidReservationFee,
  rowOwed,
} from "../src/lib/payments-summary";

const read = (p: string) => readFileSync(p, "utf8");

describe("isUnpaidReservationFee", () => {
  test("type, reason or notes, and not paid, refunded, void or waived", () => {
    expect(isUnpaidReservationFee({ type: "reservation", status: "unpaid" })).toBe(true);
    expect(isUnpaidReservationFee({ type: "fee", reason: "reservation_fee", status: "current" })).toBe(true);
    expect(isUnpaidReservationFee({ type: "fee", notes: "reservation_fee:ag-1", status: "pending" })).toBe(true);
    for (const status of ["paid", "refunded", "void", "waived"]) {
      expect(isUnpaidReservationFee({ type: "reservation", reason: "reservation_fee", status })).toBe(false);
    }
    expect(isUnpaidReservationFee({ type: "fee", reason: "cleaning", status: "unpaid" })).toBe(false);
    expect(isUnpaidReservationFee({ type: "rent", status: "overdue", amount: 350 })).toBe(false);
  });
});

describe("Heather: Reservation Fee is not Overdue or Outstanding", () => {
  const now = new Date("2026-11-22T15:00:00Z");
  const payments = [
    { id: "rent", driver_id: "heather", rental_id: "r1", type: "rent", status: "overdue", amount: 350, balance_due: 350, due_date: "2026-11-17" },
    { id: "late", driver_id: "heather", rental_id: "r1", type: "late_fee", status: "overdue", amount: 100, balance_due: 100, due_date: "2026-11-17" },
    { id: "fee", driver_id: "heather", rental_id: "r1", type: "fee", reason: "cleaning", status: "unpaid", amount: 150, balance_due: 150, due_date: "2026-11-18" },
    { id: "hold", driver_id: "fee-holder", type: "reservation", reason: "reservation_fee", notes: "reservation_fee:ag-1", status: "unpaid", amount: 50, balance_due: 50, due_date: "2026-11-20" },
  ];
  const covered = new Set<string>();
  const summary = buildPaymentsSummary({ payments, coveredIds: covered, now });

  test("Overdue Now is $600 for 1 renter, Outstanding is $600, Awaiting Reservation Fee is $50 (1)", () => {
    expect(summary.overdue.total).toBe(600);
    expect(summary.overdue.renters).toBe(1);
    const outstanding = payments.filter((p) => countsAsOwed(p, covered)).reduce((sum, p) => sum + rowOwed(p), 0);
    expect(outstanding).toBe(600);
    expect(awaitingReservationFee(payments)).toEqual({ total: 50, count: 1 });
    expect(isOverdueRow(payments[2])).toBe(true);
    expect(isOverdueRow(payments[3])).toBe(false);
    expect(payments.filter((p) => isOverdueRow(p)).map((p) => p.id).sort()).toEqual(["fee", "late", "rent"]);
  });
});

describe("wording and the shared rule", () => {
  test("Payments labels the hold and keeps it beside Outstanding", () => {
    const panel = read("src/components/admin/PaymentsPanel.tsx");
    expect(panel).toContain("Awaiting Reservation Fee:");
    expect(panel).toContain("awaitingReservationFee(");
    expect(panel).toContain("isOverdueRow(");
    expect(panel).not.toContain("Awaiting Deposit");
    expect(panel).not.toContain("reservation deposit");
  });
  test("Overview, Today's Ops, the cron and fleet status use the shared rule", () => {
    for (const file of [
      "src/components/admin/OverviewPanel.tsx",
      "src/lib/todays-ops.functions.ts",
      "src/routes/api/public/cron/ops-reminders.ts",
      "src/lib/fleet-status.server.ts",
    ]) {
      expect(read(file), file).toContain("isUnpaidReservationFee");
    }
    expect(read("src/components/admin/OverviewPanel.tsx")).toContain("type, reason, notes");
    expect(read("src/lib/todays-ops.functions.ts")).toContain("type,reason,notes");
    expect(read("src/routes/api/public/cron/ops-reminders.ts")).toContain("type,reason,notes");
    expect(read("src/lib/fleet-status.server.ts")).toContain("reason,notes");
  });
});

type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const alerts: { driverName?: string | null; amount?: number }[] = [];
const plans: unknown[] = [];

function project(row: Row, cols: string[] | null): Row {
  if (!cols) return { ...row };
  const out: Row = {};
  for (const col of cols) if (col in row) out[col] = row[col];
  return out;
}

function from(name: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let cols: string[] | null = null;
  let limitN: number | null = null;
  const q: any = {
    select(c: string) {
      cols = String(c).split(",").map((part) => part.trim()).filter(Boolean);
      return q;
    },
    order() { return q; },
    limit(n: number) { limitN = n; return q; },
    eq(k: string, v: unknown) { filters.push((row) => row[k] === v); return q; },
    neq(k: string, v: unknown) { filters.push((row) => row[k] !== v); return q; },
    lt(k: string, v: unknown) { filters.push((row) => row[k] != null && String(row[k]) < String(v)); return q; },
    lte(k: string, v: unknown) { filters.push((row) => row[k] != null && String(row[k]) <= String(v)); return q; },
    gt(k: string, v: unknown) { filters.push((row) => row[k] != null && String(row[k]) > String(v)); return q; },
    gte(k: string, v: unknown) { filters.push((row) => row[k] != null && String(row[k]) >= String(v)); return q; },
    in(k: string, vs: unknown[]) { filters.push((row) => vs.includes(row[k])); return q; },
    is(k: string, v: unknown) { filters.push((row) => (row[k] ?? null) === v); return q; },
    not(k: string, op: string, v: unknown) {
      if (op === "is") filters.push((row) => (row[k] ?? null) !== v);
      else if (op === "in") {
        const list = String(v).replace(/^\(|\)$/g, "").split(",").map((part) => part.trim());
        filters.push((row) => !list.includes(String(row[k])));
      }
      return q;
    },
    or() { return q; },
    like() { return q; },
    ilike() { return q; },
    async maybeSingle() {
      const rows = await q;
      return { data: rows.data[0] ?? null, error: null };
    },
    insert(row: Row) {
      (tables[name] ??= []).push(row);
      const done: any = Promise.resolve({ error: null });
      done.select = () => ({ single: async () => ({ data: { id: "row" }, error: null }) });
      return done;
    },
    update() {
      const u: any = { eq() { return u; }, then: (res: any, rej: any) => Promise.resolve({ error: null }).then(res, rej) };
      return u;
    },
    then(res: any, rej: any) {
      let rows = (tables[name] ?? []).filter((row) => filters.every((fn) => fn(row))).map((row) => project(row, cols));
      if (limitN != null) rows = rows.slice(0, limitN);
      return Promise.resolve({ data: rows, error: null, count: rows.length }).then(res, rej);
    },
  };
  return q;
}

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from,
    rpc: async (fn: string) => (fn === "get_cron_token" ? { data: "cron-test", error: null } : { data: null, error: { message: "no rpc" } }),
  },
}));
mock.module("@/lib/email.server", () => ({
  sendEmail: async () => ({ ok: true }),
  sendLicenseExpiringEmail: async () => ({ ok: true }),
  sendServiceDigestEmail: async () => ({ ok: true }),
  sendTeamPaymentAlertEmail: async (args: { driverName?: string | null; amount?: number }) => {
    alerts.push(args);
    return { ok: true };
  },
  sendTeamCollectionsPlanEmail: async (args: unknown) => {
    plans.push(args);
    return { ok: true };
  },
}));
mock.module("@tanstack/react-router", () => ({ createFileRoute: () => (cfg: any) => cfg }));

const ops = (await import("@/routes/api/public/cron/ops-reminders")).Route as any;

describe("ops-reminders skips an unpaid Reservation Fee", () => {
  test("team past-due alert and Collections Plan leave the reservation row out", async () => {
    for (const key of Object.keys(tables)) delete tables[key];
    alerts.length = 0;
    plans.length = 0;
    const today = new Date().toISOString().slice(0, 10);
    tables.applications = [
      { id: "heather", full_name: "Heather", email: null, user_id: null },
      { id: "fee-holder", full_name: "Fee Holder", email: null, user_id: null },
    ];
    tables.payments = [
      { id: "rent", driver_id: "heather", amount: 350, balance_due: 350, due_date: "2026-11-01", status: "overdue", type: "rent" },
      { id: "late", driver_id: "heather", amount: 100, balance_due: 100, due_date: "2026-11-01", status: "overdue", type: "late_fee" },
      { id: "fee", driver_id: "heather", amount: 150, balance_due: 150, due_date: "2026-11-01", status: "unpaid", type: "fee", reason: "cleaning" },
      { id: "res-past", driver_id: "fee-holder", amount: 50, balance_due: 50, due_date: "2026-11-01", status: "unpaid", type: "fee", reason: "reservation_fee", notes: "reservation_fee:ag-1" },
      { id: "res-today", driver_id: "fee-holder", amount: 50, balance_due: 50, due_date: today, status: "unpaid", type: "reservation", reason: "reservation_fee", notes: "reservation_fee:ag-2" },
    ];
    const res = await ops.server.handlers.GET({ request: new Request("https://x/api", { headers: { authorization: "Bearer cron-test" } }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.team_past_due_alerts).toBe(1);
    expect(body.collections_plan_sent).toBe(0);
    expect(alerts).toEqual([expect.objectContaining({ driverName: "Heather", amount: 600 })]);
    expect(plans).toEqual([]);
    const text = JSON.stringify(tables.notifications ?? []) + JSON.stringify(tables.outbound_messages ?? []);
    expect(text).toContain("Heather");
    expect(text).toContain("$600.00");
    expect(text).not.toContain("Fee Holder");
    expect(text).toContain("No payments due today or tomorrow.");
  });
});
