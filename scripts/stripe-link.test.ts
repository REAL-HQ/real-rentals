// Stripe ↔ rental auto-linking: pure rules, the server helpers against a fake
// database and fake Stripe, and the webhook paths that use them.
// No network: Supabase points at a discard port and Stripe is a stub object.
//
// Run: bun test scripts/stripe-link.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
process.env.TZ = "America/New_York";

import {
  coversWeek,
  matchStripeToRental,
  nextDueAfterPaidWeeks,
  paidInvoiceOf,
  paymentRowForPaidInvoice,
  reconcileStripeLinks,
  type LinkCandidate,
} from "../src/lib/stripe-link.ts";
import {
  ensureApplicationStripeCustomer,
  importPaidInvoices,
  linkRentalOnActivation,
  linkStripeObjectToRental,
  runStripeLinkReconciliation,
} from "../src/lib/stripe-link.server.ts";
import { postVerifiedPaymentWebhook } from "../src/routes/api/public/payments/webhook.ts";

type Row = Record<string, any>;

const ts = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const HEATHER = "36973513-480e-4423-8129-2e37324ac455";
const HEATHER_APP = "f85939d0-9e81-4cff-9492-9f7f4358d117";
const JAMES = "9108ea8c-528f-4a81-9237-af505a1b208a";
const JAMES_APP = "baa6dacd-fcfe-47b7-84a1-04952903f514";

function fakeDb(seed: Record<string, Row[]>) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let nextId = 1;
  const unique: Record<string, string[]> = { payments: ["stripe_invoice_id"] };
  function from(table: string) {
    state[table] ??= [];
    let op: "select" | "insert" | "update" = "select";
    let patch: Row | null = null;
    let inserted: Row | Row[] | null = null;
    let single = false;
    const filters: ((r: Row) => boolean)[] = [];
    const b: any = {
      select() { return b; },
      insert(r: Row | Row[]) { op = "insert"; inserted = r; return b; },
      update(p: Row) { op = "update"; patch = p; return b; },
      upsert(r: Row) { op = "insert"; inserted = r; return b; },
      eq(c: string, v: any) { filters.push((r) => r[c] === v); return b; },
      neq(c: string, v: any) { filters.push((r) => r[c] !== v); return b; },
      in(c: string, vs: any[]) { filters.push((r) => vs.includes(r[c])); return b; },
      is(c: string, v: any) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
      not(c: string, o: string, v: any) { filters.push((r) => (o === "is" && v === null ? r[c] != null : r[c] !== v)); return b; },
      gte(c: string, v: any) { filters.push((r) => r[c] >= v); return b; },
      lt(c: string, v: any) { filters.push((r) => r[c] < v); return b; },
      or(expr: string) {
        const parts = expr.split(",").map((p) => p.trim());
        filters.push((row) => parts.some((p) => {
          const [col, o, ...rest] = p.split(".");
          const val = rest.join(".");
          if (o === "is" && val === "null") return row[col] == null;
          if (o === "neq") return String(row[col] ?? "") !== val;
          if (o === "eq") return String(row[col] ?? "") === val;
          return false;
        }));
        return b;
      },
      maybeSingle() { single = true; return b; },
      single() { single = true; return b; },
      limit() { return b; },
      order() { return b; },
      then(res: any, rej: any) { return Promise.resolve().then(run).then(res, rej); },
    };
    function run() {
      const match = () => state[table].filter((r) => filters.every((f) => f(r)));
      if (op === "insert") {
        const rows = Array.isArray(inserted) ? inserted : [inserted!];
        const out: Row[] = [];
        for (const ins of rows) {
          for (const col of unique[table] ?? []) {
            if (ins[col] != null && state[table].some((r) => r[col] === ins[col])) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
          }
          const row = { id: `gen-${nextId++}`, ...ins };
          state[table].push(row);
          out.push(row);
        }
        return { data: single ? out[0] : out, error: null };
      }
      if (op === "update") {
        const hit = match();
        for (const r of hit) Object.assign(r, patch);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      const hit = match();
      return single ? { data: hit[0] ?? null, error: null } : { data: hit, error: null };
    }
    return b;
  }
  return { from, rpc: async () => ({ data: null, error: null }), _state: state };
}

function inv(over: Row = {}): Row {
  return {
    id: "in_h1", status: "paid", amount_paid: 35000, customer: "cus_heather", customer_email: "heatherbell863@gmail.com",
    created: ts("2026-11-10T15:43:05Z"), status_transitions: { paid_at: ts("2026-11-10T15:43:20Z") },
    parent: { subscription_details: { subscription: "sub_heather", metadata: {} } }, metadata: {},
    ...over,
  };
}

function fakeStripe(opts: { customers?: Row[]; invoices?: Row[]; subscriptions?: Row[] } = {}) {
  const calls: { op: string; args: any }[] = [];
  return {
    calls,
    customers: {
      list: async (a: any) => { calls.push({ op: "customers.list", args: a }); return { data: (opts.customers ?? []).filter((c) => c.email === a.email) }; },
      create: async (a: any) => { calls.push({ op: "customers.create", args: a }); return { id: "cus_new" }; },
    },
    invoices: {
      list: async (a: any) => {
        calls.push({ op: "invoices.list", args: a });
        const data = (opts.invoices ?? []).filter((i) => (!a.customer || i.customer === a.customer) && (!a.status || i.status === a.status) && (!a.created?.gte || i.created >= a.created.gte));
        return { data, has_more: false };
      },
    },
    subscriptions: {
      list: async (a: any) => { calls.push({ op: "subscriptions.list", args: a }); return { data: (opts.subscriptions ?? []).filter((s) => s.customer === a.customer && s.status === a.status) }; },
    },
  };
}

const cand = (over: Partial<LinkCandidate>): LinkCandidate => ({
  rentalId: "r1", applicationId: "a1", stripeCustomerId: null, applicationStripeCustomerId: null, stripeSubscriptionId: null, ...over,
});

describe("matchStripeToRental", () => {
  const rentals = [
    cand({ rentalId: "r1", applicationId: "a1" }),
    cand({ rentalId: "r2", applicationId: "a2", applicationStripeCustomerId: "cus_2" }),
    cand({ rentalId: "r3", applicationId: "a3", stripeCustomerId: "cus_3", stripeSubscriptionId: "sub_old" }),
  ];
  it("prefers metadata rentalId, then applicationId (camel or snake case), then client_reference_id", () => {
    assert.deepEqual(matchStripeToRental({ metadata: { rentalId: "r1" }, customerId: "cus_3" }, rentals), { kind: "link", rentalId: "r1", applicationId: "a1", by: "metadata" });
    assert.equal((matchStripeToRental({ metadata: { application_id: "a2" } }, rentals) as any).rentalId, "r2");
    assert.equal((matchStripeToRental({ clientReferenceId: "r1" }, rentals) as any).rentalId, "r1");
  });
  it("falls back to the rental's or the application's customer id", () => {
    assert.deepEqual(matchStripeToRental({ customerId: "cus_2", subscriptionId: "sub_new" }, rentals), { kind: "link", rentalId: "r2", applicationId: "a2", by: "customer" });
  });
  it("never overwrites a different subscription, and recognises the same one", () => {
    assert.equal(matchStripeToRental({ customerId: "cus_3", subscriptionId: "sub_new" }, rentals).kind, "duplicate");
    assert.equal(matchStripeToRental({ customerId: "cus_3", subscriptionId: "sub_old" }, rentals).kind, "already");
  });
  it("matches nothing when two rentals share a customer, or nothing matches", () => {
    const two = [cand({ rentalId: "x", stripeCustomerId: "cus_9" }), cand({ rentalId: "y", applicationStripeCustomerId: "cus_9" })];
    assert.equal(matchStripeToRental({ customerId: "cus_9" }, two).kind, "ambiguous");
    assert.equal(matchStripeToRental({ customerId: "cus_none", metadata: { rentalId: "zz" } }, rentals).kind, "none");
  });
});

describe("paid invoices", () => {
  it("normalises a paid invoice and writes the webhook's row shape", () => {
    const p = paidInvoiceOf(inv())!;
    assert.deepEqual(p, { id: "in_h1", customerId: "cus_heather", customerEmail: "heatherbell863@gmail.com", subscriptionId: "sub_heather", amountPaid: 350, createdOn: "2026-11-10", paidOn: "2026-11-10" });
    const row = paymentRowForPaidInvoice(p, { id: HEATHER, application_id: HEATHER_APP, vehicle_id: "v1" });
    assert.equal(row.status, "paid");
    assert.equal(row.due_date, "2026-11-10");
    assert.equal(row.balance_due, 0);
    assert.equal(row.notified_status, "paid", "an import must never send a receipt");
    assert.equal(row.driver_id, HEATHER_APP);
  });
  it("ignores unpaid, $0 and void invoices", () => {
    assert.equal(paidInvoiceOf(inv({ status: "open" })), null);
    assert.equal(paidInvoiceOf(inv({ amount_paid: 0 })), null);
    assert.equal(paidInvoiceOf(inv({ status: "void" })), null);
  });
  it("covers the week from 2 days early to 6 days after, at the weekly rate", () => {
    assert.ok(coversWeek({ createdOn: "2026-11-12", amount: 350 }, "2026-11-12", 350));
    assert.ok(coversWeek({ createdOn: "2026-11-10", amount: 350 }, "2026-11-12", 350));
    assert.ok(!coversWeek({ createdOn: "2026-11-12", amount: 350 }, "2026-11-19", 350), "last week's payment does not cover next week");
    assert.ok(!coversWeek({ createdOn: "2026-11-12", amount: 100 }, "2026-11-12", 350));
  });
  it("moves next due one week past the latest paid week, never backwards", () => {
    assert.equal(nextDueAfterPaidWeeks("2026-11-10", [{ createdOn: "2026-11-10", amount: 350 }], 350), "2026-11-17");
    assert.equal(nextDueAfterPaidWeeks("2026-11-12", [{ createdOn: "2026-11-12", amount: 350 }], 350), "2026-11-19");
    assert.equal(nextDueAfterPaidWeeks("2026-12-01", [{ createdOn: "2026-11-12", amount: 350 }], 350), "2026-12-01");
    assert.equal(nextDueAfterPaidWeeks("2026-11-12", [], 350), "2026-11-12");
  });
});

describe("reconcileStripeLinks", () => {
  it("flags unrecorded paid invoices and customers no rental knows", () => {
    const a = paidInvoiceOf(inv({ id: "in_a", customer: "cus_a" }))!;
    const b = paidInvoiceOf(inv({ id: "in_b", customer: "cus_b" }))!;
    const c = paidInvoiceOf(inv({ id: "in_c", customer: "cus_closed" }))!;
    const r = reconcileStripeLinks({ invoices: [a, b, c], recordedInvoiceIds: new Set(["in_a"]), activeCustomerIds: new Set(["cus_a"]), knownCustomerIds: new Set(["cus_closed"]) });
    assert.deepEqual(r.missing.map((m) => m.id), ["in_b", "in_c"]);
    assert.deepEqual(r.unlinkedCustomers.map((u) => u.customerId), ["cus_b"]);
  });
});

describe("server helpers", () => {
  it("ensureApplicationStripeCustomer reuses a saved id, then a Stripe customer for the email, and only then creates", async () => {
    const db = fakeDb({ applications: [{ id: "a1", email: "x@y.com", stripe_customer_id: null }] });
    const s1 = fakeStripe({ customers: [{ id: "cus_existing", email: "x@y.com", metadata: {} }] });
    assert.equal(await ensureApplicationStripeCustomer(db, s1, { id: "a1", email: "x@y.com" }), "cus_existing");
    assert.equal(db._state.applications[0].stripe_customer_id, "cus_existing");
    assert.ok(!s1.calls.some((c) => c.op === "customers.create"), "created a second customer");
    assert.equal(await ensureApplicationStripeCustomer(db, s1, { id: "a1", stripe_customer_id: "cus_existing" }), "cus_existing");
    const db2 = fakeDb({ applications: [{ id: "a2", email: "new@y.com", stripe_customer_id: null }] });
    const s2 = fakeStripe();
    assert.equal(await ensureApplicationStripeCustomer(db2, s2, { id: "a2", email: "new@y.com" }), "cus_new");
    assert.deepEqual(s2.calls.find((c) => c.op === "customers.create")!.args.metadata, { applicationId: "a2" });
  });

  it("linkStripeObjectToRental fills empty columns once; a replay changes nothing", async () => {
    const db = fakeDb({
      rentals: [{ id: JAMES, application_id: JAMES_APP, status: "active", stripe_customer_id: null, stripe_subscription_id: null }],
      applications: [{ id: JAMES_APP, stripe_customer_id: null }],
    });
    const ref = { metadata: { rentalId: JAMES }, customerId: "cus_james", subscriptionId: "sub_james" };
    assert.equal((await linkStripeObjectToRental(db, ref)).kind, "link");
    const after = JSON.parse(JSON.stringify(db._state.rentals));
    assert.equal(after[0].stripe_subscription_id, "sub_james");
    assert.equal(after[0].stripe_customer_id, "cus_james");
    assert.equal(after[0].autopay_active, true);
    assert.equal(db._state.applications[0].stripe_customer_id, "cus_james");
    assert.equal((await linkStripeObjectToRental(db, ref)).kind, "already");
    assert.deepEqual(db._state.rentals, after);
    assert.equal((await linkStripeObjectToRental(db, { ...ref, subscriptionId: "sub_other" })).kind, "duplicate");
    assert.equal(db._state.rentals[0].stripe_subscription_id, "sub_james", "a second subscription overwrote the first");
  });

  it("importPaidInvoices is idempotent on the invoice id", async () => {
    const db = fakeDb({ payments: [] });
    const p = paidInvoiceOf(inv())!;
    const rental = { id: HEATHER, application_id: HEATHER_APP, vehicle_id: "v1" };
    assert.deepEqual(await importPaidInvoices(db, rental, [p]), { inserted: 1, skipped: 0 });
    assert.deepEqual(await importPaidInvoices(db, rental, [p]), { inserted: 0, skipped: 1 });
    assert.equal(db._state.payments.length, 1);
  });

  it("activation copies the customer, attaches its one subscription, imports paid weeks and moves the due date (Heather)", async () => {
    const db = fakeDb({
      rentals: [{ id: HEATHER, application_id: HEATHER_APP, vehicle_id: "v1", status: "active", start_date: "2026-11-10", weekly_rate: 350, next_payment_due: "2026-11-10", stripe_customer_id: null, stripe_subscription_id: null }],
      applications: [{ id: HEATHER_APP, email: "heatherbell863@gmail.com", stripe_customer_id: null }],
      payments: [],
    });
    const stripe = fakeStripe({
      customers: [{ id: "cus_heather", email: "heatherbell863@gmail.com", metadata: {} }],
      invoices: [inv()],
      subscriptions: [{ id: "sub_heather", customer: "cus_heather", status: "active" }],
    });
    const out = await linkRentalOnActivation(db, stripe, HEATHER);
    assert.equal(out.error, undefined);
    const r = db._state.rentals[0];
    assert.equal(r.stripe_customer_id, "cus_heather");
    assert.equal(r.stripe_subscription_id, "sub_heather");
    assert.equal(r.next_payment_due, "2026-11-17");
    assert.equal(db._state.payments.length, 1);
    assert.equal(db._state.payments[0].stripe_invoice_id, "in_h1");
    // Running it again adds nothing.
    await linkRentalOnActivation(db, stripe, HEATHER);
    assert.equal(db._state.payments.length, 1);
    assert.equal(db._state.rentals[0].next_payment_due, "2026-11-17");
  });

  it("activation for a one-off first-week payer links the customer only (James)", async () => {
    const db = fakeDb({
      rentals: [{ id: JAMES, application_id: JAMES_APP, vehicle_id: "v2", status: "active", start_date: "2026-11-12", weekly_rate: 350, next_payment_due: "2026-11-12", stripe_customer_id: null, stripe_subscription_id: null }],
      applications: [{ id: JAMES_APP, email: "js4482322205@gmail.com", stripe_customer_id: "cus_james" }],
      payments: [],
    });
    const stripe = fakeStripe({ invoices: [inv({ id: "in_j1", customer: "cus_james", created: ts("2026-11-12T15:17:46Z"), status_transitions: { paid_at: ts("2026-11-12T15:23:43Z") }, parent: null, metadata: { application_id: JAMES_APP } })] });
    await linkRentalOnActivation(db, stripe, JAMES);
    const r = db._state.rentals[0];
    assert.equal(r.stripe_customer_id, "cus_james");
    assert.equal(r.stripe_subscription_id, null);
    assert.equal(r.next_payment_due, "2026-11-19");
    assert.equal(db._state.payments[0].stripe_subscription_id, null);
    assert.ok(!stripe.calls.some((c) => c.op === "customers.create"));
  });

  it("the daily check emails once per ET day and only when something is off", async () => {
    const db = fakeDb({ payments: [], rentals: [], applications: [], outbound_messages: [] });
    const stripe = fakeStripe({ invoices: [inv({ created: ts("2026-11-13T15:00:00Z") })] });
    const sends: any[] = [];
    const send = async (r: any) => { sends.push(r); return { ok: true }; };
    const now = new Date("2026-11-14T13:30:00Z");
    const first = await runStripeLinkReconciliation(db, { stripe, now, send });
    assert.equal(first.sent, true);
    assert.equal(sends[0].missing.length, 1);
    assert.equal(sends[0].unlinkedCustomers[0].customerId, "cus_heather");
    const again = await runStripeLinkReconciliation(db, { stripe, now, send });
    assert.equal(again.reason, "already_sent");
    assert.equal(sends.length, 1);
    const clean = fakeDb({ payments: [{ stripe_invoice_id: "in_h1" }], rentals: [{ id: "r", status: "active", stripe_customer_id: "cus_heather" }], applications: [], outbound_messages: [] });
    const none = await runStripeLinkReconciliation(clean, { stripe, now, send });
    assert.equal(none.reason, "nothing_to_link");
  });
});

describe("webhook linking", () => {
  const base = () => fakeDb({
    rentals: [{ id: JAMES, application_id: JAMES_APP, vehicle_id: "v2", status: "active", stripe_customer_id: null, stripe_subscription_id: null }],
    applications: [{ id: JAMES_APP, email: "js4482322205@gmail.com", phone: "4482322205", stripe_customer_id: null }],
    payments: [],
    automation_settings: [],
    app_settings: [],
  });
  const ok = (r: Response) => assert.equal(r.status, 200);

  it("subscription-mode checkout.session.completed links by metadata", async () => {
    const db = base();
    ok(await postVerifiedPaymentWebhook({ type: "checkout.session.completed", data: { object: {
      mode: "subscription", customer: "cus_james", subscription: "sub_james", metadata: { rentalId: JAMES, applicationId: JAMES_APP },
    } } }, db, "live"));
    assert.equal(db._state.rentals[0].stripe_subscription_id, "sub_james");
    assert.equal(db._state.rentals[0].stripe_customer_id, "cus_james");
  });

  it("customer.subscription.created links by the renter's customer id, idempotently", async () => {
    const db = base();
    db._state.applications[0].stripe_customer_id = "cus_james";
    const ev = { type: "customer.subscription.created", data: { object: { id: "sub_james", customer: "cus_james", metadata: {} } } };
    ok(await postVerifiedPaymentWebhook(ev, db, "live"));
    ok(await postVerifiedPaymentWebhook(ev, db, "live"));
    assert.equal(db._state.rentals[0].stripe_subscription_id, "sub_james");
    assert.equal(db._state.rentals[0].stripe_customer_id, "cus_james");
  });

  it("invoice.paid for a new subscription records the row via metadata, and a replay adds nothing", async () => {
    const db = base();
    const ev = { type: "invoice.paid", data: { object: inv({
      id: "in_j2", customer: "cus_james", customer_email: "js4482322205@gmail.com", amount_due: 35000,
      parent: { subscription_details: { subscription: "sub_james", metadata: { rentalId: JAMES } } },
    }) } };
    ok(await postVerifiedPaymentWebhook(ev, db, "live"));
    ok(await postVerifiedPaymentWebhook(ev, db, "live"));
    assert.equal(db._state.rentals[0].stripe_subscription_id, "sub_james");
    const rows = db._state.payments.filter((p) => p.stripe_invoice_id === "in_j2");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "paid");
    assert.equal(rows[0].rental_id, JAMES);
  });

  it("a one-off paid invoice is recorded when its customer is the rental's", async () => {
    const db = base();
    db._state.rentals[0].stripe_customer_id = "cus_james";
    ok(await postVerifiedPaymentWebhook({ type: "invoice.paid", data: { object: inv({
      id: "in_j3", customer: "cus_james", amount_due: 35000, parent: null, metadata: {},
    }) } }, db, "live"));
    const rows = db._state.payments.filter((p) => p.stripe_invoice_id === "in_j3");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].stripe_subscription_id, null);
    assert.equal(db._state.rentals[0].stripe_subscription_id, null, "a one-off invoice must not set a subscription");
  });

  it("an unknown one-off invoice stays unmatched and writes nothing", async () => {
    const db = base();
    ok(await postVerifiedPaymentWebhook({ type: "invoice.paid", data: { object: inv({ id: "in_x", customer: "cus_stranger", parent: null }) } }, db, "live"));
    assert.equal(db._state.payments.length, 0);
  });
});
