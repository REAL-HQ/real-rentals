// Fallback match (phone, billing name) and the staff queue.
import { describe, expect, test } from "bun:test";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
import { postVerifiedPaymentWebhook } from "../src/routes/api/public/payments/webhook";
import { normalizePersonName } from "../src/lib/one-off-payment";
import { assignUnmatchedPayment, dismissUnmatchedPayment } from "../src/lib/unmatched-payments.server";

type Row = Record<string, any>;
const RENTAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const APP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APP2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RENTAL2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PI = "pi_TESTphone01";
const CH = "ch_TESTphone01";

function likeToRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") { out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (c === "%") out += ".*"; else if (c === "_") out += "."; else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

function fakeDb(seed: Record<string, Row[]>) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let nextId = 1;
  function from(table: string) {
    state[table] ??= [];
    let op: "select" | "insert" | "update" = "select";
    let payload: any = null;
    let single = false;
    const filters: ((r: Row) => boolean)[] = [];
    const b: any = {
      select() { return b; },
      insert(r: Row) { op = "insert"; payload = r; return b; },
      update(p: Row) { op = "update"; payload = p; return b; },
      eq(c: string, v: any) { filters.push((r) => r[c] === v); return b; },
      neq(c: string, v: any) { filters.push((r) => r[c] !== v); return b; },
      in(c: string, vs: any[]) { filters.push((r) => vs.includes(r[c])); return b; },
      is(c: string, v: any) { filters.push((r) => (r[c] ?? null) === v); return b; },
      ilike(c: string, p: string) { const re = likeToRegex(p); filters.push((r) => typeof r[c] === "string" && re.test(r[c])); return b; },
      maybeSingle() { single = true; return b; },
      limit() { return b; },
      order() { return b; },
      then(res: any, rej: any) { return Promise.resolve().then(run).then(res, rej); },
    };
    function run() {
      const hit = () => state[table].filter((r) => filters.every((f) => f(r)));
      if (op === "insert") {
        if (table === "payments" && payload.stripe_payment_intent_id && state.payments.some((r) => r.stripe_payment_intent_id === payload.stripe_payment_intent_id)) {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        const row = { id: `gen-${nextId++}`, ...payload };
        state[table].push(row);
        return { data: [row], error: null };
      }
      if (op === "update") {
        const h = hit();
        for (const r of h) Object.assign(r, payload);
        return { data: h.map((r) => ({ id: r.id })), error: null };
      }
      const h = hit();
      return single ? { data: h[0] ?? null, error: null } : { data: h, error: null };
    }
    return b;
  }
  return { from, _state: state };
}

const rental = (over: Row = {}) => ({ id: RENTAL, application_id: APP, vehicle_id: "veh-1", status: "active", stripe_customer_id: null, weekly_rate: 350, next_payment_due: "2026-11-16", ...over });
const session = (over: Row = {}) => ({
  id: "cs_phone", object: "checkout.session", mode: "payment", payment_status: "paid", status: "complete",
  customer: null, customer_details: { email: "nobody@example.com", name: "Pat Q" }, payment_intent: PI, payment_link: null,
  subscription: null, invoice: null, amount_total: 5000, currency: "usd", created: 1794881029,
  metadata: {}, ...over,
});
const intent = () => ({ id: PI, object: "payment_intent", status: "succeeded", amount: 5000, amount_received: 5000, currency: "usd", customer: null, metadata: {}, latest_charge: CH, created: 1794881029, description: null });
const charge = (over: Row = {}) => ({
  id: CH, object: "charge", paid: true, captured: true, status: "succeeded", amount: 5000, amount_captured: 5000, currency: "usd",
  customer: null, payment_intent: PI, metadata: {}, created: 1794881029, description: null,
  billing_details: { email: "nobody@example.com" }, receipt_url: null, payment_method_details: { type: "card" }, ...over,
});
function stripeStub(o: { session?: Row; charge?: Row; customer?: Row | null } = {}) {
  return {
    paymentIntents: { retrieve: async () => intent() },
    charges: { retrieve: async () => o.charge ?? charge() },
    checkout: { sessions: { list: async () => ({ data: [o.session ?? session()] }) } },
    invoicePayments: { list: async () => ({ data: [] }) },
    paymentLinks: { retrieve: async () => ({ id: "plink", metadata: {} }) },
    customers: { retrieve: async () => o.customer ?? { id: "cus_x", email: null, name: null, phone: null } },
  };
}
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const w = console.warn, e = console.error;
  console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; }
};
const send = (db: any, stripe: any, object: Row) => quiet(() => postVerifiedPaymentWebhook({ type: "checkout.session.completed", data: { object } }, db, "live", { stripe }));

describe("fallback match and unmatched queue", () => {
  test("names need two words", () => {
    expect(normalizePersonName("Regina")).toBeNull();
    expect(normalizePersonName("Regina Littles")).toBe("regina littles");
  });

  test("one phone match records the payment on the oldest open week", async () => {
    const db = fakeDb({
      rentals: [rental()],
      applications: [{ id: APP, email: "other@example.com", phone: "(813) 555-0199", full_name: "Pat Q", status: "active" }],
      payments: [{ id: "week", rental_id: RENTAL, type: "rent", status: "failed", amount: 50, balance_due: 50, due_date: "2026-11-14", late_fees: 0 }],
      notifications: [],
      app_settings: [],
      rent_late_fee_waivers: [],
      unmatched_stripe_payments: [],
    });
    const s = session({ customer_details: { email: "nobody@example.com", name: "Not The Renter", phone: "+18135550199" } });
    const res = await send(db, stripeStub({ session: s, charge: charge({ billing_details: { email: "nobody@example.com", phone: "+18135550199" } }) }), s);
    expect(res.status).toBe(200);
    const row = db._state.payments.find((p: Row) => p.stripe_payment_intent_id === PI);
    expect(row.rental_id).toBe(RENTAL);
    expect(row.due_date).toBe("2026-11-14");
    expect(row.notes).toMatch(/matched by phone/);
    expect(db._state.unmatched_stripe_payments).toHaveLength(0);
  });

  test("two people with the same billing name are queued, not guessed", async () => {
    const db = fakeDb({
      rentals: [rental(), rental({ id: RENTAL2, application_id: APP2 })],
      applications: [
        { id: APP, email: "a@example.com", phone: null, full_name: "Regina Littles", status: "active" },
        { id: APP2, email: "b@example.com", phone: null, full_name: "Regina Littles", status: "active" },
      ],
      payments: [], notifications: [], app_settings: [], unmatched_stripe_payments: [],
    });
    const s = session({ customer_details: { email: "nobody@example.com", name: "Regina Littles" } });
    await send(db, stripeStub({ session: s }), s);
    expect(db._state.payments.filter((p: Row) => p.stripe_payment_intent_id === PI)).toHaveLength(0);
    expect(db._state.unmatched_stripe_payments).toHaveLength(1);
    expect(db._state.unmatched_stripe_payments[0].why).toBe("ambiguous");
    expect(JSON.stringify(db._state.unmatched_stripe_payments[0])).not.toMatch(/555/);
  });

  test("one billing name records it; staff can dismiss a later gap", async () => {
    const db = fakeDb({
      rentals: [rental()],
      applications: [{ id: APP, email: "a@example.com", phone: null, full_name: "Regina Littles", status: "active" }],
      payments: [], notifications: [], app_settings: [], rent_late_fee_waivers: [], unmatched_stripe_payments: [],
    });
    const s = session({ customer_details: { email: "nobody@example.com", name: "Regina Littles" } });
    await send(db, stripeStub({ session: s, charge: charge({ billing_details: { email: "nobody@example.com", name: "Regina Littles" } }) }), s);
    const row = db._state.payments.find((p: Row) => p.stripe_payment_intent_id === PI);
    expect(row.notes).toMatch(/matched by name/);
    db._state.unmatched_stripe_payments.push({
      id: "11111111-1111-4111-8111-111111111111", status: "open", why: "no_match", amount_cents: 5000, currency: "usd",
      stripe_payment_intent_id: "pi_gap", stripe_charge_id: "ch_gap", renter_name: null, email: null,
    });
    await dismissUnmatchedPayment(db, { id: "11111111-1111-4111-8111-111111111111", note: "Not rent", actorId: "staff-1" });
    expect(db._state.unmatched_stripe_payments.at(-1).status).toBe("dismissed");
    await expect(assignUnmatchedPayment(db, { id: "11111111-1111-4111-8111-111111111111", rentalId: RENTAL, actorId: "staff-1" })).rejects.toThrow(/Dismissed/);
  });
});
