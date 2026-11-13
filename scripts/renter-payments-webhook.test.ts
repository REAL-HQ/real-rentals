// Webhook storage for the renter Payments section.
// Simulated Stripe events only — no live Stripe or production writes.
// Run: bun test scripts/renter-payments-webhook.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";

import { postVerifiedPaymentWebhook } from "../src/routes/api/public/payments/webhook.ts";

const RENTAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const APP = "aaaaaaaa-aaaa-4aaa-8aaaa-aaaaaaaaaaaa";
const VEHICLE = "vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv";

type Row = Record<string, any>;

function fakeDb(seed: Record<string, Row[]> = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let nextId = 1;

  const orPredicate = (expr: string) => {
    const parts = expr.split(",").map((p) => p.trim());
    return (row: Row) =>
      parts.some((p) => {
        const [col, op, ...rest] = p.split(".");
        const val = rest.join(".");
        if (op === "is" && val === "null") return row[col] == null;
        if (op === "neq") return String(row[col] ?? "") !== val;
        if (op === "lt") return String(row[col] ?? "") < val;
        if (op === "eq") return String(row[col] ?? "") === val;
        throw new Error(`fakeDb: unsupported or() clause ${p}`);
      });
  };

  function from(table: string) {
    state[table] ??= [];
    let op: "select" | "insert" | "update" = "select";
    let patch: Row | null = null;
    let inserted: Row | null = null;
    let single = false;
    let limitN: number | null = null;
    const filters: ((r: Row) => boolean)[] = [];

    const b: any = {
      select() { return b; },
      insert(r: Row) { op = "insert"; inserted = r; return b; },
      update(p: Row) { op = "update"; patch = p; return b; },
      eq(c: string, v: any) { filters.push((r) => r[c] === v); return b; },
      neq(c: string, v: any) { filters.push((r) => r[c] !== v); return b; },
      in(c: string, vs: any[]) { filters.push((r) => vs.includes(r[c])); return b; },
      is(c: string, v: any) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
      or(expr: string) { filters.push(orPredicate(expr)); return b; },
      maybeSingle() { single = true; return b; },
      limit(n: number) { limitN = n; return b; },
      order() { return b; },
      then(res: any, rej: any) { return Promise.resolve().then(run).then(res, rej); },
    };

    function uniqueError(row: Row) {
      const rows = state[table];
      if (table !== "payments") return null;
      if (row.stripe_invoice_id && rows.some((r) => r.stripe_invoice_id === row.stripe_invoice_id)) {
        return { code: "23505", message: "duplicate stripe_invoice_id" };
      }
      if (row.stripe_charge_id && rows.some((r) => r.stripe_charge_id === row.stripe_charge_id)) {
        return { code: "23505", message: "duplicate stripe_charge_id" };
      }
      return null;
    }

    function run() {
      const match = () => {
        const hit = state[table].filter((r) => filters.every((f) => f(r)));
        return limitN == null ? hit : hit.slice(0, limitN);
      };
      if (op === "insert") {
        const error = uniqueError(inserted!);
        if (error) return { data: null, error };
        const row = { id: inserted?.id ?? `gen-${nextId++}`, ...inserted };
        state[table].push(row);
        return { data: [row], error: null };
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

  return { from, _state: state };
}

const paidInvoice = (over: Row = {}) => ({
  id: "in_1Paid",
  number: "ABC-0001",
  customer: "cus_1",
  customer_email: "renter@example.com",
  subscription: "sub_1",
  amount_paid: 35000,
  amount_due: 35000,
  created: 1794496666,
  status: "paid",
  hosted_invoice_url: "https://invoice.stripe.com/i/test",
  invoice_pdf: "https://pay.stripe.com/invoice/test/pdf",
  payment_intent: "pi_1",
  status_transitions: { paid_at: 1794497023 },
  charge: { id: "ch_1", receipt_url: "https://pay.stripe.com/receipts/test" },
  period_end: 1794496666,
  ...over,
});

const rentalSeed = {
  rentals: [{
    id: RENTAL,
    application_id: APP,
    vehicle_id: VEHICLE,
    status: "active",
    stripe_subscription_id: "sub_1",
    stripe_customer_id: "cus_1",
  }],
  applications: [{ id: APP, email: "renter@example.com", full_name: "Test Renter", stripe_customer_id: "cus_1" }],
  payments: [] as Row[],
};

describe("payments webhook receipts", () => {
  it("stores receipt and invoice links on a matched paid invoice", async () => {
    const db = fakeDb(rentalSeed);
    const res = await postVerifiedPaymentWebhook({ type: "invoice.paid", data: { object: paidInvoice() } }, db);
    assert.equal(res.status, 200);
    assert.equal(db._state.payments.length, 1);
    const row = db._state.payments[0];
    assert.equal(row.rental_id, RENTAL);
    assert.equal(row.driver_id, APP);
    assert.equal(row.status, "paid");
    assert.equal(row.stripe_invoice_number, "ABC-0001");
    assert.equal(row.stripe_receipt_url, "https://pay.stripe.com/receipts/test");
    assert.equal(row.stripe_hosted_invoice_url, "https://invoice.stripe.com/i/test");
    assert.equal(row.stripe_invoice_pdf_url, "https://pay.stripe.com/invoice/test/pdf");
    assert.equal(row.stripe_charge_id, "ch_1");
  });

  it("is idempotent on a second invoice.paid and a payment_succeeded replay", async () => {
    const db = fakeDb(rentalSeed);
    const ev = { type: "invoice.paid" as const, data: { object: paidInvoice() } };
    assert.equal((await postVerifiedPaymentWebhook(ev, db)).status, 200);
    assert.equal((await postVerifiedPaymentWebhook(ev, db)).status, 200);
    assert.equal((await postVerifiedPaymentWebhook({ type: "invoice.payment_succeeded", data: ev.data }, db)).status, 200);
    assert.equal(db._state.payments.length, 1);
    assert.equal(db._state.payments[0].stripe_invoice_id, "in_1Paid");
  });

  it("matches a renter by customer when the rental subscription has changed", async () => {
    const db = fakeDb({
      ...rentalSeed,
      rentals: [{ ...rentalSeed.rentals[0], stripe_subscription_id: "sub_current" }],
    });
    const res = await postVerifiedPaymentWebhook({
      type: "invoice.paid",
      data: { object: paidInvoice({ subscription: "sub_old" }) },
    }, db);
    assert.equal(res.status, 200);
    assert.equal(db._state.payments[0].rental_id, RENTAL);
    assert.equal(db._state.payments[0].stripe_subscription_id, "sub_old");
  });

  it("stores an application-only payment without sending rental notices", async () => {
    const db = fakeDb({
      rentals: [],
      applications: [{ id: APP, stripe_customer_id: "cus_heather", email: "heather@example.com", full_name: "Heather Bell" }],
      payments: [],
      notifications: [],
    });
    const res = await postVerifiedPaymentWebhook({
      type: "invoice.paid",
      data: { object: paidInvoice({
        id: "in_heather",
        customer: "cus_heather",
        subscription: "sub_heather",
        number: "B2GPF4RB-0001",
        charge: { id: "py_heather", receipt_url: "https://pay.stripe.com/receipts/heather" },
      }) },
    }, db);
    assert.equal(res.status, 200);
    assert.equal(db._state.payments.length, 1);
    const row = db._state.payments[0];
    assert.equal(row.driver_id, APP);
    assert.equal(row.rental_id, null);
    assert.equal(row.status, "paid");
    assert.equal(row.notified_status, "paid");
    assert.equal(row.stripe_invoice_number, "B2GPF4RB-0001");
    assert.equal((db._state.notifications ?? []).length, 0);
  });

  it("stores an unmatched paid invoice for staff instead of dropping it", async () => {
    const db = fakeDb({ rentals: [], applications: [], payments: [], notifications: [] });
    const res = await postVerifiedPaymentWebhook({
      type: "invoice.paid",
      data: { object: paidInvoice({ id: "in_unmatched", customer: "cus_unknown", subscription: "sub_unknown" }) },
    }, db);
    assert.equal(res.status, 200);
    assert.equal(db._state.payments.length, 1);
    const row = db._state.payments[0];
    assert.equal(row.rental_id, null);
    assert.equal(row.driver_id, null);
    assert.equal(row.status, "paid");
    assert.equal(row.notified_status, "paid");
    assert.equal(row.amount, 350);
    assert.equal((db._state.notifications ?? []).length, 0);
  });

  it("matches a one-time invoice with no subscription from application metadata", async () => {
    const db = fakeDb({
      rentals: [],
      applications: [{ id: "baa6dacd-fcfe-47b7-84a1-04952903f514", email: "js@example.com" }],
      payments: [],
      notifications: [],
    });
    const res = await postVerifiedPaymentWebhook({
      type: "invoice.paid",
      data: { object: paidInvoice({
        id: "in_1Uazl0",
        customer: "cus_james",
        subscription: null,
        parent: null,
        metadata: { application_id: "baa6dacd-fcfe-47b7-84a1-04952903f514" },
        number: "M5F0G0N6-0001",
      }) },
    }, db);
    assert.equal(res.status, 200);
    assert.equal(db._state.payments[0].driver_id, "baa6dacd-fcfe-47b7-84a1-04952903f514");
    assert.equal(db._state.payments[0].rental_id, null);
    assert.equal(db._state.payments[0].notified_status, "paid");
    assert.equal((db._state.notifications ?? []).length, 0);
  });
});
