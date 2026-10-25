// Behavioural regression tests for the payments webhook, driven by simulated
// Stripe events through the seam the route already provides:
// postVerifiedPaymentWebhook(event, admin, env) takes a mocked database.
//
// No Stripe request is made. The events are handed over already "verified", and
// none of the paths exercised here construct a Stripe client (only
// checkout.session.completed does, and it is deliberately not covered).
// Email no-ops without RESEND_API_KEY.
//
// Run: bun test scripts/payments-webhook-events.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Point every client at the discard port before the module graph loads: some
// alert paths build a Supabase admin client, which throws without these. Any
// request there is refused immediately, so nothing leaves the machine.
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";

import { postVerifiedPaymentWebhook } from "../src/routes/api/public/payments/webhook.ts";

const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RENTAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Row = Record<string, any>;

/**
 * Smallest PostgREST-shaped fake that answers the chains this file uses.
 *
 * It models one PostgREST 12 behaviour (checked on 12.2.3) that decides
 * whether a guarded write works at all: a PATCH's or= filter is applied again
 * to the RETURNING rows, after the write. A select that omits a column the
 * or() names fails with 42703 and writes nothing; one that includes it gets
 * back only rows whose NEW values still pass. Plain filters (eq, neq, in,
 * isdistinct) are not re-applied. `unique` lists columns whose duplicate
 * insert fails with 23505, as payments.stripe_invoice_id does.
 */
function fakeDb(seed: Record<string, Row[]>, unique: Record<string, string[]> = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const rpcCalls: { name: string; args: any }[] = [];
  let nextId = 1;

  const orPredicate = (expr: string) => {
    const parts = expr.split(",").map((p) => p.trim());
    return (row: Row) =>
      parts.some((p) => {
        const [col, op, ...rest] = p.split(".");
        const val = rest.join(".");
        if (op === "is" && val === "null") return row[col] == null;
        if (op === "neq") return String(row[col] ?? "") !== val;
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
    let cols: string | null = null;
    const filters: ((r: Row) => boolean)[] = [];
    const ors: string[] = [];

    const b: any = {
      select(c?: string) { cols = c ?? "*"; return b; },
      insert(r: Row) { op = "insert"; inserted = r; return b; },
      update(p: Row) { op = "update"; patch = p; return b; },
      eq(c: string, v: any) { filters.push((r) => r[c] === v); return b; },
      neq(c: string, v: any) { filters.push((r) => r[c] !== v); return b; },
      in(c: string, vs: any[]) { filters.push((r) => vs.includes(r[c])); return b; },
      isDistinct(c: string, v: any) { filters.push((r) => (r[c] ?? null) !== v); return b; },
      or(expr: string) { ors.push(expr); filters.push(orPredicate(expr)); return b; },
      maybeSingle() { single = true; return b; },
      limit() { return b; },
      order() { return b; },
      then(res: any, rej: any) { return Promise.resolve().then(run).then(res, rej); },
    };

    function run() {
      const match = () => state[table].filter((r) => filters.every((f) => f(r)));
      if (op === "insert") {
        const row = { id: `gen-${nextId++}`, ...inserted };
        for (const c of unique[table] ?? []) {
          if (row[c] != null && state[table].some((r) => r[c] === row[c])) {
            return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${c}` } };
          }
        }
        state[table].push(row);
        return { data: [row], error: null };
      }
      if (op === "update") {
        if (cols !== null && cols !== "*" && ors.length) {
          const sel = cols.split(",").map((c) => c.trim());
          for (const expr of ors) for (const part of expr.split(",")) {
            const col = part.trim().split(".")[0];
            if (!sel.includes(col)) return { data: null, error: { code: "42703", message: `column ${table}.${col} does not exist` } };
          }
        }
        const hit = match();
        for (const r of hit) Object.assign(r, patch);
        const back = hit.filter((r) => ors.every((e) => orPredicate(e)(r)));
        return { data: back.map((r) => ({ id: r.id })), error: null };
      }
      const hit = match();
      return single ? { data: hit[0] ?? null, error: null } : { data: hit, error: null };
    }
    return b;
  }

  return {
    from,
    rpc: (name: string, args: any) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
    _state: state,
    _rpcCalls: rpcCalls,
  };
}

const pi = (over: Row = {}): Row => ({
  id: "pi_1", amount: 35000, metadata: { rentalId: RENTAL, reason: "rent" }, ...over,
});
const ok = async (r: Response) => { assert.equal(r.status, 200); return r; };

describe("payments webhook — simulated Stripe events", () => {
  it("duplicate payment_intent.succeeded pays the row once and the replay changes nothing", async () => {
    const db = fakeDb({ payments: [{ id: P1, status: "pending", balance_due: 350, failure_reason: null, notified_status: null }] });
    const event = { type: "payment_intent.succeeded", data: { object: pi({ metadata: { rentalId: RENTAL, reason: "rent", paymentIds: P1 } }) } };

    await ok(await postVerifiedPaymentWebhook(event, db, "live"));
    const afterFirst = JSON.parse(JSON.stringify(db._state.payments));
    assert.equal(afterFirst[0].status, "paid");
    assert.equal(afterFirst[0].balance_due, 0);

    // Same event delivered again.
    await ok(await postVerifiedPaymentWebhook(event, db, "live"));
    assert.deepEqual(db._state.payments, afterFirst, "a duplicate delivery changed a paid row");
    assert.equal(db._state.payments.length, 1, "a duplicate delivery wrote a second charge");
  });

  it("a manually-paid row keeps its manual record when Stripe later reports the same intent", async () => {
    const db = fakeDb({ payments: [{
      id: P1, status: "paid", paid_date: "2026-10-01", balance_due: 0,
      failure_reason: "card_declined", notified_status: null,
    }] });
    const event = { type: "payment_intent.succeeded", data: { object: pi({ metadata: { rentalId: RENTAL, reason: "rent", paymentIds: P1 } }) } };

    await ok(await postVerifiedPaymentWebhook(event, db, "live"));
    const row = db._state.payments[0];
    assert.equal(row.status, "paid");
    assert.equal(row.paid_date, "2026-10-01", "paid_date was overwritten on a manual record");
    assert.equal(row.failure_reason, "card_declined", "failure_reason was cleared on a manual record");
    assert.equal(row.stripe_payment_intent_id, undefined, "a payment intent was stored on a manual record");
  });

  it("payment_intent.payment_failed marks an open row failed and records the reason", async () => {
    const db = fakeDb({ payments: [{ id: P1, status: "pending", balance_due: 350, failure_reason: null }] });
    const event = { type: "payment_intent.payment_failed", data: { object: pi({
      metadata: { rentalId: RENTAL, reason: "rent", paymentIds: P1 },
      last_payment_error: { message: "Your card was declined." },
    }) } };

    await ok(await postVerifiedPaymentWebhook(event, db, "live"));
    assert.equal(db._state.payments[0].status, "failed");
    assert.equal(db._state.payments[0].failure_reason, "Your card was declined.");
  });

  it("an out-of-order failure arriving after success never un-pays the row", async () => {
    const db = fakeDb({ payments: [{ id: P1, status: "pending", balance_due: 350, failure_reason: null }] });
    const meta = { rentalId: RENTAL, reason: "rent", paymentIds: P1 };

    await ok(await postVerifiedPaymentWebhook({ type: "payment_intent.succeeded", data: { object: pi({ metadata: meta }) } }, db, "live"));
    assert.equal(db._state.payments[0].status, "paid");

    // The failure for the earlier attempt arrives late.
    await ok(await postVerifiedPaymentWebhook({ type: "payment_intent.payment_failed", data: { object: pi({
      id: "pi_0", metadata: meta, last_payment_error: { message: "Late failure." },
    }) } }, db, "live"));

    const row = db._state.payments[0];
    assert.equal(row.status, "paid", "a late failure un-paid a collected row");
    assert.equal(row.failure_reason, null, "a late failure wrote a reason onto a paid row");
  });

  it("a refunded row is never un-paid by a later success", async () => {
    const db = fakeDb({ payments: [{ id: P1, status: "refunded", balance_due: 0, failure_reason: null }] });
    await ok(await postVerifiedPaymentWebhook({ type: "payment_intent.succeeded", data: { object: pi({
      metadata: { rentalId: RENTAL, reason: "rent", paymentIds: P1 },
    }) } }, db, "live"));
    assert.equal(db._state.payments[0].status, "refunded", "a success overwrote a refunded row");
  });

  it("charge.refunded goes through apply_payment_refund and writes no payments row itself", async () => {
    const db = fakeDb({ payments: [{ id: P1, status: "paid", stripe_payment_intent_id: "pi_1", balance_due: 0 }] });
    const before = JSON.parse(JSON.stringify(db._state.payments));

    await ok(await postVerifiedPaymentWebhook({ type: "charge.refunded", data: { object: {
      id: "ch_1", payment_intent: "pi_1", amount_refunded: 35000,
      refunds: { data: [{ id: "re_1", amount: 35000, status: "succeeded" }] },
    } } }, db, "live"));

    assert.equal(db._rpcCalls.length, 1, "expected exactly one rpc call");
    assert.equal(db._rpcCalls[0].name, "apply_payment_refund");
    assert.deepEqual(db._rpcCalls[0].args._payment_ids, [P1]);
    assert.equal(db._rpcCalls[0].args._cumulative, 350);
    assert.deepEqual(db._state.payments, before, "the webhook wrote the refund itself instead of using the rpc");
  });

  // Isolates .neq('status','paid') on the FAILURE path. With a single id the
  // code also adds an or() on the intent pointer, which hides the neq guard:
  // dropping neq still passed. Two ids means no or() clause, so neq is the only
  // thing standing between a late failure and an already-paid row.
  it("a late failure in a combined charge does not un-pay an already-paid sibling", async () => {
    const db = fakeDb({ payments: [
      { id: P1, status: "paid", paid_date: "2026-10-01", balance_due: 0, failure_reason: null },
      { id: P2, status: "pending", balance_due: 350, failure_reason: null },
    ] });

    await ok(await postVerifiedPaymentWebhook({ type: "payment_intent.payment_failed", data: { object: pi({
      metadata: { rentalId: RENTAL, reason: "rent", paymentIds: `${P1},${P2}` },
      last_payment_error: { message: "Late failure." },
    }) } }, db, "live"));

    const [a, b] = db._state.payments;
    assert.equal(a.status, "paid", "a late failure un-paid an already-paid row in a combined charge");
    assert.equal(a.failure_reason, null, "a late failure wrote a reason onto a paid row");
    assert.equal(b.status, "failed", "the open row in the combined charge was not marked failed");
    assert.equal(b.failure_reason, "Late failure.");
  });

  // Isolates .neq('status','refunded') on the same path.
  it("a late failure does not touch a refunded row in a combined charge", async () => {
    const db = fakeDb({ payments: [
      { id: P1, status: "refunded", balance_due: 0, failure_reason: null },
      { id: P2, status: "pending", balance_due: 350, failure_reason: null },
    ] });

    await ok(await postVerifiedPaymentWebhook({ type: "payment_intent.payment_failed", data: { object: pi({
      metadata: { rentalId: RENTAL, reason: "rent", paymentIds: `${P1},${P2}` },
      last_payment_error: { message: "Late failure." },
    }) } }, db, "live"));

    assert.equal(db._state.payments[0].status, "refunded", "a late failure overwrote a refunded row");
    assert.equal(db._state.payments[1].status, "failed");
  });

  it("a combined charge pays only the open rows and leaves an already-paid sibling alone", async () => {
    const db = fakeDb({ payments: [
      { id: P1, status: "paid", paid_date: "2026-10-01", balance_due: 0, failure_reason: null },
      { id: P2, status: "pending", balance_due: 350, failure_reason: null },
    ] });

    await ok(await postVerifiedPaymentWebhook({ type: "payment_intent.succeeded", data: { object: pi({
      metadata: { rentalId: RENTAL, reason: "rent", paymentIds: `${P1},${P2}` },
    }) } }, db, "live"));

    const [a, b] = db._state.payments;
    assert.equal(a.paid_date, "2026-10-01", "an already-paid sibling was re-dated");
    assert.equal(b.status, "paid");
    assert.equal(b.balance_due, 0);
    // Two rows in one charge: the intent pointer is not stored on either.
    assert.equal(a.stripe_payment_intent_id, undefined);
    assert.equal(b.stripe_payment_intent_id, undefined);
  });

  // The notice claims used or(notified_status.is.null,notified_status.neq.X)
  // with select('id'). Against PostgREST 12 that is 42703 on every event (a
  // 400, so Stripe retries and no receipt is ever sent); selecting the column
  // instead claims the row but returns [], which also sends nothing.
  it("a success claims the receipt notice exactly once, and a replay claims nothing", async () => {
    const db = fakeDb({ payments: [{ id: P1, status: "pending", balance_due: 350, failure_reason: null, notified_status: null }] });
    const event = { type: "payment_intent.succeeded", data: { object: pi({ metadata: { rentalId: RENTAL, reason: "rent", paymentIds: P1 } }) } };

    await ok(await postVerifiedPaymentWebhook(event, db, "live"));
    assert.equal(db._state.payments[0].notified_status, "paid");
    assert.equal(db._state.notifications?.length, 1, "the paid notice was not sent");

    await ok(await postVerifiedPaymentWebhook(event, db, "live"));
    assert.equal(db._state.notifications.length, 1, "a replay sent a second paid notice");
  });

  it("a failure on the charge's current intent is recorded and notified once", async () => {
    const db = fakeDb({ payments: [{ id: P1, status: "pending", balance_due: 350, failure_reason: null, stripe_payment_intent_id: "pi_1", notified_status: null }] });
    const event = { type: "payment_intent.payment_failed", data: { object: pi({
      metadata: { rentalId: RENTAL, reason: "rent", paymentIds: P1 },
      last_payment_error: { message: "Your card was declined." },
    }) } };

    await ok(await postVerifiedPaymentWebhook(event, db, "live"));
    assert.equal(db._state.payments[0].status, "failed");
    assert.equal(db._state.payments[0].notified_status, "failed");
    assert.equal(db._state.notifications?.length, 1, "the failed notice was not sent");

    await ok(await postVerifiedPaymentWebhook(event, db, "live"));
    assert.equal(db._state.notifications.length, 1, "a replay sent a second failed notice");
  });

  it("a stale failure for an older intent leaves a retried charge alone", async () => {
    const db = fakeDb({ payments: [{ id: P1, status: "pending", balance_due: 350, failure_reason: null, stripe_payment_intent_id: "pi_2", notified_status: null }] });
    await ok(await postVerifiedPaymentWebhook({ type: "payment_intent.payment_failed", data: { object: pi({
      id: "pi_1", metadata: { rentalId: RENTAL, reason: "rent", paymentIds: P1 },
      last_payment_error: { message: "Old attempt." },
    }) } }, db, "live"));
    assert.equal(db._state.payments[0].status, "pending", "a stale failure marked the retried charge failed");
    assert.equal(db._state.payments[0].failure_reason, null);
    assert.equal(db._state.notifications, undefined, "a stale failure sent a notice");
  });

  it("invoice.paid on a manually paid weekly charge claims one notice and keeps the manual record", async () => {
    const db = fakeDb({
      rentals: [{ id: RENTAL, application_id: null, vehicle_id: null, stripe_subscription_id: "sub_1" }],
      payments: [{ id: P1, stripe_invoice_id: "in_1", status: "paid", paid_date: "2026-10-01", balance_due: 0,
        failure_reason: "Weekly rent charge failed", notified_status: null }],
    }, { payments: ["stripe_invoice_id"] });
    const event = { type: "invoice.paid", data: { object: { id: "in_1", subscription: "sub_1", amount_paid: 35000, amount_due: 35000 } } };

    await ok(await postVerifiedPaymentWebhook(event, db, "live"));
    assert.equal(db._state.payments.length, 1, "a second weekly charge was written");
    assert.equal(db._state.payments[0].paid_date, "2026-10-01", "the manual record was re-dated");
    assert.equal(db._state.payments[0].notified_status, "paid");
    assert.equal(db._state.notifications?.length, 1, "the overlap notice was not sent");

    await ok(await postVerifiedPaymentWebhook(event, db, "live"));
    assert.equal(db._state.notifications.length, 1, "a replay sent a second overlap notice");
  });
});
