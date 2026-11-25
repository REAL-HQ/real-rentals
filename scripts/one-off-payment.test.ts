// One-off Stripe payments the app did not create (Payment Links, Dashboard
// Checkout, manual charges): the webhook records them against exactly one
// rental or flags them for staff, and Collections / Revenue count them once an
// app row owns the intent. All data is synthetic; no Stripe or network calls.
//
// Run: bun test scripts/one-off-payment.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";

import { postVerifiedPaymentWebhook } from "../src/routes/api/public/payments/webhook.ts";
import { allocateRentPayment, appOwnsPayment, nextDueAfter, oneOffIdentity, oneOffRowType, pickRental, exactILike, rentWeekFor, UNMATCHED_TITLE, weeksOf } from "../src/lib/one-off-payment.ts";
import { isRentRowCovered, onlyLateFeesLeft, rentStanding } from "../src/lib/rent-standing.ts";
import { consolidatedRevenue, verifyCollectedCharges } from "../src/lib/stripe-collections.ts";
import { loadAppLinkedPayments } from "../src/lib/stripe-collections.server.ts";

type Row = Record<string, any>;
const RENTAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RENTAL2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const APP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APP2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUS = "cus_TESTrenter01";
const EMAIL = "renter.one@example.com";
const PI = "pi_TESTlink01";
const CH = "ch_TESTlink01";
const CS = "cs_test_link01";
const PLINK = "plink_TESTlink01";
const PAID_AT = 1794881029; // Nov 16 2026 9:03 PM ET

function likeToRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") { out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (c === "%") out += ".*"; else if (c === "_") out += "."; else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

/** PostgREST-shaped fake with the unique payment-intent index. */
function fakeDb(seed: Record<string, Row[]>) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let nextId = 1;
  function from(table: string) {
    state[table] ??= [];
    let op: "select" | "insert" | "update" = "select";
    let payload: any = null;
    let single = false;
    let max = Infinity;
    const filters: ((r: Row) => boolean)[] = [];
    const b: any = {
      select() { return b; },
      insert(r: Row) { op = "insert"; payload = r; return b; },
      update(p: Row) { op = "update"; payload = p; return b; },
      eq(c: string, v: any) { filters.push((r) => r[c] === v); return b; },
      neq(c: string, v: any) { filters.push((r) => r[c] !== v); return b; },
      in(c: string, vs: any[]) { filters.push((r) => vs.includes(r[c])); return b; },
      is(c: string, v: any) { filters.push((r) => (r[c] ?? null) === v); return b; },
      not(c: string, o: string, v: any) { if (o === "is" && v === null) filters.push((r) => r[c] != null); return b; },
      ilike(c: string, p: string) { const re = likeToRegex(p); filters.push((r) => typeof r[c] === "string" && re.test(r[c])); return b; },
      or() { return b; },
      maybeSingle() { single = true; return b; },
      limit(n: number) { max = n; return b; },
      order() { return b; },
      then(res: any, rej: any) { return Promise.resolve().then(run).then(res, rej); },
    };
    function run() {
      const hit = () => state[table].filter((r) => filters.every((f) => f(r)));
      if (op === "insert") {
        if (table === "payments" && payload.stripe_payment_intent_id && state.payments.some((r) => r.stripe_payment_intent_id === payload.stripe_payment_intent_id)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        const row = { id: `gen-${nextId++}`, ...payload };
        state[table].push(row);
        return { data: [row], error: null };
      }
      if (op === "update") { const h = hit(); for (const r of h) Object.assign(r, payload); return { data: h.map((r) => ({ id: r.id })), error: null }; }
      const h = hit().slice(0, max);
      if (table === "payments") for (const r of h) r.rentals = state.rentals?.find((x) => x.id === r.rental_id) ?? null;
      return single ? { data: h[0] ?? null, error: null } : { data: h, error: null };
    }
    return b;
  }
  return { from, rpc: async () => ({ data: null, error: null }), _state: state };
}

const rental = (over: Row = {}): Row => ({ id: RENTAL, application_id: APP, vehicle_id: "veh-1", status: "active", stripe_customer_id: CUS, stripe_subscription_id: "sub_TEST1", ...over });
const app = (over: Row = {}): Row => ({ id: APP, email: "Renter.One@Example.com", stripe_customer_id: CUS, ...over });

function session(over: Row = {}): Row {
  return {
    id: CS, object: "checkout.session", mode: "payment", payment_status: "paid", status: "complete",
    customer: null, customer_details: { email: EMAIL, name: "Test Renter" }, payment_intent: PI, payment_link: PLINK,
    subscription: null, invoice: null, amount_total: 5000, currency: "usd", created: PAID_AT - 50,
    metadata: { customer: CUS, purpose: "1-day rental Nov 16, return Nov 17", renter: "Test Renter" }, ...over,
  };
}
function intent(over: Row = {}): Row {
  return { id: PI, object: "payment_intent", status: "succeeded", amount: 5000, amount_received: 5000, currency: "usd", customer: null, metadata: {}, latest_charge: CH, created: PAID_AT - 2, description: null, ...over };
}
function charge(over: Row = {}): Row {
  return {
    id: CH, object: "charge", paid: true, captured: true, status: "succeeded", amount: 5000, amount_captured: 5000, currency: "usd",
    customer: null, payment_intent: PI, metadata: {}, created: PAID_AT, description: null,
    billing_details: { email: EMAIL }, receipt_url: "https://pay.stripe.com/receipts/test", payment_method_details: { type: "card" }, ...over,
  };
}

/** Read-only Stripe stub. Counts calls; `fail` makes every read throw. */
function stripeStub(o: { session?: Row | null; pi?: Row; charge?: Row; invoicePayments?: Row[]; fail?: boolean; link?: Row | null; linkFails?: boolean } = {}) {
  const calls: string[] = [];
  const guard = (name: string) => { calls.push(name); if (o.fail) throw new Error("stripe down"); };
  return {
    calls,
    paymentIntents: { retrieve: async () => { guard("pi"); return o.pi ?? intent(); } },
    charges: { retrieve: async () => { guard("charge"); return o.charge ?? charge(); } },
    checkout: { sessions: { list: async () => { guard("sessions"); return { data: o.session === null ? [] : [o.session ?? session()] }; } } },
    invoicePayments: { list: async () => { guard("invoicePayments"); return { data: o.invoicePayments ?? [] }; } },
    paymentLinks: { retrieve: async (id: string) => { guard("paymentLink"); if (o.linkFails) throw new Error("link read failed"); return o.link === undefined ? { id, metadata: {} } : o.link; } },
  };
}

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const w = console.warn, e = console.error, i = console.info;
  console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.info = i; }
};
const send = (type: string, object: Row, db: any, stripe: any) => quiet(() => postVerifiedPaymentWebhook({ type, data: { object } }, db, "live", { stripe }));
const paymentsFor = (db: any) => db._state.payments.filter((r: Row) => r.stripe_payment_intent_id === PI);
const unmatched = (db: any) => (db._state.notifications ?? []).filter((n: Row) => n.title === UNMATCHED_TITLE);

describe("one-off payment helpers", () => {
  it("treats app flows, invoices and subscriptions as app-owned", () => {
    assert.equal(appOwnsPayment({ paymentIntent: intent({ metadata: { paymentIds: "x" } }) }), true);
    assert.equal(appOwnsPayment({ paymentIntent: intent({ metadata: { reason: "reservation_fee" } }) }), true);
    assert.equal(appOwnsPayment({ session: session({ mode: "subscription" }) }), true);
    assert.equal(appOwnsPayment({ session: session({ invoice: "in_1" }) }), true);
    assert.equal(appOwnsPayment({ charge: charge({ description: "Subscription update" }) }), true);
    assert.equal(appOwnsPayment({ paymentIntent: intent(), invoiceLinked: true }), true);
    assert.equal(appOwnsPayment({ session: session(), paymentIntent: intent(), charge: charge() }), false);
  });

  it("gathers customer, email, purpose and timing from a Payment Link payment", () => {
    const id = oneOffIdentity({ paymentIntent: intent(), session: session(), charge: charge() })!;
    assert.equal(id.paymentIntentId, PI);
    assert.equal(id.chargeId, CH);
    assert.equal(id.paymentLinkId, PLINK);
    assert.deepEqual(id.customerIds, [CUS]);
    assert.deepEqual(id.emails, [EMAIL]);
    assert.equal(id.amountCents, 5000);
    assert.equal(id.paidAt, PAID_AT);
    assert.equal(id.purpose, "1-day rental Nov 16, return Nov 17");
    assert.equal(id.cardPayment, true);
  });

  it("maps types and picks exactly one rental", () => {
    assert.equal(oneOffRowType(null), "fee");
    assert.equal(oneOffRowType(null, { activeRental: true }), "rent");
    assert.equal(oneOffRowType("toll", { activeRental: true }), "toll");
    assert.equal(oneOffRowType("anything", { activeRental: true }), "fee");
    assert.equal(rentWeekFor("2026-11-18", ["2026-11-16"]), "2026-11-16", "Schrita: Nov 18 payment pays the open Nov 16 week");
    assert.equal(rentWeekFor("2026-11-18", ["2026-10-01"]), "2026-11-18", "a week older than 21 days is not guessed");
    assert.equal(rentWeekFor("2026-11-18", ["2026-11-16"], { dailyPlan: true }), "2026-11-18", "daily rent keeps the paid day");
    assert.equal(oneOffRowType("late_fee"), "late_fee");
    assert.equal(oneOffRowType("anything"), "fee");
    assert.equal(oneOffRowType("daily_50", { activeRental: true }), "rent");
    assert.equal(oneOffRowType("daily_rent"), "rent");
    assert.equal(oneOffRowType("weekly_rent", { activeRental: false }), "rent");
    assert.equal(oneOffRowType("cleaning", { activeRental: true }), "fee");
    assert.equal(pickRental([rental(), rental({ id: RENTAL2 })], { explicit: false }).ambiguous, true);
    assert.equal(pickRental([rental({ status: "closed" })], { explicit: false }).rental, null);
    assert.equal(pickRental([rental({ status: "closed" })], { explicit: true }).rental?.id, RENTAL);
    assert.equal(exactILike("a_b%c@x.com"), "a\\_b\\%c@x.com");
  });
});

describe("payment link identifiers", () => {
  it("reads lead, plate and date from any metadata source", async () => {
    const { applicationIdsOf, platesOf, forDateOf, dailyDueFor, normalizePlate } = await import("../src/lib/one-off-payment.ts");
    assert.deepEqual(applicationIdsOf({ metadata: { lead_id: APP.toUpperCase() } }, { metadata: { application_id: APP2 } }), [APP, APP2]);
    assert.deepEqual(applicationIdsOf({ metadata: { lead_id: "not-a-uuid" } }), []);
    assert.deepEqual(platesOf({ metadata: { plate: "siv z88" } }, { metadata: { vehicle: "SIVZ88" } }), ["SIVZ88"]);
    assert.equal(normalizePlate("RR"), null);
    assert.equal(forDateOf({ metadata: { purpose: "x" } }, { metadata: { date: "2026-11-20" } }), "2026-11-20");
    assert.equal(forDateOf({ metadata: { for_date: "2026-11-19", date: "2026-11-20" } }), "2026-11-19");
    assert.equal(forDateOf({ metadata: { date: "Nov 20" } }), null);
    assert.equal(dailyDueFor("2026-11-21", "2026-11-20"), "2026-11-20");
    assert.equal(dailyDueFor("2026-11-21", "2026-11-22"), "2026-11-22");
    assert.equal(dailyDueFor("2026-11-21", "2026-11-01"), "2026-11-21", "a stale date falls back to the paid day");
    assert.equal(dailyDueFor("2026-11-21", null), "2026-11-21");
  });
});

describe("payments webhook — one-off payments", () => {
  it("records a paid Payment Link once across checkout, charge and intent events (matched by metadata.customer)", async () => {
    const db = fakeDb({ rentals: [rental()], applications: [app()], payments: [], notifications: [] });
    const stripe = stripeStub();
    assert.equal((await send("checkout.session.completed", session(), db, stripe)).status, 200);
    assert.equal((await send("charge.succeeded", charge(), db, stripe)).status, 200);
    assert.equal((await send("payment_intent.succeeded", intent(), db, stripe)).status, 200);
    const rows = paymentsFor(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rental_id, RENTAL);
    assert.equal(rows[0].driver_id, APP);
    assert.equal(rows[0].vehicle_id, "veh-1");
    assert.equal(rows[0].amount, 50);
    assert.equal(rows[0].balance_due, 0);
    assert.equal(rows[0].status, "paid");
    assert.equal(rows[0].type, "rent", "a renter's no-reason Payment Link on an active rental is rent (Dolmar, Nov 19)");
    assert.equal(rows[0].paid_date, "2026-11-16", "paid date is the Eastern day");
    assert.equal(rows[0].stripe_charge_id, CH);
    assert.equal(rows[0].stripe_customer_id, CUS);
    assert.equal(rows[0].notified_status, "paid", "no app receipt for a Stripe-receipted payment");
    assert.equal(rows[0].reason, "1-day rental Nov 16, return Nov 17");
    assert.equal(unmatched(db).length, 0);
  });

  it("a $350 rent Payment Link pays the open week and flags its still-open Stripe invoice (Schrita, Nov 18)", async () => {
    const open = { id: "rent-1116", rental_id: RENTAL, type: "rent", status: "overdue", amount: 350, balance_due: 400, late_fees: 50, due_date: "2026-11-15", stripe_invoice_id: "in_TESTopen" };
    const db = fakeDb({ rentals: [rental()], applications: [app()], payments: [open], notifications: [], app_settings: [] });
    const big = { amount_total: 35000, metadata: { customer: CUS } };
    const stripe = stripeStub({ session: session(big), pi: intent({ amount: 35000, amount_received: 35000 }), charge: charge({ amount: 35000, amount_captured: 35000 }) });
    assert.equal((await send("checkout.session.completed", session(big), db, stripe)).status, 200);
    const rows = paymentsFor(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "rent");
    assert.equal(rows[0].due_date, "2026-11-15", "applied to the open week, not the paid day");
    assert.equal(rows[0].paid_date, "2026-11-16");
    const notes = db._state.notifications.filter((n: Row) => n.title === "Open Stripe Invoice After Rent Paid");
    assert.equal(notes.length, 1);
    assert.match(notes[0].body, /in_TESTopen/);
    const week = db._state.payments.find((r: Row) => r.id === "rent-1116");
    assert.equal(week.status, "overdue", "late fees are left, so the row stays open");
    assert.equal(week.balance_due, 50, "the rent is paid; only the $50 late fee is still owed");
    assert.match(notes[0].body, /paid out of band/);
    assert.doesNotMatch(notes[0].body, /Void it/);
  });

  it("a daily-plan renter's $50 stays on the paid day and raises no invoice notice", async () => {
    const open = { id: "rent-1116", rental_id: RENTAL, type: "rent", status: "overdue", amount: 350, due_date: "2026-11-15", stripe_invoice_id: "in_TESTopen" };
    const db = fakeDb({ rentals: [rental()], applications: [app()], payments: [open], notifications: [], app_settings: [{ key: "daily_rent_plans", value: { [RENTAL]: { dailyRate: 50, startsOn: "2026-11-15" } } }] });
    assert.equal((await send("checkout.session.completed", session(), db, stripeStub())).status, 200);
    const rows = paymentsFor(db);
    assert.equal(rows[0].type, "rent");
    assert.equal(rows[0].due_date, "2026-11-16");
    assert.equal(db._state.notifications.filter((n: Row) => n.title === "Open Stripe Invoice After Rent Paid").length, 0);
  });

  it("matches by email when the payment carries no customer", async () => {
    const db = fakeDb({ rentals: [rental({ stripe_customer_id: null })], applications: [app({ stripe_customer_id: null })], payments: [], notifications: [] });
    const s = session({ metadata: {} });
    const stripe = stripeStub({ session: s });
    await send("charge.succeeded", charge(), db, stripe);
    const rows = paymentsFor(db);
    assert.equal(rows.length, 1);
    assert.match(rows[0].notes, /matched by email/);
  });

  // Regina, Nov 21 2026: FLEET's daily $50 link carried renter/plate/date only; the
  // charge came through Link with no customer and no metadata.
  const OTHER_EMAIL = "someone.else@example.com";
  const PLATE_VEH = { id: "veh-1", license_plate: "SIVZ88" };
  const DAILY = { key: "daily_rent_plans", value: { [RENTAL]: { dailyRate: 50, startsOn: "2026-11-16" } } };
  const NOV21_0031 = 1795239099; // 12:31 AM ET Nov 21 2026

  it("matches a link by its plate when nothing else ties it to the renter, and a daily link pays its own date", async () => {
    const db = fakeDb({ rentals: [rental({ stripe_customer_id: null })], applications: [app({ stripe_customer_id: null })], vehicles: [PLATE_VEH], payments: [], notifications: [], app_settings: [DAILY] });
    const s = session({ customer_details: { email: OTHER_EMAIL }, created: NOV21_0031 - 30, metadata: { date: "2026-11-20", plate: "SIVZ88", renter: "Regina Littles" } });
    const ch = charge({ created: NOV21_0031, billing_details: { email: OTHER_EMAIL }, payment_method_details: { type: "link" } });
    const stripe = stripeStub({ session: s, charge: ch, pi: intent({ created: NOV21_0031 - 2 }) });
    assert.equal((await send("checkout.session.completed", s, db, stripe)).status, 200);
    const rows = paymentsFor(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rental_id, RENTAL);
    assert.equal(rows[0].type, "rent");
    assert.equal(rows[0].paid_date, "2026-11-21");
    assert.equal(rows[0].due_date, "2026-11-20", "the Nov 20 link pays Nov 20 even when paid after midnight");
    assert.equal(rows[0].reason, "Rent for 2026-11-20");
    assert.match(rows[0].notes, /matched by plate/);
    assert.equal(unmatched(db).length, 0);
  });

  it("a daily_50 link is rent for the date the link covers", async () => {
    const db = fakeDb({ rentals: [rental({ stripe_customer_id: null })], applications: [app({ stripe_customer_id: null })], vehicles: [PLATE_VEH], payments: [], notifications: [], app_settings: [DAILY] });
    const s = session({
      customer_details: { email: OTHER_EMAIL },
      created: NOV21_0031 - 30,
      metadata: { date: "2026-11-20", plate: "SIVZ88", reason: "daily_50", rental_id: RENTAL },
    });
    const ch = charge({ created: NOV21_0031, billing_details: { email: OTHER_EMAIL } });
    const stripe = stripeStub({ session: s, charge: ch, pi: intent({ created: NOV21_0031 - 2 }) });
    assert.equal((await send("checkout.session.completed", s, db, stripe)).status, 200);
    const rows = paymentsFor(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "rent");
    assert.equal(rows[0].due_date, "2026-11-20");
    assert.equal(rows[0].amount, 50);
  });

  it("weekly_rent with weeks metadata is rent dated to the first week", async () => {
    const db = fakeDb({ rentals: [rental({ weekly_rate: 350, next_payment_due: "2026-11-12" })], applications: [app()], payments: [], notifications: [], app_settings: [] });
    const s = session({
      amount_total: 35000,
      metadata: { rental_id: RENTAL, reason: "weekly_rent", weeks: "2026-11-12,2026-11-19" },
    });
    const stripe = stripeStub({
      session: s,
      pi: intent({ amount: 35000, amount_received: 35000 }),
      charge: charge({ amount: 35000, amount_captured: 35000 }),
    });
    assert.equal((await send("checkout.session.completed", s, db, stripe)).status, 200);
    const rows = paymentsFor(db);
    assert.equal(rows[0].type, "rent");
    assert.equal(rows[0].due_date, "2026-11-12");
  });

  it("matches by lead_id on the link (no customer, unknown email)", async () => {
    const db = fakeDb({ rentals: [rental({ stripe_customer_id: null })], applications: [app({ stripe_customer_id: null, email: "x@example.com" })], payments: [], notifications: [] });
    const s = session({ customer_details: { email: OTHER_EMAIL }, metadata: { lead_id: APP, renter: "Test Renter" } });
    await send("checkout.session.completed", s, db, stripeStub({ session: s, charge: charge({ billing_details: { email: OTHER_EMAIL } }) }));
    const rows = paymentsFor(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rental_id, RENTAL);
    assert.match(rows[0].notes, /matched by lead/);
  });

  it("reads the Payment Link's own metadata when the session carries none", async () => {
    const db = fakeDb({ rentals: [rental({ stripe_customer_id: null }), rental({ id: RENTAL2, application_id: APP2, stripe_customer_id: null })], applications: [], payments: [], notifications: [] });
    const s = session({ customer_details: { email: OTHER_EMAIL }, metadata: {} });
    const stripe = stripeStub({ session: s, charge: charge({ billing_details: { email: OTHER_EMAIL } }), link: { id: PLINK, metadata: { rental_id: RENTAL2, reason: "rent" } } });
    await send("checkout.session.completed", s, db, stripe);
    const rows = paymentsFor(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rental_id, RENTAL2);
    assert.equal(rows[0].type, "rent");
    assert.match(rows[0].notes, /matched by metadata/);
  });

  it("a failed Payment Link read still records by the other identifiers", async () => {
    const db = fakeDb({ rentals: [rental()], applications: [app()], payments: [], notifications: [] });
    const stripe = stripeStub({ linkFails: true });
    assert.equal((await send("checkout.session.completed", session(), db, stripe)).status, 200);
    assert.equal(paymentsFor(db).length, 1);
  });

  it("payment_intent_data.metadata.rental_id (snake_case) on the intent is recorded, not dropped", async () => {
    const db = fakeDb({ rentals: [rental({ stripe_customer_id: null }), rental({ id: RENTAL2, application_id: APP2, stripe_customer_id: null })], applications: [], payments: [], notifications: [] });
    const pi = intent({ metadata: { rental_id: RENTAL2, lead_id: APP2, reason: "rent", for_date: "2026-11-16" } });
    const s = session({ customer_details: { email: OTHER_EMAIL }, metadata: {} });
    const stripe = stripeStub({ session: s, pi, charge: charge({ billing_details: { email: OTHER_EMAIL } }) });
    assert.equal((await send("payment_intent.succeeded", pi, db, stripe)).status, 200);
    assert.equal((await send("checkout.session.completed", s, db, stripe)).status, 200);
    const rows = paymentsFor(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rental_id, RENTAL2);
    assert.equal(rows[0].type, "rent");
    assert.equal(rows[0].driver_id, APP2);
  });

  it("an unmatched link names the renter and plate in the staff notice", async () => {
    const db = fakeDb({ rentals: [], applications: [], vehicles: [], payments: [], notifications: [] });
    const s = session({ customer_details: { email: OTHER_EMAIL }, metadata: { plate: "ZZZ999", renter: "Nobody Known" } });
    await send("checkout.session.completed", s, db, stripeStub({ session: s, charge: charge({ billing_details: { email: OTHER_EMAIL } }) }));
    assert.equal(paymentsFor(db).length, 0);
    assert.equal(unmatched(db).length, 1);
    assert.match(unmatched(db)[0].body, /matches no rental \(renter Nobody Known, plate ZZZ999\)/);
  });

  it("an explicit session metadata.rentalId wins", async () => {
    const db = fakeDb({ rentals: [rental(), rental({ id: RENTAL2, application_id: APP2 })], applications: [app()], payments: [], notifications: [] });
    const s = session({ metadata: { rentalId: RENTAL2, customer: CUS } });
    await send("checkout.session.completed", s, db, stripeStub({ session: s }));
    assert.equal(paymentsFor(db)[0]?.rental_id, RENTAL2);
  });

  it("an unmatched payment writes no row, warns, and notifies staff once", async () => {
    const db = fakeDb({ rentals: [rental({ stripe_customer_id: "cus_other" })], applications: [app({ email: "someone@example.com", stripe_customer_id: "cus_other" })], payments: [], notifications: [] });
    const stripe = stripeStub();
    await send("checkout.session.completed", session(), db, stripe);
    await send("charge.succeeded", charge(), db, stripe);
    await send("payment_intent.succeeded", intent(), db, stripe);
    assert.equal(paymentsFor(db).length, 0);
    const n = unmatched(db);
    assert.equal(n.length, 1);
    assert.match(n[0].body, /\$50\.00 paid via payment link plink_TESTlink01 \(pi_TESTlink01\) matches no rental/);
  });

  it("two active rentals for the same customer are ambiguous: no row, staff notice", async () => {
    const db = fakeDb({ rentals: [rental(), rental({ id: RENTAL2 })], applications: [app()], payments: [], notifications: [] });
    await send("checkout.session.completed", session(), db, stripeStub());
    assert.equal(paymentsFor(db).length, 0);
    assert.match(unmatched(db)[0].body, /more than one rental/);
  });

  it("never reads Stripe for an app-created intent", async () => {
    const db = fakeDb({ rentals: [rental()], applications: [app()], payments: [{ id: "p1", status: "pending", balance_due: 50, failure_reason: null, notified_status: null }], notifications: [] });
    const stripe = stripeStub({ fail: true });
    const r = await send("payment_intent.succeeded", intent({ metadata: { paymentIds: "p1" } }), db, stripe);
    assert.equal(r.status, 200);
    // The only Stripe read allowed is the
    // best-effort receipt-link lookup (portal history), and its failure
    // changes nothing.
    assert.ok(stripe.calls.every((c: string) => c === "charge"), String(stripe.calls));
  });

  it("skips an invoice-paid charge (invoice path owns it)", async () => {
    const db = fakeDb({ rentals: [rental()], applications: [app()], payments: [], notifications: [] });
    const stripe = stripeStub({ session: null, invoicePayments: [{ id: "inpay_1" }] });
    await send("charge.succeeded", charge({ customer: CUS }), db, stripe);
    assert.equal(paymentsFor(db).length, 0);
    assert.equal(unmatched(db).length, 0);
  });

  it("a manual Dashboard charge with a customer and no session is recorded", async () => {
    const db = fakeDb({ rentals: [rental()], applications: [app()], payments: [], notifications: [] });
    const stripe = stripeStub({ session: null, pi: intent({ customer: CUS }) });
    await send("charge.succeeded", charge({ customer: CUS, billing_details: {} }), db, stripe);
    assert.equal(paymentsFor(db).length, 1);
    assert.match(paymentsFor(db)[0].notes, /matched by customer/);
  });

  it("a Stripe read failure retries checkout (400) but not the charge/intent events (200)", async () => {
    const db = fakeDb({ rentals: [rental()], applications: [app()], payments: [], notifications: [] });
    const stripe = stripeStub({ fail: true });
    assert.equal((await send("checkout.session.completed", session(), db, stripe)).status, 400);
    assert.equal((await send("charge.succeeded", charge(), db, stripe)).status, 200);
    assert.equal(paymentsFor(db).length, 0);
  });

  it("an unpaid session (async method pending) is not recorded", async () => {
    const db = fakeDb({ rentals: [rental()], applications: [app()], payments: [], notifications: [] });
    const stripe = stripeStub();
    await send("checkout.session.completed", session({ payment_status: "unpaid" }), db, stripe);
    assert.equal(paymentsFor(db).length, 0);
    assert.deepEqual(stripe.calls, []);
  });
});

describe("collections — one-off charges owned by an app row", () => {
  const window = { gte: PAID_AT - 86400, lt: PAID_AT + 86400 };
  const unverified = (over: Row = {}) => ({
    id: CH, customerId: null, paymentIntentId: PI, currency: "usd", amountCaptured: 5000, paid: true, captured: true, status: "succeeded", created: PAID_AT,
    balance: { created: PAID_AT, currency: "usd", amount: 5000, fee: 175 }, ...over,
  });
  const base = { refunds: [], invoicePayments: [], invoices: [], subscriptions: [], window };

  it("without an app row the charge keeps collections incomplete (Revenue Unavailable)", () => {
    const v = verifyCollectedCharges({ ...base, charges: [unverified()] as any });
    assert.equal(v.collectionsComplete, false);
    assert.equal(consolidatedRevenue({ internalNonStripe: 0, report: { collectionsComplete: v.collectionsComplete, totals: null } as any }).coverage, "Unavailable");
  });

  it("an app row for the intent verifies it under the rental's customer", () => {
    const v = verifyCollectedCharges({ ...base, charges: [unverified()] as any, appLinkedPayments: [{ intentId: PI, chargeId: CH, rentalId: RENTAL, customerId: CUS }] });
    assert.equal(v.collectionsComplete, true);
    assert.equal(v.charges.length, 1);
    assert.equal(v.charges[0].customerId, CUS);
    const report = { collectionsComplete: true, totals: [{ currency: "usd", gross: 5000, refunds: 0, fees: 175, net: 4825, successful: 1, failed: 0 }] } as any;
    assert.deepEqual(consolidatedRevenue({ internalNonStripe: 0, report }), { amount: 48.25, coverage: "Partial" });
  });

  it("a rental with no Stripe customer still owns it", () => {
    const v = verifyCollectedCharges({ ...base, charges: [unverified()] as any, appLinkedPayments: [{ intentId: PI, chargeId: null, rentalId: RENTAL, customerId: null }] });
    assert.equal(v.collectionsComplete, true);
    assert.equal(v.charges[0].customerId, `rental:${RENTAL}`);
  });

  it("a contradicting customer, a different charge, or two rows stay unverified", () => {
    const link = { intentId: PI, chargeId: CH, rentalId: RENTAL, customerId: CUS };
    assert.equal(verifyCollectedCharges({ ...base, charges: [unverified({ customerId: "cus_other" })] as any, appLinkedPayments: [link] }).collectionsComplete, false);
    assert.equal(verifyCollectedCharges({ ...base, charges: [unverified()] as any, appLinkedPayments: [{ ...link, chargeId: "ch_other" }] }).collectionsComplete, false);
    assert.equal(verifyCollectedCharges({ ...base, charges: [unverified()] as any, appLinkedPayments: [link, { ...link, rentalId: RENTAL2 }] }).collectionsComplete, false);
  });

  it("loadAppLinkedPayments reads only paid, invoice-less, rental-linked rows for the given intents", async () => {
    const db = fakeDb({
      rentals: [rental()],
      payments: [
        { stripe_payment_intent_id: PI, stripe_charge_id: CH, rental_id: RENTAL, stripe_customer_id: null, stripe_invoice_id: null, status: "paid" },
        { stripe_payment_intent_id: "pi_inv", stripe_charge_id: null, rental_id: RENTAL, stripe_invoice_id: "in_1", status: "paid" },
        { stripe_payment_intent_id: "pi_failed", stripe_charge_id: null, rental_id: RENTAL, stripe_invoice_id: null, status: "failed" },
      ],
    });
    const out = await loadAppLinkedPayments([PI, "pi_inv", "pi_failed"], db);
    assert.deepEqual(out, [{ intentId: PI, chargeId: CH, rentalId: RENTAL, customerId: CUS }]);
    assert.deepEqual(await quiet(() => loadAppLinkedPayments([PI], { from() { throw new Error("db down"); } })), []);
  });
});

// Damon, Nov 22 2026: one $1,050 Payment Link for the weeks of Nov 5, 12 and 19 was
// recorded on Nov 5 only; Nov 12 stayed Overdue and Nov 19 was never paid.
describe("multi-week rent Payment Link", () => {
  const NOV22_0835 = 1795354502;
  const damonRental = (over: Row = {}) => rental({ weekly_rate: 350, next_payment_due: "2026-11-12", payment_status: "past_due", ...over });
  const nov5 = () => ({ id: "rent-1105", rental_id: RENTAL, type: "rent", status: "failed", amount: 350, balance_due: 350, late_fees: 0, due_date: "2026-11-05", stripe_invoice_id: "in_TEST1105" });
  const nov12 = () => ({ id: "rent-1112", rental_id: RENTAL, type: "rent", status: "overdue", amount: 350, balance_due: 500, late_fees: 150, due_date: "2026-11-12", stripe_invoice_id: "in_TEST1112" });
  const big = (meta: Row) => {
    const s = session({ amount_total: 105000, created: NOV22_0835 - 60, metadata: { rental_id: RENTAL, reason: "rent", plate: "CZ06DA", ...meta } });
    const stripe = stripeStub({ session: s, pi: intent({ amount: 105000, amount_received: 105000, created: NOV22_0835 - 2 }), charge: charge({ amount: 105000, amount_captured: 105000, created: NOV22_0835 }) });
    return { s, stripe };
  };
  const row = (db: any, id: string) => db._state.payments.find((r: Row) => r.id === id);

  it("records the charge once, closes the paid weeks, keeps unwaived late fees and moves next due past the last week", async () => {
    const db = fakeDb({ rentals: [damonRental()], applications: [app()], payments: [nov5(), nov12()], notifications: [], app_settings: [], rent_late_fee_waivers: [] });
    const { s, stripe } = big({ weeks: "2026-11-05,2026-11-12,2026-11-19" });
    assert.equal((await send("checkout.session.completed", s, db, stripe)).status, 200);
    await send("charge.succeeded", charge({ amount: 105000, amount_captured: 105000, created: NOV22_0835 }), db, stripe);
    const rows = paymentsFor(db);
    assert.equal(rows.length, 1, "one row per charge, so collected and revenue count it once");
    assert.equal(rows[0].amount, 1050);
    assert.equal(rows[0].due_date, "2026-11-05");
    assert.equal(rows[0].notified_status, "paid", "no receipt from the app");
    assert.equal(row(db, "rent-1105").status, "void", "Nov 5 rent paid, no late fee: closed, not left Failed");
    assert.equal(row(db, "rent-1105").balance_due, 0);
    assert.equal(row(db, "rent-1112").status, "overdue", "Nov 12 keeps its unwaived late fee");
    assert.equal(row(db, "rent-1112").balance_due, 150, "only the $150 late fee is still owed");
    assert.equal(row(db, "rent-1112").late_fees, 150, "late fees are never dropped without a waiver");
    const r = db._state.rentals[0];
    assert.equal(r.next_payment_due, "2026-11-26", "Nov 5, 12 and 19 paid: next due Nov 26");
    assert.equal(r.payment_status, "past_due", "a late fee is still owed");
    const notices = db._state.notifications.filter((n: Row) => n.title === "Open Stripe Invoice After Rent Paid");
    assert.equal(notices.length, 2);
    assert.ok(notices.every((n: Row) => /paid out of band/.test(n.body)));
  });

  it("a whole-week waiver closes the week too, and the rental reads current", async () => {
    const db = fakeDb({ rentals: [damonRental()], applications: [app()], payments: [nov5(), nov12()], notifications: [], app_settings: [],
      rent_late_fee_waivers: [{ rental_id: RENTAL, due_date: "2026-11-12", waived_through: null }] });
    const { s, stripe } = big({ weeks: "2026-11-05,2026-11-12,2026-11-19" });
    await send("checkout.session.completed", s, db, stripe);
    assert.equal(row(db, "rent-1112").status, "void");
    assert.equal(row(db, "rent-1112").late_fees, 0);
    assert.equal(db._state.rentals[0].payment_status, "current");
    assert.equal(db._state.rentals[0].next_payment_due, "2026-11-26");
  });

  it("without weeks metadata it pays the oldest open weeks, then the week already due with no row", async () => {
    const db = fakeDb({ rentals: [damonRental()], applications: [app()], payments: [nov5(), nov12()], notifications: [], app_settings: [], rent_late_fee_waivers: [] });
    const { s, stripe } = big({});
    await send("checkout.session.completed", s, db, stripe);
    assert.equal(row(db, "rent-1105").status, "void");
    assert.equal(row(db, "rent-1112").balance_due, 150);
    assert.equal(db._state.rentals[0].next_payment_due, "2026-11-26");
  });

  it("a payment with nothing owed keeps the old behavior and never prepays a future autopay week", async () => {
    const db = fakeDb({ rentals: [damonRental({ next_payment_due: "2026-11-26", payment_status: "current" })], applications: [app()], payments: [], notifications: [], app_settings: [], rent_late_fee_waivers: [] });
    const s = session({ amount_total: 35000, created: NOV22_0835 - 60, metadata: { rental_id: RENTAL, reason: "rent" } });
    const stripe = stripeStub({ session: s, pi: intent({ amount: 35000, amount_received: 35000 }), charge: charge({ amount: 35000, amount_captured: 35000, created: NOV22_0835 }) });
    await send("checkout.session.completed", s, db, stripe);
    assert.equal(paymentsFor(db)[0].due_date, "2026-11-22");
    assert.equal(db._state.rentals[0].next_payment_due, "2026-11-26");
  });

  it("allocator: oldest first, partial last week, weeks metadata parsed", () => {
    const open = [nov12(), nov5()];
    const a = allocateRentPayment({ amount: 500, paidOn: "2026-11-22", weeklyRate: 350, openRows: open, nextPaymentDue: "2026-11-12" });
    assert.deepEqual(a.map((x) => [x.dueDate, x.applied, x.paidInFull]), [["2026-11-05", 350, true], ["2026-11-12", 150, false]]);
    assert.equal(nextDueAfter("2026-11-12", a), "2026-11-12", "a part-paid week stays due");
    const b = allocateRentPayment({ amount: 1050, paidOn: "2026-11-22", weeklyRate: 350, openRows: open, weeks: ["2026-11-19", "2026-11-05", "2026-11-12"] });
    assert.deepEqual(b.map((x) => x.dueDate), ["2026-11-05", "2026-11-12", "2026-11-19"]);
    assert.equal(nextDueAfter("2026-11-12", b), "2026-11-26");
    assert.deepEqual(weeksOf({ metadata: { weeks: "2026-11-12, 2026-11-05,bad" } }), ["2026-11-05", "2026-11-12"]);
    const over = allocateRentPayment({ amount: 400, paidOn: "2026-11-06", weeklyRate: 350, openRows: [nov5()], nextPaymentDue: "2026-11-05" });
    assert.deepEqual(over.map((x) => [x.dueDate, x.applied]), [["2026-11-05", 400]], "credit beyond the weeks due stays on the last week");
  });

  it("rent standing: a row owing only its late fees is rent-paid; a default 0 balance is not", () => {
    const feesOnly = { type: "rent", status: "overdue", amount: 350, dueDate: "2026-11-12", balanceDue: 150, lateFees: 150 };
    assert.equal(onlyLateFeesLeft(feesOnly), true);
    assert.equal(isRentRowCovered(feesOnly, []), true);
    assert.equal(onlyLateFeesLeft({ ...feesOnly, balanceDue: 0, lateFees: 0 }), false);
    assert.equal(isRentRowCovered({ ...feesOnly, balanceDue: 500 }, []), false);
    const st = rentStanding({ today: "2026-11-22", nextPaymentDue: "2026-11-26", weeklyRate: 350, payments: [
      { type: "rent", status: "paid", amount: 1050, dueDate: "2026-11-05" }, feesOnly,
    ] });
    assert.equal(st.rentOwed, 0);
    assert.equal(st.nextDue, "2026-11-26");
  });
});
