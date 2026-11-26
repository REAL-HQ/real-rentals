// A lead pays the $50 Reservation Fee before any rental exists (no rentalId on
// the intent). Run: bun test scripts/reservation-fee-paid-notices.test.ts
import assert from "node:assert/strict";
import { describe, it, mock } from "bun:test";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";

const sent: { kind: string; to: any; subject?: string }[] = [];
const noop = async () => ({ ok: true });
mock.module("../src/lib/email.server.ts", () => ({
    sendPaymentReceiptEmail: async (a: any) => { sent.push({ kind: "receipt", to: a.to, subject: `Payment Received ${a.amount} ${a.reason}` }); return { ok: true }; },
    sendPaymentFailedEmail: noop, sendCardExpiringEmail: noop, sendTeamPaymentAlertEmail: noop, sendRentReminderEmail: noop,
    getLeadAlertPrefs: async () => ({ recipients: ["team@example.com"], onNew: true, onComplete: true }),
    sendEmail: async (a: any) => { sent.push({ kind: "email", to: a.to, subject: a.subject }); return { ok: true }; },
}));
const { postVerifiedPaymentWebhook } = await import("../src/routes/api/public/payments/webhook.ts");

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let patch: Row | null = null; let ins: Row | null = null; let single = false;
    const f: ((r: Row) => boolean)[] = [];
    const b: any = {
      select() { return b; }, insert(r: Row) { op = "insert"; ins = r; return b; }, update(p: Row) { op = "update"; patch = p; return b; },
      eq(c: string, v: any) { f.push((r) => r[c] === v); return b; }, neq(c: string, v: any) { f.push((r) => r[c] !== v); return b; },
      in(c: string, vs: any[]) { f.push((r) => vs.includes(r[c])); return b; }, is(c: string, v: any) { f.push((r) => (r[c] ?? null) === v); return b; },
      or(expr: string) { const ps = expr.split(",").map((p) => p.split(".")); f.push((r) => ps.some(([c, o, ...v]) => o === "is" ? r[c] == null : o === "neq" ? String(r[c] ?? "") !== v.join(".") : String(r[c] ?? "") === v.join("."))); return b; },
      maybeSingle() { single = true; return b; }, limit() { return b; }, order() { return b; },
      then(res: any, rej: any) { return Promise.resolve().then(run).then(res, rej); },
    };
    function run() {
      const hit = state[table].filter((r) => f.every((x) => x(r)));
      if (op === "insert") { const row = { id: `gen-${state[table].length}`, ...ins }; state[table].push(row); return { data: [row], error: null }; }
      if (op === "update") { for (const r of hit) Object.assign(r, patch); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
      return single ? { data: hit[0] ?? null, error: null } : { data: hit, error: null };
    }
    return b;
  }
  return { from, rpc: async () => ({ data: null, error: null }), _state: state };
}

const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("Reservation Fee paid by a lead with no rental", () => {
  it("marks the row paid (revenue-visible), emails the renter and staff once", async () => {
    const db = fakeDb({
      payments: [{ id: P1, driver_id: APP, type: "fee", reason: "reservation_fee", status: "unpaid", amount: 50, balance_due: 50, failure_reason: null, notified_status: null, rental_id: null, paid_date: null }],
      applications: [{ id: APP, email: "lead@example.com", full_name: "Test Lead" }],
      rentals: [],
    });
    const event = { type: "payment_intent.succeeded", data: { object: { id: "pi_1", amount: 5000, metadata: { reason: "reservation_fee", applicationId: APP, agreementId: "ag1", paymentIds: P1 } } } };
    const r = await postVerifiedPaymentWebhook(event, db, "live");
    assert.equal(r.status, 200);
    const row = db._state.payments[0];
    assert.equal(row.status, "paid");
    assert.ok(row.paid_date);
    assert.equal(row.type, "fee");
    assert.equal(row.notified_status, "paid");
    assert.equal(sent.filter((m) => m.kind === "receipt" && m.to === "lead@example.com").length, 1, JSON.stringify(sent));
    assert.equal(sent.filter((m) => /Reservation Fee Paid/.test(m.subject ?? "")).length, 1, JSON.stringify(sent));
    // Stripe retries the event: nothing is sent again.
    await postVerifiedPaymentWebhook(event, db, "live");
    assert.equal(sent.length, 2, `replay re-sent: ${JSON.stringify(sent)}`);
  });
});
