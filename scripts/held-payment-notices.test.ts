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
const missingTables = new Set<string>();
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
        if (op === "lt") return row[col] != null && String(row[col]) < val;
        throw new Error(`fakeDb: unsupported or() clause ${p}`);
      });
  };

  function from(table: string) {
    state[table] ??= [];
    let op: "select" | "insert" | "update" | "upsert" = "select";
    let upsertOpts: any = null;
    let patch: Row | null = null;
    let inserted: Row | null = null;
    let single = false;
    const filters: ((r: Row) => boolean)[] = [];

    const b: any = {
      select() { return b; },
      insert(r: Row) { op = "insert"; inserted = r; return b; },
      update(p: Row) { op = "update"; patch = p; return b; },
      upsert(r: Row, o: any) { op = "upsert"; inserted = r; upsertOpts = o; return b; },
      lt(c: string, v: any) { filters.push((r) => r[c] < v); return b; },
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
      if (op === "upsert") {
        if (missingTables.has(table)) return { data: null, error: { message: "relation does not exist" } };
        const keys = String(upsertOpts?.onConflict ?? "id").split(",");
        const dup = state[table].find((r) => keys.every((k) => r[k] === (inserted as Row)[k]));
        if (dup) return { data: [], error: null };
        const t = new Date().toISOString();
        state[table].push({ id: `gen-${nextId++}`, attempts: 0, created_at: t, updated_at: t, ...inserted });
        return { data: [], error: null };
      }
      if (missingTables.has(table)) return { data: null, error: { message: "relation does not exist" } };
      if (op === "insert") {
        // payments has a unique index on stripe_invoice_id (as in production).
        if (table === "payments" && (inserted as Row).stripe_invoice_id && state[table].some((r) => r.stripe_invoice_id === (inserted as Row).stripe_invoice_id))
          return { data: null, error: { code: "23505", message: "duplicate key" } };
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
const sentTo: string[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url).includes("resend")) { const b = JSON.parse(init.body); sent.push(b.subject); sentTo.push([b.to].flat().join(",")); }
  return new Response(JSON.stringify({ id: "re_" + sent.length }), { status: 200 });
};
const { postVerifiedPaymentWebhook } = await import("../src/routes/api/public/payments/webhook.ts");
const { retryHeldNotices } = await import("@/lib/held-payment-notices.server");
const email = await import("@/lib/email.server");
const deps = { sendReceipt: email.sendPaymentReceiptEmail, sendFailed: email.sendPaymentFailedEmail, sendCardExpiring: email.sendCardExpiringEmail, sendTeamAlert: email.sendTeamPaymentAlertEmail };

const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RENTAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RETRY_ON = { on: { held_retry: { at: "t", by: "o" } } };
const seed = (pay: Row[], settings: Row[] = [{ key: "automation_controls", value: RETRY_ON }]) => fakeDb({
  payments: pay,
  rentals: [{ id: RENTAL, application_id: "app1", stripe_subscription_id: "sub_1", applications: { email: "r@example.com", full_name: "R", card_brand: "Visa", card_last4: "4242", card_exp_month: 12, card_exp_year: 2099 }, vehicles: { license_plate: "X" } }],
  app_settings: settings,
});
const paidEvent = (ids = P1) => ({ type: "payment_intent.succeeded", data: { object: { id: "pi_1", amount: 35000, metadata: { rentalId: RENTAL, reason: "rent", paymentIds: ids } } } });
const failEvent = () => ({ type: "payment_intent.payment_failed", data: { object: { id: "pi_1", amount: 35000, metadata: { rentalId: RENTAL, reason: "rent", paymentIds: P1 }, last_payment_error: { message: "declined" } } } });
const receipts = () => sent.filter((s) => s.startsWith("Payment Received")).length;
const failures = () => sent.filter((s) => s.includes("Could Not Be Processed")).length;

const teamAlerts = () => sentTo.filter((t) => !t.includes("r@example.com")).length;
const bells = () => (db._state.notifications ?? []).length;
const queue = () => (db._state.held_notices ?? []) as Row[];
const OFF = (k: string) => [{ key: "automation_controls", value: { ...RETRY_ON, off: { [k]: { at: "t", by: "o" } } } }];
const held = (o: Row): Row => ({ id: "h" + Math.random(), kind: "payment_receipt", source_ref: "pi_1", rental_id: RENTAL, payment_ids: [P1], outcome: "paid", amount: 350, reason: "rent", status: "held", attempts: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...o });
const invoiceEvent = (type: string, attempt?: number) => ({ type, data: { object: { id: "in_1", subscription: "sub_1", amount_due: 35000, amount_paid: type.endsWith("failed") ? 0 : 35000, period_start: 1790000000, ...(attempt ? { attempt_count: attempt } : {}) } } });

beforeEach(() => { sent.length = 0; sentTo.length = 0; settingsMode = "ok"; missingTables.clear(); });

describe("held notices: webhook queues references, sweep sends once", () => {
  test("unreadable switches: receipt queued, notice claim kept, nothing sent, no body stored", async () => {
    db = seed([{ id: P1, status: "pending", balance_due: 350, notified_status: null }]);
    settingsMode = "error";
    expect((await postVerifiedPaymentWebhook(paidEvent(), db, "live")).status).toBe(200);
    expect(receipts()).toBe(0);
    expect(db._state.payments[0]).toMatchObject({ status: "paid", notified_status: "paid" });
    expect(queue()).toHaveLength(1);
    expect(queue()[0]).toMatchObject({ kind: "payment_receipt", source_ref: "pi_1", payment_ids: [P1], status: "held" });
    expect(JSON.stringify(queue()[0])).not.toMatch(/r@example\.com|<div|html/i);
  });
  test("Stripe replays while held: no second bell, no second team alert, one queue row", async () => {
    db = seed([{ id: P1, status: "pending", balance_due: 350, notified_status: null, stripe_payment_intent_id: "pi_1" }]);
    settingsMode = "error";
    await postVerifiedPaymentWebhook(failEvent(), db, "live");
    const b1 = bells();
    await postVerifiedPaymentWebhook(failEvent(), db, "live");
    await postVerifiedPaymentWebhook(failEvent(), db, "live");
    expect(bells()).toBe(b1);
    expect(teamAlerts()).toBe(0);
    expect(queue().filter((q) => q.kind === "payment_failed")).toHaveLength(1);
    expect(queue().filter((q) => q.kind === "payment_team_alert")).toHaveLength(1);
    settingsMode = "ok";
    await retryHeldNotices(proxy, deps);
    await retryHeldNotices(proxy, deps);
    await postVerifiedPaymentWebhook(failEvent(), db, "live");
    expect(failures()).toBe(1);
    expect(teamAlerts()).toBe(1);
    expect(bells()).toBe(b1);
  });
  test("sweep while still unreadable does nothing", async () => {
    db = seed([{ id: P1, status: "paid" }]); db._state.held_notices = [held({})];
    settingsMode = "error";
    expect((await retryHeldNotices(proxy, deps)).skipped).toBe("settings_unreadable");
    expect(queue()[0].status).toBe("held");
  });
  test("queue table missing (migration not applied): webhook still 200, sweep skips", async () => {
    db = seed([{ id: P1, status: "pending", balance_due: 350, notified_status: null }]);
    missingTables.add("held_notices"); settingsMode = "error";
    expect((await postVerifiedPaymentWebhook(paidEvent(), db, "live")).status).toBe(200);
    settingsMode = "ok";
    expect((await retryHeldNotices(proxy, deps)).skipped).toBe("queue_unavailable");
    expect(receipts()).toBe(0);
  });
  test("multi-row charge: one queue row with every payment id, one receipt", async () => {
    db = seed([{ id: P1, status: "pending", balance_due: 1, notified_status: null }, { id: P2, status: "pending", balance_due: 1, notified_status: null }]);
    settingsMode = "error";
    await postVerifiedPaymentWebhook(paidEvent(`${P1},${P2}`), db, "live");
    expect(queue()).toHaveLength(1);
    expect([...queue()[0].payment_ids].sort()).toEqual([P1, P2]);
    settingsMode = "ok";
    expect((await retryHeldNotices(proxy, deps)).sent).toBe(1);
    expect(receipts()).toBe(1);
  });
  test("weekly subscription invoice paid: queued by invoice id, sent once", async () => {
    db = seed([]);
    settingsMode = "error";
    await postVerifiedPaymentWebhook(invoiceEvent("invoice.paid"), db, "live");
    await postVerifiedPaymentWebhook(invoiceEvent("invoice.paid"), db, "live");
    expect(receipts()).toBe(0);
    expect(queue().filter((q) => q.source_ref === "in_1" && q.kind === "payment_receipt")).toHaveLength(1);
    settingsMode = "ok";
    await retryHeldNotices(proxy, deps); await retryHeldNotices(proxy, deps);
    expect(receipts()).toBe(1);
  });
  test("weekly invoice failed: failure + team alert queued, sent once each", async () => {
    db = seed([]);
    settingsMode = "error";
    await postVerifiedPaymentWebhook(invoiceEvent("invoice.payment_failed"), db, "live");
    expect(queue().map((q) => q.kind).sort()).toEqual(["payment_failed", "payment_team_alert"]);
    settingsMode = "ok";
    await retryHeldNotices(proxy, deps); await retryHeldNotices(proxy, deps);
    expect(failures()).toBe(1);
    expect(teamAlerts()).toBe(1);
  });
  test("card-expiring notice: sent while still expiring, dropped once the card was replaced", async () => {
    db = seed([{ id: P1, status: "paid" }]);
    db._state.rentals[0].applications.card_exp_month = new Date().getMonth() + 1;
    db._state.rentals[0].applications.card_exp_year = new Date().getFullYear();
    db._state.held_notices = [held({ kind: "card_expiring" })];
    expect((await retryHeldNotices(proxy, deps)).sent).toBe(1);
    expect(sent.filter((s) => s.includes("is expiring"))).toHaveLength(1);
    db = seed([{ id: P1, status: "paid" }]); db._state.held_notices = [held({ kind: "card_expiring" })];
    expect((await retryHeldNotices(proxy, deps)).dropped).toBe(1);
  });
  test("Owner switched it off meanwhile: dropped, never sent after switching back on", async () => {
    db = seed([{ id: P1, status: "paid" }], OFF("payment_receipt")); db._state.held_notices = [held({})];
    expect((await retryHeldNotices(proxy, deps)).dropped).toBe(1);
    db._state.app_settings[0].value = RETRY_ON;
    await retryHeldNotices(proxy, deps);
    expect(receipts()).toBe(0);
  });
  test("older than 7 days: dropped", async () => {
    db = seed([{ id: P1, status: "paid" }]); db._state.held_notices = [held({ created_at: new Date(Date.now() - 8 * 86400000).toISOString() })];
    expect((await retryHeldNotices(proxy, deps)).dropped).toBe(1);
    expect(receipts()).toBe(0);
  });
  test("receipt for a charge since refunded: dropped", async () => {
    db = seed([{ id: P1, status: "refunded" }]); db._state.held_notices = [held({})];
    expect((await retryHeldNotices(proxy, deps)).dropped).toBe(1);
  });
  for (const now of ["paid", "waived", "void", "refunded"]) {
    test(`failure notice and team alert dropped once the charge is ${now}`, async () => {
      db = seed([{ id: P1, status: now }]);
      db._state.held_notices = [held({ kind: "payment_failed", outcome: "failed" }), held({ kind: "payment_team_alert", outcome: "failed" })];
      expect((await retryHeldNotices(proxy, deps)).dropped).toBe(2);
      expect(failures() + teamAlerts()).toBe(0);
    });
  }
  test("still held on retry: stays queued", async () => {
    db = seed([{ id: P1, status: "paid" }]); db._state.held_notices = [held({})];
    const r = await retryHeldNotices(proxy, { ...deps, sendReceipt: async () => ({ ok: false, blocked: "held" as const }) });
    expect(r.stillHeld).toBe(1);
    expect(queue()[0].status).toBe("held");
  });
  test("send threw or stuck in sending: marked failed, never resent", async () => {
    db = seed([{ id: P1, status: "paid" }]);
    db._state.held_notices = [held({}), held({ source_ref: "pi_2", status: "sending", updated_at: new Date(Date.now() - 3600000).toISOString() })];
    const r = await retryHeldNotices(proxy, { ...deps, sendReceipt: async () => { throw new Error("x"); } });
    expect(r.failed).toBe(1);
    expect(queue().map((q) => q.status)).toEqual(["failed", "failed"]);
    await retryHeldNotices(proxy, deps);
    expect(receipts()).toBe(0);
  });
  test("Owner Off at webhook time is not queued (intentionally not sent)", async () => {
    db = seed([{ id: P1, status: "pending", balance_due: 350, notified_status: null }], OFF("payment_receipt"));
    await postVerifiedPaymentWebhook(paidEvent(), db, "live");
    expect(receipts()).toBe(0);
    expect(queue()).toHaveLength(0);
  });
  test("Held Retry is off by default: a queued notice is never sent", async () => {
    db = seed([{ id: P1, status: "paid" }], []); db._state.held_notices = [held({})];
    expect((await retryHeldNotices(proxy, deps)).skipped).toBe("retry_off");
    expect(receipts()).toBe(0);
    expect(queue()[0].status).toBe("held");
  });
  test("healthy switches: webhook sends directly, nothing queued", async () => {
    db = seed([{ id: P1, status: "pending", balance_due: 350, notified_status: null }]);
    await postVerifiedPaymentWebhook(paidEvent(), db, "live");
    expect(receipts()).toBe(1);
    expect(queue()).toHaveLength(0);
  });
});

describe("weekly rent failure: one notice per Stripe attempt", () => {
  const FAIL = "invoice.payment_failed";
  const bellsTitled = (t: string) => (db._state.notifications ?? []).filter((n: Row) => n.title === t).length;
  test("replayed failure event: one bell, one renter email, one team alert", async () => {
    db = seed([]);
    for (let i = 0; i < 3; i++) expect((await postVerifiedPaymentWebhook(invoiceEvent(FAIL, 1), db, "live")).status).toBe(200);
    expect(bellsTitled("Weekly Rent Failed")).toBe(1);
    expect(failures()).toBe(1);
    expect(teamAlerts()).toBe(1);
    expect(db._state.payments).toHaveLength(1);
    expect(db._state.payments[0]).toMatchObject({ status: "failed", notified_status: "failed:a0001" });
  });
  test("concurrent duplicate deliveries: still one of each", async () => {
    db = seed([]);
    await Promise.all([1, 2, 3, 4].map(() => postVerifiedPaymentWebhook(invoiceEvent(FAIL, 1), db, "live")));
    expect(bellsTitled("Weekly Rent Failed")).toBe(1);
    expect(failures()).toBe(1);
    expect(teamAlerts()).toBe(1);
  });
  test("Stripe's next retry attempt fails too: a genuinely new failure notifies once more", async () => {
    db = seed([]);
    await postVerifiedPaymentWebhook(invoiceEvent(FAIL, 1), db, "live");
    await postVerifiedPaymentWebhook(invoiceEvent(FAIL, 2), db, "live");
    await postVerifiedPaymentWebhook(invoiceEvent(FAIL, 2), db, "live");
    expect(bellsTitled("Weekly Rent Failed")).toBe(2);
    expect(failures()).toBe(2);
    expect(teamAlerts()).toBe(2);
  });
  test("a late, older attempt arriving after a newer one notifies nothing", async () => {
    db = seed([]);
    await postVerifiedPaymentWebhook(invoiceEvent(FAIL, 3), db, "live");
    await postVerifiedPaymentWebhook(invoiceEvent(FAIL, 1), db, "live");
    expect(failures()).toBe(1);
    expect(bellsTitled("Weekly Rent Failed")).toBe(1);
  });
  test("attempt 10 orders after attempt 9 (zero-padded keys)", async () => {
    db = seed([]);
    await postVerifiedPaymentWebhook(invoiceEvent(FAIL, 9), db, "live");
    await postVerifiedPaymentWebhook(invoiceEvent(FAIL, 10), db, "live");
    expect(failures()).toBe(2);
  });
  test("failure then paid: one receipt, paid replay sends nothing more", async () => {
    db = seed([]);
    await postVerifiedPaymentWebhook(invoiceEvent(FAIL, 1), db, "live");
    await postVerifiedPaymentWebhook(invoiceEvent("invoice.paid"), db, "live");
    await postVerifiedPaymentWebhook(invoiceEvent("invoice.paid"), db, "live");
    expect(receipts()).toBe(1);
    expect(bellsTitled("Weekly Rent Paid")).toBe(1);
    expect(db._state.payments[0].status).toBe("paid");
  });
  test("a row our own collection is mid-charging is not failed or notified", async () => {
    db = seed([{ id: P1, rental_id: RENTAL, status: "pending", last_attempt_at: "2026-11-07T00:00:00Z", stripe_invoice_id: "in_1", notified_status: null }]);
    await postVerifiedPaymentWebhook(invoiceEvent(FAIL, 1), db, "live");
    expect(db._state.payments.find((p: Row) => p.id === P1).status).toBe("pending");
    expect(failures() + teamAlerts()).toBe(0);
  });
});

describe("held receipt is event-specific: paid receipts are sent, not dropped", () => {
  test("held receipt for a paid charge sends; a held failure notice for the same paid charge drops", async () => {
    db = seed([{ id: P1, status: "paid" }]);
    db._state.held_notices = [held({ kind: "payment_receipt", outcome: "paid" }), held({ kind: "payment_failed", outcome: "failed", source_ref: "pi_9" })];
    const r = await retryHeldNotices(proxy, deps);
    expect(r.sent).toBe(1); expect(r.dropped).toBe(1);
    expect(receipts()).toBe(1); expect(failures()).toBe(0);
  });
  test("multi-row receipt drops only if any covered row is no longer paid", async () => {
    db = seed([{ id: P1, status: "paid" }, { id: P2, status: "refunded" }]);
    db._state.held_notices = [held({ payment_ids: [P1, P2] })];
    expect((await retryHeldNotices(proxy, deps)).dropped).toBe(1);
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
