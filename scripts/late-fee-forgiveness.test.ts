// Manage Late Fees: per-day ledger, Forgive Selected / An Amount (oldest first,
// partial allowed) / All, paid fees refused, forgiven fees never re-added by the
// daily sweep, never quoted in texts, Owner Undo, the pre-migration fallback to
// staff waivers, and the UI wiring (cell opens the dialog, not the row).
//
// Run: bun test scripts/late-fee-forgiveness.test.ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;

const L = await import("@/lib/late-fee-ledger");
const RR = await import("@/lib/rent-reminders");
const LF = await import("@/lib/late-fees.server");
const S = await import("@/lib/late-fee-forgiveness.server");

const PROD = L.ledgerPolicyFrom({ enabled: true, daily_fee: 50, flat_fee: 0, grace_days: 0, max_fee: 350, rent_only: true });
const R = "36973513-480e-4423-8129-2e37324ac455";
const APP = "11111111-1111-4111-8111-111111111111";
const USER = { userId: "u-dolmar", email: "dolmarcross@gmail.com" };

type Row = Record<string, any>;
const UNIQUE: Record<string, string[]> = { rent_late_fee_waivers: ["rental_id", "due_date"] };
function fakeDb(seed: Record<string, Row[]>, opts: { missing?: string[]; failUpdate?: string[] } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  const calls: string[] = [];
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false; let lim: number | null = null; let wantRows = false; let conflict: string[] | null = null;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => { wantRows = true; return q; },
      insert: (r: any) => { op = "insert"; payload = r; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      upsert: (r: Row, o: any) => { op = "upsert"; payload = r; conflict = String(o?.onConflict ?? "").split(",").filter(Boolean); return q; },
      delete: () => { op = "delete"; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      gte: (c: string, v: any) => { f.push((r) => String(r[c] ?? "") >= String(v)); return q; },
      lt: (c: string, v: any) => { f.push((r) => String(r[c] ?? "") < String(v)); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      order: () => q,
      limit: (x: number) => { lim = x; return q; },
      maybeSingle: () => { single = true; return q; },
      single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      calls.push(`${op}:${table}`);
      if (opts.missing?.includes(table)) return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` } };
      const rows = state[table];
      if (op === "insert") {
        const list = Array.isArray(payload) ? payload : [payload];
        const made = list.map((p) => ({ id: `${table}-${n++}`, created_at: "2026-11-19T01:00:00Z", undone_at: null, ...p }));
        rows.push(...made);
        return { data: wantRows ? (single ? { id: made[0].id } : made.map((m) => ({ id: m.id }))) : null, error: null };
      }
      if (op === "upsert") {
        const keys = conflict?.length ? conflict : UNIQUE[table] ?? [];
        const hit = rows.find((r) => keys.length && keys.every((k) => r[k] === payload[k]));
        if (hit) Object.assign(hit, payload);
        const r = hit ?? { id: `${table}-${n++}`, created_at: "2026-11-19T01:00:00Z", ...payload };
        if (!hit) rows.push(r);
        return { data: single ? { id: r.id } : [{ id: r.id }], error: null };
      }
      let m = rows.filter((r) => f.every((x) => x(r)));
      if (op === "update") {
        if (opts.failUpdate?.includes(table)) return { data: null, error: { message: "update failed" } };
        for (const r of m) Object.assign(r, payload);
        return { data: wantRows ? m.map((r) => ({ ...r })) : null, error: null };
      }
      if (lim != null) m = m.slice(0, lim);
      return { data: single ? m[0] ?? null : m.map((r) => ({ ...r })), error: null };
    }
    return q;
  }
  return { from, state, calls };
}

/** Heather-like manual renter: $350 due Tue Nov 17, unpaid; sweep recorded $50 through Nov 18. */
function seed(extra: Record<string, Row[]> = {}, dueDate = "2026-11-17", lateFees = 50) {
  return {
    rentals: [{ id: R, application_id: APP, status: "active", weekly_rate: 350, next_payment_due: dueDate, stripe_subscription_id: null, stripe_customer_id: null }],
    applications: [{ id: APP, full_name: "Heather Bell", phone: null, email: null }],
    payments: [{ id: "p1", rental_id: R, type: "rent", status: "overdue", amount: 350, late_fees: lateFees, balance_due: 350 + lateFees, due_date: dueDate, paid_date: null, created_at: "2026-11-17T12:00:00Z" }],
    app_settings: [{ key: "late_fee_policy", value: { enabled: true, daily_fee: 50, flat_fee: 0, grace_days: 0, max_fee: 350, rent_only: true } }],
    rent_late_fee_waivers: [], late_fee_forgiveness: [], payment_text_pauses: [], rent_reminder_log: [], return_checklists: [],
    ...extra,
  };
}
const at = (date: string, hourEt = 21) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), hourEt + 5));

describe("ledger", () => {
  test("one line per late day at $50, cap $350 a week", () => {
    const w = L.buildLedgerWeek({ policy: PROD, week: { dueDate: "2026-11-17", asOf: "2026-11-18", owing: true } });
    expect(w.fees.map((f) => [f.feeDate, f.amount, f.status])).toEqual([["2026-11-18", 50, "open"]]);
    const long = L.buildLedgerWeek({ policy: PROD, week: { dueDate: "2026-11-05", asOf: "2026-11-18", owing: true } });
    expect(long.fees).toHaveLength(7);
    expect(long.open).toBe(350);
    expect(long.capReached).toBe(true);
  });
  test("deal days carry no fee (Regina Nov 16-18) and waived days are struck, matching the sweep", () => {
    const deal = L.buildLedgerWeek({ policy: PROD, week: { dueDate: "2026-11-16", asOf: "2026-11-18", owing: true }, deals: [{ from: "2026-11-16", through: "2026-11-18" }] });
    expect(deal.open).toBe(0);
    expect(deal.fees.every((f) => f.status === "paused")).toBe(true);
    const waived = L.buildLedgerWeek({ policy: PROD, week: { dueDate: "2026-11-12", asOf: "2026-11-18", owing: true }, waivers: [{ dueDate: "2026-11-12", waivedThrough: "2026-11-14", byEmail: "dolmarcross@gmail.com" }] });
    expect(waived.fees.filter((f) => f.status === "waived")).toHaveLength(2);
    expect(waived.open).toBe(200);
    expect(waived.fees[0].credits[0]).toMatchObject({ kind: "waived", byEmail: "dolmarcross@gmail.com" });
  });
  test("with no policy, deals or forgiveness, weekLateFee equals the old lateFeeFor (texts unchanged)", () => {
    for (const today of ["2026-11-12", "2026-11-13", "2026-11-16", "2026-11-30"]) {
      for (const waivers of [[], [{ dueDate: "2026-11-12", waivedThrough: null }], [{ dueDate: "2026-11-12", waivedThrough: "2026-11-14" }]]) {
        expect(RR.weekLateFee({ waivers }, "2026-11-12", today).fee).toBe(RR.lateFeeFor({ dueDate: "2026-11-12", today, waivers }).fee);
      }
    }
  });
  test("forgiveness credits a named day; a settled week's fees read Paid", () => {
    const fz = [{ id: "f1", dueDate: "2026-11-12", feeDate: "2026-11-14", amount: 50, reason: "goodwill", byEmail: "rosa@drivereal.com", at: "2026-11-18T20:00:00Z" }];
    const led = L.buildLedger({
      policy: PROD,
      weeks: [{ dueDate: "2026-11-12", asOf: "2026-11-16", owing: true }, { dueDate: "2026-11-05", asOf: "2026-11-07", owing: false, settled: true }],
      forgiveness: fz,
    });
    expect(led.weeks.map((w) => w.dueDate)).toEqual(["2026-11-05", "2026-11-12"]);
    const nov12 = led.weeks[1];
    expect(nov12.fees.find((f) => f.feeDate === "2026-11-14")).toMatchObject({ status: "forgiven", forgiven: 50, open: 0 });
    expect(nov12.open).toBe(150);
    expect(led.weeks[0].fees.every((f) => f.status === "paid")).toBe(true);
    expect(L.owingOpen(led)).toBe(150);
  });
});

describe("plan", () => {
  const led = L.buildLedger({ policy: PROD, weeks: [{ dueDate: "2026-11-12", asOf: "2026-11-15", owing: true }, { dueDate: "2026-11-05", asOf: "2026-11-07", owing: false, settled: true }] });
  test("an amount is applied oldest first and may cover part of a fee", () => {
    const p = L.planForgiveness(led, { kind: "amount", amount: 75 });
    expect(p.problem).toBeNull();
    expect(p.allocations.map((a) => [a.feeDate, a.amount])).toEqual([["2026-11-13", 50], ["2026-11-14", 25]]);
    expect(L.planForgiveness(led, { kind: "amount", amount: 500 }).problem).toMatch(/Only \$150\.00/);
  });
  test("Forgive All takes every open fee; paid fees are never forgiven", () => {
    expect(L.planForgiveness(led, { kind: "all" }).total).toBe(150);
    const paidId = led.weeks[0].fees[0].id;
    const p = L.planForgiveness(led, { kind: "selected", feeIds: [paidId] });
    expect(p.problem).toBe("Paid Late Fees Can't Be Forgiven Here.");
    expect(p.skippedPaid).toEqual([paidId]);
    const mixed = L.planForgiveness(led, { kind: "selected", feeIds: [paidId, "2026-11-12|2026-11-15"] });
    expect(mixed.allocations.map((a) => a.feeDate)).toEqual(["2026-11-15"]);
  });
  test("before the migration: whole days from the oldest fit a waiver; part of a day or a later day does not", () => {
    expect(L.planAsWaivers(led, L.planForgiveness(led, { kind: "amount", amount: 100 }))).toEqual({ ok: true, waivers: [{ dueDate: "2026-11-12", waivedThrough: "2026-11-14", days: 2 }] });
    expect(L.planAsWaivers(led, L.planForgiveness(led, { kind: "all" })).ok).toBe(true);
    expect(L.planAsWaivers(led, L.planForgiveness(led, { kind: "amount", amount: 75 })).ok).toBe(false);
    expect(L.planAsWaivers(led, L.planForgiveness(led, { kind: "selected", feeIds: ["2026-11-12|2026-11-15"] })).ok).toBe(false);
  });
});

describe("daily sweep respects forgiveness", () => {
  test("computeLateFee takes forgiven dollars off after the cap, so nothing is added back", () => {
    const policy = LF.normalizePolicy({ enabled: true, daily_fee: 50, grace_days: 0, flat_fee: 0, max_fee: 350 });
    // 3 days late, $100 recorded after $50 was forgiven: target 150 - 50 = 100 -> add 0.
    expect(LF.computeLateFee({ policy, dueDate: "2026-11-12", today: "2026-11-15", alreadyCharged: 100, appliedThrough: "2026-11-14", forgivenAmount: 50 }).addition).toBe(0);
    // Next day: target 200 - 50 = 150 -> add 50 (the new day only).
    expect(LF.computeLateFee({ policy, dueDate: "2026-11-12", today: "2026-11-16", alreadyCharged: 100, appliedThrough: "2026-11-15", forgivenAmount: 50 }).addition).toBe(50);
    // At the cap, forgiving $50 keeps the total at $300 for good.
    expect(LF.computeLateFee({ policy, dueDate: "2026-11-01", today: "2026-11-18", alreadyCharged: 300, appliedThrough: "2026-11-17", forgivenAmount: 50 }).addition).toBe(0);
  });
  test("applyLateFees reads late_fee_forgiveness (and ignores undone rows)", async () => {
    const db = fakeDb(seed({
      late_fee_forgiveness: [
        { id: "f1", rental_id: R, due_date: "2026-11-17", fee_date: "2026-11-18", amount: 50, undone_at: null },
        { id: "f2", rental_id: R, due_date: "2026-11-17", fee_date: "2026-11-19", amount: 50, undone_at: "2026-11-19T02:00:00Z" },
      ],
      payments: [{ id: "p1", rental_id: R, driver_id: APP, type: "rent", status: "overdue", amount: 350, late_fees: 0, balance_due: 350, due_date: "2026-11-17", late_fee_applied_through: "2026-11-18" }],
    }));
    const r = await LF.applyLateFees("2026-11-19", { admin: db, policy: LF.normalizePolicy({ enabled: true, daily_fee: 50, max_fee: 350, grace_days: 0, flat_fee: 0, rent_only: true }) });
    // 2 late days ($100) less $50 forgiven = $50.
    expect(r.totalAdded).toBe(50);
    expect(db.state.payments[0]).toMatchObject({ late_fees: 50, balance_due: 400 });
  });
  test("before the migration (table missing) the sweep behaves exactly as before", async () => {
    const db = fakeDb(seed({ payments: [{ id: "p1", rental_id: R, driver_id: APP, type: "rent", status: "overdue", amount: 350, late_fees: 0, balance_due: 350, due_date: "2026-11-17", late_fee_applied_through: null }] }), { missing: ["late_fee_forgiveness"] });
    const r = await LF.applyLateFees("2026-11-19", { admin: db, policy: LF.normalizePolicy({ enabled: true, daily_fee: 50, max_fee: 350, grace_days: 0, flat_fee: 0, rent_only: true }) });
    expect(r.totalAdded).toBe(100);
  });
});

describe("reminder texts respect forgiveness", () => {
  const T = RR.mergeTemplates(null);
  const state = (forgiveness: any[] = []) => ({
    rentalId: R, applicationId: APP, firstName: "Heather", phone: "+18135550100", email: null, weeklyRate: 350, mode: "manual" as const,
    dueDate: "2026-11-12", owing: true, rentOwed: 350, waivers: [], forgiveness, deals: [], lateFeePolicy: PROD,
  });
  test("daily text: a forgiven fee is never quoted, and the balance drops", () => {
    const before = RR.renderReminder(T, "daily", state(), at("2026-11-15", 10))!;
    expect(before.sms).toContain("$150");
    const after = RR.renderReminder(T, "daily", state([{ id: "f", dueDate: "2026-11-12", feeDate: "2026-11-13", amount: 50, reason: "goodwill", byEmail: null, at: null }]), at("2026-11-15", 10))!;
    expect(after.sms).toContain("$100");
    expect(after.sms).not.toContain("$150");
    const all = RR.renderReminder(T, "daily", state(["2026-11-13", "2026-11-14", "2026-11-15"].map((d, i) => ({ id: `f${i}`, dueDate: "2026-11-12", feeDate: d, amount: 50, reason: "goodwill", byEmail: null, at: null }))), at("2026-11-15", 10))!;
    expect(all.sms).not.toMatch(/late fees/i);
  });
});

describe("forgive on the server", () => {
  test("table: Forgive All records a credit per day, lowers the rent row, writes nothing to Stripe", async () => {
    const db = fakeDb(seed({}, "2026-11-12", 150));
    const res = await S.forgiveLateFees(db, { rentalId: R, mode: { kind: "all" }, reason: "goodwill", note: "First time", expectedOpen: 150 }, USER, { now: at("2026-11-15") });
    expect(res).toMatchObject({ total: 150, storage: "table", openBefore: 150, openAfter: 0 });
    expect(db.state.late_fee_forgiveness.map((r) => [r.fee_date, r.amount, r.forgiven_by_email])).toEqual([
      ["2026-11-13", 50, USER.email], ["2026-11-14", 50, USER.email], ["2026-11-15", 50, USER.email],
    ]);
    expect(db.state.payments[0]).toMatchObject({ late_fees: 0, balance_due: 350, status: "overdue" });
    expect(db.calls.some((c) => /stripe|sms|message/i.test(c))).toBe(false);
    // The ledger now reads $0 owed, struck through with who forgave it.
    const read = await S.readRentalLedger(db, R, "2026-11-15");
    expect(L.owingOpen(read.ledger)).toBe(0);
    expect(read.ledger.weeks[0].fees[0].credits[0]).toMatchObject({ kind: "forgiven", byEmail: USER.email, reason: "goodwill" });
  });
  test("table: a custom amount, partial fee, oldest first", async () => {
    const db = fakeDb(seed({}, "2026-11-12", 150));
    const res = await S.forgiveLateFees(db, { rentalId: R, mode: { kind: "amount", amount: 75 }, reason: "hardship", note: null }, USER, { now: at("2026-11-15") });
    expect(res.total).toBe(75);
    expect(db.state.payments[0]).toMatchObject({ late_fees: 75, balance_due: 425 });
    expect(db.state.late_fee_forgiveness.map((r) => [r.fee_date, r.amount, r.payment_late_fee_reduced])).toEqual([["2026-11-13", 50, 50], ["2026-11-14", 25, 25]]);
  });
  test("stale screen: the open total changed since the dialog loaded -> refused, nothing written", async () => {
    const db = fakeDb(seed({}, "2026-11-12", 150));
    await expect(S.forgiveLateFees(db, { rentalId: R, mode: { kind: "all" }, reason: "goodwill", note: null, expectedOpen: 100 }, USER, { now: at("2026-11-15") })).rejects.toThrow(/Changed/);
    expect(db.state.late_fee_forgiveness).toHaveLength(0);
    expect(db.state.payments[0].late_fees).toBe(150);
  });
  test("a paid week's fees cannot be forgiven", async () => {
    const db = fakeDb(seed({ payments: [{ id: "p0", rental_id: R, type: "rent", status: "paid", amount: 350, late_fees: 100, balance_due: 0, due_date: "2026-11-10", paid_date: "2026-11-12" }] }, "2026-11-17", 0));
    await expect(S.forgiveLateFees(db, { rentalId: R, mode: { kind: "selected", feeIds: ["2026-11-10|2026-11-11"] }, reason: "goodwill", note: null }, USER, { now: at("2026-11-17", 9) })).rejects.toThrow("Paid Late Fees Can't Be Forgiven Here.");
    expect(db.state.payments.find((p) => p.id === "p0")).toMatchObject({ late_fees: 100, status: "paid" });
  });
  test("Owner Undo puts back exactly what came off the row", async () => {
    const db = fakeDb(seed({}, "2026-11-12", 150));
    await S.forgiveLateFees(db, { rentalId: R, mode: { kind: "amount", amount: 50 }, reason: "goodwill", note: null }, USER, { now: at("2026-11-15") });
    const id = db.state.late_fee_forgiveness[0].id;
    const u = await S.undoLateFeeForgiveness(db, { forgivenessId: id, note: null }, USER);
    expect(u.restoredToRow).toBe(50);
    expect(db.state.payments[0]).toMatchObject({ late_fees: 150, balance_due: 500 });
    expect(db.state.late_fee_forgiveness[0].undone_by_email).toBe(USER.email);
    await expect(S.undoLateFeeForgiveness(db, { forgivenessId: id, note: null }, USER)).rejects.toThrow("Already Undone.");
  });
  test("before the migration: whole oldest days are saved as a staff waiver and the row drops", async () => {
    const db = fakeDb(seed({}, "2026-11-12", 150), { missing: ["late_fee_forgiveness"] });
    const res = await S.forgiveLateFees(db, { rentalId: R, mode: { kind: "amount", amount: 100 }, reason: "goodwill", note: "Called in", expectedOpen: 150 }, USER, { now: at("2026-11-15") });
    expect(res).toMatchObject({ storage: "waivers", total: 100 });
    expect(db.state.rent_late_fee_waivers).toHaveLength(1);
    expect(db.state.rent_late_fee_waivers[0]).toMatchObject({ due_date: "2026-11-12", waived_through: "2026-11-14", waived_by_email: USER.email });
    expect(db.state.rent_late_fee_waivers[0].reason).toBe("Forgiven: Goodwill. Called in");
    expect(db.state.payments[0]).toMatchObject({ late_fees: 50, balance_due: 400 });
  });
  test("before the migration: part of a fee is refused and nothing changes", async () => {
    const db = fakeDb(seed({}, "2026-11-12", 150), { missing: ["late_fee_forgiveness"] });
    await expect(S.forgiveLateFees(db, { rentalId: R, mode: { kind: "amount", amount: 75 }, reason: "goodwill", note: null }, USER, { now: at("2026-11-15") })).rejects.toThrow(/Pending Database Update/);
    expect(db.state.rent_late_fee_waivers).toHaveLength(0);
    expect(db.state.payments[0].late_fees).toBe(150);
  });
  test("a processing (pending) or paid rent row is never lowered", async () => {
    const db = fakeDb(seed({}, "2026-11-12", 150));
    db.state.payments[0].status = "pending";
    const res = await S.forgiveLateFees(db, { rentalId: R, mode: { kind: "all" }, reason: "goodwill", note: null }, USER, { now: at("2026-11-15") });
    expect(res.paymentUpdates).toHaveLength(0);
    expect(db.state.payments[0].late_fees).toBe(150);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  test("the Overdue cell opens Manage Late Fees, never the row", () => {
    const src = read("src/components/admin/ActiveRentalsPanel.tsx");
    const cell = src.slice(src.indexOf('data-testid="late-fee-cell"') - 200, src.indexOf('data-testid="late-fee-cell"') + 600);
    expect(cell).toContain("data-no-row-click");
    expect(cell).toContain("e.stopPropagation()");
    expect(cell).toContain('setDialog({ kind: "fees", row })');
    expect(src).toContain("<ManageLateFeesDialog");
    const pay = read("src/components/admin/PaymentsPanel.tsx");
    expect(pay).toContain('data-testid="payments-late-fee-cell"');
    expect(pay).toMatch(/tier === "owner" \|\| tier === "manager"/);
    expect(read("src/components/admin/DriversPanel.tsx")).toContain("<LateFeesCard");
    expect(read("src/components/admin/BookingDetails.tsx")).toContain("<LateFeesCard");
  });
  test("Manager and above forgive, Owner undoes, every change is audited", () => {
    const fn = read("src/lib/late-fee-forgiveness.functions.ts");
    expect(fn).toMatch(/forgiveRentalLateFees[\s\S]*requireManager/);
    expect(fn).toMatch(/undoRentalLateFeeForgiveness[\s\S]*requireOwner/);
    expect(fn).toContain('action: "late_fee.forgiven"');
    expect(fn).toContain('action: "late_fee.forgiveness_undone"');
    expect(fn).toMatch(/fee_ids/);
  });
  test("nothing here sends a message or calls Stripe", () => {
    for (const p of ["src/lib/late-fee-forgiveness.server.ts", "src/lib/late-fee-forgiveness.functions.ts", "src/lib/late-fee-ledger.ts", "src/components/admin/ManageLateFeesDialog.tsx"]) {
      const src = read(p).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      expect(src).not.toMatch(/stripe\.server|createStripeClient|sendSms|quo-sms|quo\.server|sendEmail|email\.server/i);
    }
  });
  test("the table is a proposal only: not in supabase/migrations, marked not applied", () => {
    const sql = read("proposed/late-fee-forgiveness-table.sql");
    expect(sql).toMatch(/PROPOSED, NOT APPLIED/);
    expect(sql).toMatch(/Dolmar's approval/);
    expect(readdirSync("supabase/migrations").some((f) => f.includes("late_fee_forgiveness"))).toBe(false);
    expect(existsSync("proposed/late-fee-forgiveness-table.sql")).toBe(true);
  });
});
