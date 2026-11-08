// Held renter payment notices: the webhook parks a notice held because the
// Automations switches were unreadable; the 5-minute sweep sends it once,
// or drops it across an Off, a later paid/waived/void/refunded change.
// Behavioral: real webhook handler + real sweep against a fake database,
// fake email provider. No Stripe or network.
import { describe, expect, mock, test, beforeEach } from "bun:test";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
process.env.RESEND_API_KEY = "test-only";
type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>) {
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
    const filters: ((r: Row) => boolean)[] = [];

    const b: any = {
      select() { return b; },
      insert(r: Row) { op = "insert"; inserted = r; return b; },
      update(p: Row) { op = "update"; patch = p; return b; },
      eq(c: string, v: any) { filters.push((r) => r[c] === v); return b; },
      neq(c: string, v: any) { filters.push((r) => r[c] !== v); return b; },
      in(c: string, vs: any[]) { filters.push((r) => vs.includes(r[c])); return b; },
      or(expr: string) { filters.push(orPredicate(expr)); return b; },
      maybeSingle() { single = true; return b; },
      single() { single = true; return b; },
      limit() { return b; },
      order() { return b; },
      then(res: any, rej: any) { return Promise.resolve().then(run).then(res, rej); },
    };

    function run() {
      const match = () => state[table].filter((r) => filters.every((f) => f(r)));
      if (op === "insert") {
        const row = { id: `gen-${nextId++}`, ...inserted };
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

let db: any;
let settingsMode: "ok" | "error" = "ok";
const proxy = {
  from: (t: string) => {
    if (t === "app_settings" && settingsMode === "error") {
      const b: any = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: null, error: { message: "down" } }) };
      return b;
    }
    return db.from(t);
  },
  rpc: (...a: any[]) => db.rpc(...a),
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: proxy }));
const sent: string[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url).includes("resend")) sent.push(JSON.parse(init.body).subject);
  return new Response(JSON.stringify({ id: "re_" + sent.length }), { status: 200 });
};
const { postVerifiedPaymentWebhook } = await import("../src/routes/api/public/payments/webhook.ts");
const { retryHeldPaymentNotices } = await import("@/lib/held-payment-notices.server");
const email = await import("@/lib/email.server");
const deps = { sendReceipt: email.sendPaymentReceiptEmail, sendFailed: email.sendPaymentFailedEmail };

const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RENTAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const seed = (pay: Row[], settings: Row[] = []) => fakeDb({
  payments: pay,
  rentals: [{ id: RENTAL, application_id: "app1", applications: { email: "r@example.com", full_name: "R", card_brand: "Visa", card_last4: "4242" }, vehicles: { license_plate: "X" } }],
  app_settings: settings,
});
const paidEvent = (ids = P1) => ({ type: "payment_intent.succeeded", data: { object: { id: "pi_1", amount: 35000, metadata: { rentalId: RENTAL, reason: "rent", paymentIds: ids } } } });
const failEvent = () => ({ type: "payment_intent.payment_failed", data: { object: { id: "pi_1", amount: 35000, metadata: { rentalId: RENTAL, reason: "rent", paymentIds: P1 }, last_payment_error: { message: "declined" } } } });
const receipts = () => sent.filter((s) => s.startsWith("Payment Received")).length;
const failures = () => sent.filter((s) => s.includes("Did Not Go Through")).length;

beforeEach(() => { sent.length = 0; settingsMode = "ok"; });

describe("webhook parks a held notice; sweep sends it once", () => {
  test("unreadable switches: receipt held, row parked held:paid, nothing sent", async () => {
    db = seed([{ id: P1, status: "pending", balance_due: 350, notified_status: null }]);
    settingsMode = "error";
    expect((await postVerifiedPaymentWebhook(paidEvent(), db, "live")).status).toBe(200);
    expect(receipts()).toBe(0);
    expect(db._state.payments[0]).toMatchObject({ status: "paid", notified_status: "held:paid" });
    expect(db._state.email_deliveries?.some((d: Row) => d.workflow === "payment_receipt" && d.state === "failed")).toBe(true);
  });
  test("sweep while still unreadable does nothing", async () => {
    db = seed([{ id: P1, status: "paid", notified_status: "held:paid", amount: 350, rental_id: RENTAL }]);
    settingsMode = "error";
    expect((await retryHeldPaymentNotices(proxy, deps)).skipped).toBe("settings_unreadable");
    expect(db._state.payments[0].notified_status).toBe("held:paid");
  });
  test("sweep after recovery sends exactly one receipt; a second sweep and a Stripe replay send none", async () => {
    db = seed([{ id: P1, status: "paid", notified_status: "held:paid", amount: 350, rental_id: RENTAL, reason: "rent" }]);
    expect((await retryHeldPaymentNotices(proxy, deps)).sent).toBe(1);
    expect(db._state.payments[0].notified_status).toBe("paid");
    await retryHeldPaymentNotices(proxy, deps);
    await postVerifiedPaymentWebhook(paidEvent(), db, "live");
    expect(receipts()).toBe(1);
  });
  test("Owner switched it off meanwhile: dropped, never sent later", async () => {
    db = seed([{ id: P1, status: "paid", notified_status: "held:paid", amount: 350, rental_id: RENTAL }], [{ key: "automation_controls", value: { off: { payment_receipt: { at: "t", by: "o" } } } }]);
    expect((await retryHeldPaymentNotices(proxy, deps)).dropped).toBe(1);
    expect(db._state.payments[0].notified_status).toBe("paid");
    db._state.app_settings.length = 0;
    await retryHeldPaymentNotices(proxy, deps);
    expect(receipts()).toBe(0);
  });
  for (const now of ["paid", "waived", "void", "refunded"]) {
    test(`held failure notice is dropped once the charge is ${now}`, async () => {
      db = seed([{ id: P1, status: now, notified_status: "held:failed", amount: 350, rental_id: RENTAL }]);
      await retryHeldPaymentNotices(proxy, deps);
      expect(failures()).toBe(0);
      expect(db._state.payments[0].notified_status).toBe("failed");
    });
  }
  test("held failure notice still failed → sent once", async () => {
    db = seed([{ id: P1, status: "failed", notified_status: "held:failed", amount: 350, rental_id: RENTAL }]);
    expect((await retryHeldPaymentNotices(proxy, deps)).sent).toBe(1);
    expect(failures()).toBe(1);
  });
  test("a re-held send is parked again, not marked notified", async () => {
    db = seed([{ id: P1, status: "paid", notified_status: "held:paid", amount: 350, rental_id: RENTAL }]);
    const r = await retryHeldPaymentNotices(proxy, { ...deps, sendReceipt: async () => ({ ok: false, blocked: "held" as const }) });
    expect(r.stillHeld).toBe(1);
    expect(db._state.payments[0].notified_status).toBe("held:paid");
  });
  test("webhook failure path parks held:failed", async () => {
    db = seed([{ id: P1, status: "pending", balance_due: 350, notified_status: null, stripe_payment_intent_id: "pi_1" }]);
    settingsMode = "error";
    await postVerifiedPaymentWebhook(failEvent(), db, "live");
    expect(db._state.payments[0]).toMatchObject({ status: "failed", notified_status: "held:failed" });
  });
  test("Owner Off at webhook time is not parked (intentionally not sent)", async () => {
    db = seed([{ id: P1, status: "pending", balance_due: 350, notified_status: null }], [{ key: "automation_controls", value: { off: { payment_receipt: { at: "t", by: "o" } } } }]);
    await postVerifiedPaymentWebhook(paidEvent(), db, "live");
    expect(receipts()).toBe(0);
    expect(db._state.payments[0].notified_status).toBe("paid");
  });
  test("multi-row charge is not parked (one receipt covers several rows)", async () => {
    db = seed([{ id: P1, status: "pending", balance_due: 1, notified_status: null }, { id: P2, status: "pending", balance_due: 1, notified_status: null }]);
    settingsMode = "error";
    await postVerifiedPaymentWebhook(paidEvent(`${P1},${P2}`), db, "live");
    expect(db._state.payments.every((p: Row) => p.notified_status === "paid")).toBe(true);
  });
  test("healthy switches: webhook sends the receipt directly, nothing parked", async () => {
    db = seed([{ id: P1, status: "pending", balance_due: 350, notified_status: null }]);
    await postVerifiedPaymentWebhook(paidEvent(), db, "live");
    expect(receipts()).toBe(1);
    expect(db._state.payments[0].notified_status).toBe("paid");
  });
});

describe("SMS setup check (read-only)", async () => {
  const { runSmsSetupCheck } = await import("@/lib/sms-setup-check.server");
  test("missing settings, rejected, ok — GET only, no secrets in the answer", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const f: any = async (url: string, init: any) => { calls.push({ url, method: init.method }); return new Response(JSON.stringify(url.includes("IncomingPhoneNumbers") ? { incoming_phone_numbers: [{}] } : { status: "active" }), { status: 200 }); };
    expect((await runSmsSetupCheck({}, f)).status).toBe("not_set_up");
    expect((await runSmsSetupCheck({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "sek" }, f)).status).toBe("sender_missing");
    const ok = await runSmsSetupCheck({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "sek", TWILIO_FROM_NUMBER: "+15550100000" }, f);
    expect(ok.status).toBe("ok");
    expect(JSON.stringify(ok)).not.toMatch(/AC1|sek|5550100000/);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls.some((c) => c.url.includes("Messages"))).toBe(false);
    const rej: any = async () => new Response("{}", { status: 401 });
    expect((await runSmsSetupCheck({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "x", TWILIO_FROM_NUMBER: "+1" }, rej)).status).toBe("rejected");
  });
});
