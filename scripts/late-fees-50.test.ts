// Late fees at $50/day (D33-D36, t298s1611): rent only, firm from the day
// after the due date (applies during the 48-hour grace), no fee during an
// approved payment deal, staff waivers honored, stops once the car is
// returned, Eastern calendar day. Includes the Nov 16 production dry run.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const lf = await import("@/lib/late-fees.server");
const { lateFeeFor } = await import("@/lib/rent-reminders");

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>, opts: { missing?: string[] } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  const unique: Record<string, string> = { fleet_review_decisions: "idempotency_key", fleet_webhook_deliveries: "dedupe_key" };
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false; let lim: number | null = null; let wantRows = false; let cols = "";
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: (c?: string) => { wantRows = true; cols = c ?? ""; return q; },
      insert: (r: Row) => { op = "insert"; payload = r; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      upsert: (r: Row, o: any) => { op = o?.ignoreDuplicates ? "insert_ignore" : "insert"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      neq: (c: string, v: any) => { f.push((r) => r[c] !== v); return q; },
      is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      gte: (c: string, v: any) => { f.push((r) => String(r[c] ?? "") >= String(v)); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      order: () => q, lt: (c: string, v: any) => { f.push((r) => String(r[c] ?? "") < String(v)); return q; },
      limit: (x: number) => { lim = x; return q; },
      maybeSingle: () => { single = true; return q; },
      single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (opts.missing?.includes(table)) return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
      if (table === "applications" && cols.includes("approval_evidence_version"))
        return { data: null, error: { code: "42703", message: "column applications.approval_evidence_version does not exist" } };
      const rows = state[table];
      if (op === "insert" || op === "insert_ignore") {
        const u = unique[table];
        if (u && payload[u] != null && rows.some((r) => r[u] === payload[u])) {
          if (op === "insert_ignore") return { data: [], error: null };
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        if (table === "fleet_review_decisions" && payload.decision === "needs_staff" && rows.some((r) => r.application_id === payload.application_id && r.decision === "needs_staff" && !r.resolved_at))
          return { data: null, error: { code: "23505", message: "one open" } };
        const r = { id: `${table}-${n++}`, created_at: new Date().toISOString(), resolved_at: null, ...payload };
        rows.push(r);
        return { data: wantRows ? (single ? { id: r.id } : [{ id: r.id }]) : null, error: null };
      }
      let m = rows.filter((r) => f.every((x) => x(r)));
      if (op === "update") { for (const r of m) Object.assign(r, payload); return { data: wantRows ? m.map((r) => ({ ...r })) : null, error: null }; }
      if (lim != null) m = m.slice(0, lim);
      return { data: single ? m[0] ?? null : m, error: null };
    }
    return q;
  }
  return { from, state, storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed.example/${p}?t=1` } }) }) } };
}


const SQL = readFileSync("proposed/late-fees-50-daily-on.sql", "utf8");
const POLICY = lf.normalizePolicy(JSON.parse(/'(\{"enabled": true[^']+)'/.exec(SQL)![1]));
const R = "83668a8d-1868-45c5-bb20-38f54491ab6c";
const R2 = "99999999-9999-4999-8999-999999999999";
const pay = (id: string, due: string, extra: Row = {}) => ({ id, rental_id: R2, driver_id: "d", type: "rent", amount: 350, balance_due: 350, late_fees: 0, due_date: due, status: "failed", late_fee_applied_through: null, ...extra });
const base = (extra: Record<string, Row[]> = {}) => ({ payments: [], rentals: [{ id: R2, status: "active", end_date: null }], rent_late_fee_waivers: [], payment_text_pauses: [], rent_reminder_log: [], return_checklists: [], ...extra });

describe("policy in the proposed SQL", () => {
  test("$50/day, no grace, no flat fee, no cap, rent only", () => {
    expect(POLICY).toEqual({ enabled: true, grace_days: 0, flat_fee: 0, daily_fee: 50, max_fee: 0, rent_only: true });
    expect(SQL).toMatch(/PROPOSED, NOT APPLIED/);
  });
  test("matches what the reminder texts already say ($50 a day from the day after the due date)", () => {
    for (const today of ["2026-11-13", "2026-11-14", "2026-11-20"]) {
      const c = lf.computeLateFee({ policy: POLICY, dueDate: "2026-11-12", today, alreadyCharged: 0, appliedThrough: null });
      expect(c.addition).toBe(lateFeeFor({ dueDate: "2026-11-12", today }).fee);
    }
    expect(lf.computeLateFee({ policy: POLICY, dueDate: "2026-11-12", today: "2026-11-12", alreadyCharged: 0, appliedThrough: null }).addition).toBe(0);
  });
});

describe("sweep", () => {
  test("charges $50 per late day once per day; catches up a missed day; tolls untouched", async () => {
    const db = fakeDb(base({ payments: [pay("p1", "2026-11-12"), pay("t1", "2026-11-12", { type: "toll", amount: 40, balance_due: 40 })] }));
    const r = await lf.applyLateFees("2026-11-14", { admin: db, policy: POLICY });
    expect(r.totalAdded).toBe(100);
    expect(db.state.payments[0]).toMatchObject({ late_fees: 100, balance_due: 450, status: "overdue", late_fee_applied_through: "2026-11-14" });
    expect(db.state.payments[1].late_fees).toBe(0);
    expect((await lf.applyLateFees("2026-11-14", { admin: db, policy: POLICY })).totalAdded).toBe(0);
    expect((await lf.applyLateFees("2026-11-16", { admin: db, policy: POLICY })).totalAdded).toBe(100);
    expect(db.state.payments[0].late_fees).toBe(200);
  });
  test("an open approved deal (pause table or the older reminder-log pause): nothing accrues, nothing written", async () => {
    const db = fakeDb(base({
      payments: [pay("p1", "2026-11-12")],
      payment_text_pauses: [{ rental_id: R2, starts_at: null, created_at: "2026-11-15T23:00:00Z", pause_until: "2026-11-22T04:59:59Z", cancelled_at: null }],
    }));
    const r = await lf.applyLateFees("2026-11-16", { admin: db, policy: POLICY });
    expect(r).toMatchObject({ totalAdded: 0, pausedDeal: 1 });
    expect(db.state.payments[0]).toMatchObject({ late_fees: 0, late_fee_applied_through: null });
    // After the deal ends, the deal days are not charged; days before the deal are.
    const after = await lf.applyLateFees("2026-11-23", { admin: db, policy: POLICY });
    // Late days Nov 13..23 = 11; deal Nov 15..21 = 7 -> 4 days.
    expect(after.totalAdded).toBe(200);
  });
  test("staff waivers: whole week, or through a date", async () => {
    const db = fakeDb(base({
      payments: [pay("p1", "2026-11-05"), pay("p2", "2026-11-12")],
      rent_late_fee_waivers: [{ rental_id: R2, due_date: "2026-11-05", waived_through: null }, { rental_id: R2, due_date: "2026-11-12", waived_through: "2026-11-14" }],
    }));
    const r = await lf.applyLateFees("2026-11-16", { admin: db, policy: POLICY });
    expect(db.state.payments[0].late_fees).toBe(0);
    expect(db.state.payments[1].late_fees).toBe(100); // Nov 15, 16
    expect(r.totalAdded).toBe(100);
  });
  test("stops once the car is returned to the shop", async () => {
    const db = fakeDb(base({ payments: [pay("p1", "2026-11-12")], return_checklists: [{ rental_id: R2, returned_at: "2026-11-14T20:00:00Z" }] }));
    expect((await lf.applyLateFees("2026-11-20", { admin: db, policy: POLICY })).totalAdded).toBe(100);
    expect((await lf.applyLateFees("2026-11-25", { admin: db, policy: POLICY })).totalAdded).toBe(0);
  });
  test("disabled policy writes nothing", async () => {
    const db = fakeDb(base({ payments: [pay("p1", "2026-11-01")] }));
    const r = await lf.applyLateFees("2026-11-16", { admin: db, policy: lf.normalizePolicy({ enabled: false }) });
    expect(r.examined).toBe(0);
    expect(db.state.payments[0].late_fees).toBe(0);
  });
  test("fees count by the Eastern calendar day", () => {
    expect(lf.easternToday(new Date("2026-11-17T04:30:00Z"))).toBe("2026-11-16");
    expect(lf.easternToday(new Date("2026-11-17T05:30:00Z"))).toBe("2026-11-17");
  });
});

describe("production dry run, Nov 16 2026 (read-only snapshot)", () => {
  // The only unpaid rent rows in production on Nov 15, 2026, 11:50 PM ET.
  // Both belong to the rental in the approved deal ($1,050 by Nov 21).
  const snapshot = () => fakeDb({
    payments: [
      { id: "3fa3f400", rental_id: R, driver_id: "789433ea", type: "rent", amount: 350, balance_due: 350, late_fees: 0, due_date: "2026-11-05", status: "failed", late_fee_applied_through: null },
      { id: "d40bab77", rental_id: R, driver_id: "789433ea", type: "rent", amount: 350, balance_due: 350, late_fees: 0, due_date: "2026-11-12", status: "failed", late_fee_applied_through: null },
    ],
    rentals: [{ id: R, status: "active", end_date: "2026-11-12" }],
    rent_late_fee_waivers: [{ rental_id: R, due_date: "2026-11-05", waived_through: null }],
    payment_text_pauses: [],
    rent_reminder_log: [{ rental_id: R, outcome: "skipped:paused_deal", created_at: "2026-11-15T23:29:50Z", detail: "Paused through 2026-11-21 23:59 ET: payment deal ($1,050 by 11/21). Approved by Dolmar (t278u), requested via FLEET." }],
    return_checklists: [],
  });
  test("turning it on now charges $0; nothing written", async () => {
    const db = snapshot();
    const r = await lf.applyLateFees("2026-11-16", { admin: db, policy: POLICY, dryRun: true });
    expect(r.totalAdded).toBe(0);
    expect(r.details!.map((d) => [d.payment_id, d.addition, d.reason])).toEqual([
      ["3fa3f400", 0, "approved payment deal open"],
      ["d40bab77", 0, "approved payment deal open"],
    ]);
  });
  test("if the deal is not paid: first run after it ends (Nov 22) adds $150 on the Nov 12 week only; the Nov 5 week stays waived", async () => {
    const db = snapshot();
    const r = await lf.applyLateFees("2026-11-22", { admin: db, policy: POLICY, dryRun: true });
    expect(r.details!.map((d) => [d.payment_id, d.addition])).toEqual([["3fa3f400", 0], ["d40bab77", 150]]);
  });
});

describe("one rent standing: rent paid on another row, and daily plans (Nov 19 2026)", () => {
  test("a week paid through a Payment Link on another row gets no fee (Schrita)", async () => {
    const db = fakeDb(base({ payments: [
      pay("open", "2026-11-16", { status: "overdue", stripe_invoice_id: "in_x" }),
      { id: "link", rental_id: R2, type: "rent", amount: 350, status: "paid", due_date: "2026-11-16", paid_date: "2026-11-18" },
    ] }));
    const run = await lf.applyLateFees("2026-11-19", { admin: db, policy: POLICY });
    expect(run.charged).toBe(0);
    expect(run.details!.find((d) => d.payment_id === "open")?.reason).toBe("rent paid on another row");
    expect(db.state.payments.find((p: Row) => p.id === "open").late_fees).toBe(0);
  });
  test("a payment typed Fee does not settle rent (the data fix retypes it)", async () => {
    const db = fakeDb(base({ payments: [
      pay("open", "2026-11-16", { status: "overdue" }),
      { id: "link", rental_id: R2, type: "fee", amount: 350, status: "paid", due_date: "2026-11-18", paid_date: "2026-11-18" },
    ] }));
    const run = await lf.applyLateFees("2026-11-19", { admin: db, policy: POLICY });
    expect(run.charged).toBe(1);
  });
  test("a daily rent plan replaces the weekly row: no fee (Regina)", async () => {
    const db = fakeDb(base({
      payments: [pay("week", "2026-11-16", { status: "overdue" })],
      app_settings: [{ key: "daily_rent_plans", value: { [R2]: { dailyRate: 50, startsOn: "2026-11-16" } } }],
    }));
    const run = await lf.applyLateFees("2026-11-19", { admin: db, policy: POLICY });
    expect(run.charged).toBe(0);
    expect(run.details!.find((d) => d.payment_id === "week")?.reason).toBe("daily rent plan");
  });
});
