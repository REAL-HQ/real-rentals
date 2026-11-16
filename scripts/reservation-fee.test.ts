// $50 Reservation Fee and Late Pickup Release (Dolmar, t299s1618).
// Network refused; fake database and fake Stripe. Both switches OFF by default.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const rf = await import("@/lib/reservation-fee");
const rfs = await import("@/lib/reservation-fee.server");
const lp = await import("@/lib/late-pickup.server");
const fa = await import("@/lib/fleet-agreement.server");
const ir = await import("@/lib/insurance-rate");
const cat = await import("@/lib/automation-catalog");

type Row = Record<string, any>;
let seq = 0;
function fakeDb(seed: Record<string, Row[]> = {}, opts: { missing?: string[]; uniqueKey?: string[] } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q, insert: (r: Row) => { op = "insert"; payload = r; return q; }, update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; }, is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; }, lt: (c: string, v: any) => { f.push((r) => Number(r[c] ?? 0) < v); return q; },
      limit: () => q, order: () => q,
      maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (opts.missing?.includes(table)) return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
      const rows = state[table];
      if (op === "insert") {
        if ((opts.uniqueKey ?? ["renter_reminder_sends"]).includes(table) && rows.some((r) => r.key === payload.key)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        const row = { id: `${table}-${++seq}`, attempt_count: 0, ...payload }; rows.push(row);
        return { data: single ? row : [row], error: null };
      }
      const m = rows.filter((r) => f.every((x) => x(r)));
      if (op === "update") { for (const r of m) Object.assign(r, payload); return { data: m.map((r) => ({ ...r })), error: null }; }
      return { data: single ? m[0] ?? null : m, error: null };
    }
    return q;
  }
  return { from, state };
}
const ON = { enabled: true, amount: 50 };
const PREP = JSON.stringify({ reservation: { mode: "required", amount: 50 } });
const BODY = "… Reservation Fee: $50, applied to your first payment …";
function stripe(mode: "ok" | "decline" | "unknown" = "ok") {
  const calls: any[] = []; const credits: any[] = [];
  return {
    calls, credits,
    paymentIntents: { create: async (a: any, o: any) => {
      calls.push({ a, o });
      if (mode === "decline") throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError", code: "card_declined", statusCode: 402 });
      if (mode === "unknown") throw new Error("socket hang up");
      return { id: "pi_1", status: "succeeded" };
    } },
    customers: { createBalanceTransaction: async (c: string, a: any, o: any) => { credits.push({ c, a, o }); return { id: "cbtxn_1" }; } },
  };
}
const seed = (o: { card?: boolean; body?: string; prep?: string | null } = {}) => ({
  agreements: [{ id: "ag1", application_id: "app1", status: "signed", body: o.body ?? BODY, merge_data: o.prep === null ? {} : { _prep: o.prep ?? PREP }, vehicle_id: "v1" }],
  applications: [{ id: "app1", full_name: "Test Renter", email: "t@example.com", phone: "+15555550100", status: "approved", vehicle_id: "v1", stripe_customer_id: o.card === false ? null : "cus_1", stripe_payment_method_id: o.card === false ? null : "pm_1", card_last4: "4242" }],
  rentals: [] as Row[], payments: [] as Row[],
});
const noAudit = { audit: async () => {} };

describe("Reservation Fee switch", () => {
  test("OFF with no row, a malformed row or a non-true value; $50 default", () => {
    expect(rf.readReservationFeeSettings(null)).toEqual({ enabled: false, amount: 50 });
    expect(rf.readReservationFeeSettings({ enabled: "true" }).enabled).toBe(false);
    expect(rf.readReservationFeeSettings({ enabled: true, amount: 9999 })).toEqual({ enabled: true, amount: 50 });
  });
  test("charged only when the signed agreement records AND prints a Reservation Fee", () => {
    expect(rf.signedReservationFee({ body: BODY, merge_data: { _prep: PREP } })).toBe(50);
    expect(rf.signedReservationFee({ body: "no fee wording", merge_data: { _prep: PREP } })).toBeNull();
    expect(rf.signedReservationFee({ body: BODY, merge_data: {} })).toBeNull();
    expect(rf.signedReservationFee({ body: BODY, merge_data: { _prep: JSON.stringify({ reservation: { mode: "none" } }) } })).toBeNull();
  });
});

describe("charge after signing", () => {
  test("switch off: nothing written, no Stripe call", async () => {
    const db = fakeDb(seed()); const s = stripe();
    expect((await rfs.chargeReservationFeeAfterSigning(db, "ag1", { settings: { enabled: false, amount: 50 }, stripe: s, ...noAudit })).status).toBe("off");
    expect(db.state.payments.length + s.calls.length).toBe(0);
  });
  test("agreement without fee wording: never charged", async () => {
    const db = fakeDb(seed({ body: "Rent is weekly." })); const s = stripe();
    expect((await rfs.chargeReservationFeeAfterSigning(db, "ag1", { settings: ON, stripe: s, ...noAudit })).status).toBe("no_fee_on_agreement");
    expect(s.calls.length).toBe(0);
  });
  test("no card on file: row recorded unpaid, no charge, car not held", async () => {
    const db = fakeDb(seed({ card: false })); const s = stripe();
    const o = await rfs.chargeReservationFeeAfterSigning(db, "ag1", { settings: ON, stripe: s, ...noAudit });
    expect(o.status).toBe("no_card");
    expect(db.state.payments[0]).toMatchObject({ type: "fee", reason: "reservation_fee", amount: 50, status: "unpaid" });
    expect(s.calls.length).toBe(0);
  });
  test("paid: row first (type fee, not rent), one off-session charge, the reservation held as applied; repeat is a no-op", async () => {
    const db = fakeDb({ ...seed(), rentals: [{ id: "r1", application_id: "app1", status: "reserved", reservation_deposit_status: "pending" }] }); const s = stripe();
    const o = await rfs.chargeReservationFeeAfterSigning(db, "ag1", { settings: ON, stripe: s, ...noAudit });
    expect(o.status).toBe("paid");
    expect(s.calls.length).toBe(1);
    expect(s.calls[0].a).toMatchObject({ amount: 5000, off_session: true, confirm: true });
    expect(s.calls[0].o.idempotencyKey).toMatch(/^reservation-fee:payments-\d+:attempt:1$/);
    expect(db.state.payments[0]).toMatchObject({ type: "fee", status: "paid", balance_due: 0, rental_id: "r1" });
    expect(db.state.rentals[0]).toMatchObject({ reservation_deposit_status: "applied", reservation_deposit_amount: 50 });
    expect((await rfs.chargeReservationFeeAfterSigning(db, "ag1", { settings: ON, stripe: s, ...noAudit })).status).toBe("already_paid");
    expect(s.calls.length).toBe(1);
    expect(rf.reservationFeeEmailLine(o)).toBe("Your $50.00 Reservation Fee was charged to your card ending in 4242 and is applied in full to your first week. Your car is now held for your pickup.");
  });
  test("declined: failed, car not held; unknown error stays pending (never retried blind)", async () => {
    const db = fakeDb(seed());
    expect((await rfs.chargeReservationFeeAfterSigning(db, "ag1", { settings: ON, stripe: stripe("decline"), ...noAudit })).status).toBe("failed");
    expect(db.state.payments[0].status).toBe("failed");
    const db2 = fakeDb(seed());
    expect((await rfs.chargeReservationFeeAfterSigning(db2, "ag1", { settings: ON, stripe: stripe("unknown"), ...noAudit })).status).toBe("pending");
    expect(db2.state.payments[0].status).toBe("pending");
  });
});

describe("week 1 credit", () => {
  test("paid fee: one -$50 customer balance credit at activation, once", async () => {
    const db = fakeDb({ rentals: [{ id: "r1", application_id: "app1", stripe_customer_id: "cus_1", status: "active" }], payments: [{ id: "p1", driver_id: "app1", reason: "reservation_fee", status: "paid", amount: 50, notes: "reservation_fee:ag1" }] });
    const s = stripe();
    expect((await rfs.applyReservationFeeCredit(db, "r1", { settings: ON, stripe: s, ...noAudit })).status).toBe("credited");
    expect(s.credits[0]).toMatchObject({ c: "cus_1", a: { amount: -5000, currency: "usd" }, o: { idempotencyKey: "reservation-fee-credit:p1" } });
    expect((await rfs.applyReservationFeeCredit(db, "r1", { settings: ON, stripe: s, ...noAudit })).status).toBe("already");
    expect(s.credits.length).toBe(1);
  });
  test("a fee kept for a missed pickup is never credited or reused", async () => {
    const db = fakeDb({ rentals: [{ id: "r1", application_id: "app1", stripe_customer_id: "cus_1" }], payments: [{ id: "p1", driver_id: "app1", reason: "reservation_fee", status: "paid", amount: 50, notes: "reservation_fee:ag1 kept:late_pickup:r0" }] });
    expect((await rfs.applyReservationFeeCredit(db, "r1", { settings: ON, stripe: stripe(), ...noAudit })).status).toBe("none");
    expect(await rfs.paidReservationFee(db, "app1")).toBeNull();
  });
  test("switch off: no credit", async () => {
    expect((await rfs.applyReservationFeeCredit(fakeDb(), "r1", { settings: { enabled: false, amount: 50 }, stripe: stripe(), ...noAudit })).status).toBe("off");
  });
});

describe("FLEET wiring", () => {
  test("agreement prep only when the switch is on", () => {
    expect(fa.fleetAgreementPrep({ enabled: false, amount: 50 }, 0)).toBeUndefined();
    expect(fa.fleetAgreementPrep(ON, 0)).toMatchObject({ reservation: { mode: "required", amount: 50 }, deposit: { mode: "none" } });
    expect(fa.fleetAgreementPrep(ON, 250)).toMatchObject({ deposit: { mode: "required", amount: 250 } });
  });
  test("quote text names the fee only when it is on", () => {
    const base = { vehicle: "2021 Toyota Camry", weekly: 300, surcharge: 0, deposit: 0, startDate: "2026-11-20", location: "the shop" };
    expect(ir.fleetQuoteText(base)).not.toMatch(/Reservation Fee/);
    expect(ir.fleetQuoteText({ ...base, reservationFee: 50 })).toMatch(/A \$50 Reservation Fee is charged to your card on file when you sign and applied to your first week\./);
  });
  test("FLEET pickup booking requires the fee; signing charges before the pay link", () => {
    expect(readFileSync("src/lib/fleet-pickup.server.ts", "utf8")).toMatch(/requireReservationFee: true/);
    const ag = readFileSync("src/lib/agreements.functions.ts", "utf8");
    expect(ag.indexOf("chargeReservationFeeAfterSigning")).toBeGreaterThan(-1);
    expect(ag.indexOf("chargeReservationFeeAfterSigning")).toBeLessThan(ag.indexOf("createInitialPaymentLink"));
    expect(readFileSync("src/lib/rentals.functions.ts", "utf8")).toMatch(/applyReservationFeeCredit/);
  });
});

describe("late pickup release", () => {
  // Pickup 10:00 ET on 2026-11-20 = 15:00Z.
  const at = (iso: string) => () => new Date(iso);
  const lateSeed = (extra: Record<string, Row[]> = {}) => ({
    rentals: [{ id: "r1", status: "reserved", application_id: "app1", vehicle_id: "v1", start_date: "2026-11-20", reservation_note: JSON.stringify({ reservation_details: 1, pickup_time: "10:00", pickup_location: "the shop" }) }],
    vehicles: [{ id: "v1", status: "reserved" }],
    applications: [{ id: "app1", full_name: "Test Renter", email: "t@example.com", phone: "+15555550100", status: "approved", vehicle_id: "v1" }],
    payments: [{ id: "p1", driver_id: "app1", reason: "reservation_fee", status: "paid", amount: 50, notes: "reservation_fee:ag1" }],
    renter_reminder_sends: [], ...extra,
  });
  const io = () => { const sms: any[] = []; const emails: any[] = []; const alerts: any[] = [];
    return { sms, emails, alerts, sendSms: async (a: any) => { sms.push(a); return { ok: true }; }, sendEmail: async (a: any) => { emails.push(a); return { ok: true }; }, teamAlert: async (_: any, a: any) => { alerts.push(a); return { status: "sent" }; }, audit: async () => {}, feeEnabled: true }; };

  test("is a default-OFF automation", () => {
    expect(cat.AUTOMATIONS.find((a: any) => a.key === "late_pickup_release")?.defaultOn).toBe(false);
  });
  test("switch off: nothing released", async () => {
    const db = fakeDb(lateSeed()); const x = io();
    await lp.runLatePickups(db, { ...x, gate: "off", now: at("2026-11-20T15:20:00Z") });
    expect(db.state.rentals[0].status).toBe("reserved");
    expect(x.sms.length + x.alerts.length).toBe(0);
  });
  test("14 minutes late: still held", async () => {
    const db = fakeDb(lateSeed()); const x = io();
    await lp.runLatePickups(db, { ...x, gate: "send", now: at("2026-11-20T15:14:00Z") });
    expect(db.state.rentals[0].status).toBe("reserved");
  });
  test("15+ minutes, no checklist: released once, car Available, fee kept, staff alert, one renter text", async () => {
    const db = fakeDb(lateSeed()); const x = io();
    const out = await lp.runLatePickups(db, { ...x, gate: "send", now: at("2026-11-20T15:16:00Z") });
    expect(out.outcomes).toEqual([{ rental_id: "r1", status: "released", detail: "sms" }]);
    expect(db.state.rentals[0].status).toBe("cancelled");
    expect(db.state.vehicles[0].status).toBe("available");
    expect(db.state.applications[0].vehicle_id).toBeNull();
    expect(db.state.payments[0]).toMatchObject({ status: "paid" });
    expect(db.state.payments[0].notes).toMatch(/kept:late_pickup:r1/);
    expect(x.alerts.map((a) => a.kind)).toEqual(["late_pickup"]);
    expect(JSON.stringify(x.alerts)).not.toMatch(/5555550100/);
    expect(x.sms[0].body).toBe("Real Rentals: We held your car until 15 minutes after your 10:00 AM ET pickup, and it has now been released. Your $50 Reservation Fee is non-refundable for a missed pickup. To rebook, reply here or call (888) 833-8280. Reply STOP to opt out.");
    await lp.runLatePickups(db, { ...x, gate: "send", now: at("2026-11-20T15:21:00Z") });
    expect(x.sms.length).toBe(1);
  });
  test("the rep started the pickup checklist: never released", async () => {
    const db = fakeDb(lateSeed({ pickup_handovers: [{ rental_id: "r1" }] })); const x = io();
    await lp.runLatePickups(db, { ...x, gate: "send", now: at("2026-11-20T15:30:00Z") });
    expect(db.state.rentals[0].status).toBe("reserved");
  });
  test("team alert table missing: held, nothing released (staff must hear about every release)", async () => {
    const db = fakeDb(lateSeed(), { missing: ["team_alert_sends"] }); const x = io();
    const { teamAlert, ...rest } = x;
    await lp.runLatePickups(db, { ...rest, gate: "send", now: at("2026-11-20T15:20:00Z") });
    expect(db.state.rentals[0].status).toBe("reserved");
    expect(x.sms.length).toBe(0);
  });
  test("no claim table: nothing released", async () => {
    const db = fakeDb(lateSeed(), { missing: ["renter_reminder_sends"] }); const x = io();
    const out = await lp.runLatePickups(db, { ...x, gate: "send", now: at("2026-11-20T15:20:00Z") });
    expect(out.ok).toBe(false);
    expect(db.state.rentals[0].status).toBe("reserved");
  });
  test("fee paid after booking: reservation marked held", async () => {
    const s = lateSeed(); s.rentals[0] = { ...s.rentals[0], reservation_deposit_required: true, reservation_deposit_status: "pending" };
    const db = fakeDb(s); const x = io();
    const out = await lp.runLatePickups(db, { ...x, gate: "off", now: at("2026-11-20T13:00:00Z") });
    expect(out.outcomes).toEqual([{ rental_id: "r1", status: "fee_hold" }]);
    expect(db.state.rentals[0].reservation_deposit_status).toBe("applied");
  });
});
