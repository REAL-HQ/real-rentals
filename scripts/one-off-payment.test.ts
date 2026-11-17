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
import { appOwnsPayment, oneOffIdentity, oneOffRowType, pickRental, exactILike, UNMATCHED_TITLE } from "../src/lib/one-off-payment.ts";
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
function stripeStub(o: { session?: Row | null; pi?: Row; charge?: Row; invoicePayments?: Row[]; fail?: boolean } = {}) {
  const calls: string[] = [];
  const guard = (name: string) => { calls.push(name); if (o.fail) throw new Error("stripe down"); };
  return {
    calls,
    paymentIntents: { retrieve: async () => { guard("pi"); return o.pi ?? intent(); } },
    charges: { retrieve: async () => { guard("charge"); return o.charge ?? charge(); } },
    checkout: { sessions: { list: async () => { guard("sessions"); return { data: o.session === null ? [] : [o.session ?? session()] }; } } },
    invoicePayments: { list: async () => { guard("invoicePayments"); return { data: o.invoicePayments ?? [] }; } },
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
    assert.equal(oneOffRowType("late_fee"), "late_fee");
    assert.equal(oneOffRowType("anything"), "fee");
    assert.equal(pickRental([rental(), rental({ id: RENTAL2 })], { explicit: false }).ambiguous, true);
    assert.equal(pickRental([rental({ status: "closed" })], { explicit: false }).rental, null);
    assert.equal(pickRental([rental({ status: "closed" })], { explicit: true }).rental?.id, RENTAL);
    assert.equal(exactILike("a_b%c@x.com"), "a\\_b\\%c@x.com");
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
    assert.equal(rows[0].type, "fee");
    assert.equal(rows[0].paid_date, "2026-11-16", "paid date is the Eastern day");
    assert.equal(rows[0].stripe_charge_id, CH);
    assert.equal(rows[0].stripe_customer_id, CUS);
    assert.equal(rows[0].notified_status, "paid", "no app receipt for a Stripe-receipted payment");
    assert.equal(rows[0].reason, "1-day rental Nov 16, return Nov 17");
    assert.equal(unmatched(db).length, 0);
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
    assert.deepEqual(stripe.calls, []);
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
