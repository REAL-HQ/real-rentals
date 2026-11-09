// Quo (formerly OpenPhone) SMS provider. Behavioral: the real sendSms,
// Quo client and Quo webhook handler against a fake database and a mocked
// fetch. The network is refused for anything else — no text ever leaves.
import { describe, expect, mock, test, beforeEach } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";

type Row = Record<string, any>;
let db: ReturnType<typeof fakeDb>;

function fakeDb(seed: Record<string, Row[]>) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let nextId = 1;
  function from(table: string) {
    state[table] ??= [];
    let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    let payload: any = null;
    let single: "one" | "maybe" | null = null;
    let lim: number | null = null;
    const filters: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q,
      insert: (r: Row) => { op = "insert"; payload = r; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      upsert: (r: Row) => { op = "upsert"; payload = r; return q; },
      delete: () => { op = "delete"; return q; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      in: (c: string, v: any[]) => { filters.push((r) => v.includes(r[c])); return q; },
      gte: (c: string, v: any) => { filters.push((r) => String(r[c]) >= String(v)); return q; },
      or: (expr: string) => {
        expect(expr).toBe("kind.is.null,kind.not.like.inbound_*");
        filters.push((r) => r.kind == null || !String(r.kind).startsWith("inbound_"));
        return q;
      },
      order: () => q,
      limit: (n: number) => { lim = n; return q; },
      maybeSingle: () => { single = "maybe"; return q; },
      single: () => { single = "one"; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = state[table];
      const match = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "insert") {
        const r = { id: `row-${nextId++}`, created_at: new Date().toISOString(), ...payload };
        if (table === "outbound_messages" && r.enrollment_id && r.step_id
          && rows.some((x) => x.enrollment_id === r.enrollment_id && x.step_id === r.step_id)) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint "outbound_messages_enrollment_step_idx"' } };
        }
        rows.push(r);
        return { data: single ? { id: r.id } : null, error: null };
      }
      if (op === "update") { for (const r of match) Object.assign(r, payload); return { data: null, error: null }; }
      if (op === "upsert") {
        const ex = rows.find((r) => r.phone === payload.phone);
        if (ex) Object.assign(ex, payload); else rows.push({ ...payload });
        return { data: null, error: null };
      }
      if (op === "delete") { state[table] = rows.filter((r) => !match.includes(r)); return { data: null, error: null }; }
      const out = lim != null ? match.slice(0, lim) : match;
      if (single) return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    }
    return q;
  }
  return { from, state };
}

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: new Proxy({}, { get: (_t, p) => (db as any)[p] }),
}));

type Call = { url: string; init: any };
let calls: Call[] = [];
let respond: (call: Call) => Promise<Response> | Response;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any) => {
  const call = { url: String(url), init };
  if (!String(url).startsWith("https://api.quo.com/")) throw new Error(`network refused in test: ${url}`);
  calls.push(call);
  return respond(call);
}) as any;
void realFetch;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const accepted = (id = "AC123") => json(202, { data: { id, status: "queued", to: ["+15555550123"], from: "+18888338280", text: "x" } });

const APP = "11111111-1111-4111-8111-111111111111";
function seed() {
  db = fakeDb({
    applications: [{ id: APP, phone: "(555) 555-0123", sms_consent: true, sms_opt_out_at: null }],
    outbound_messages: [],
    sms_opt_outs: [],
  });
}

const { sendSms } = await import("@/lib/sms.server");
const quo = await import("@/lib/quo.server");
const provider = await import("@/lib/sms-provider.server");

function setEnv(env: Record<string, string | undefined>) {
  for (const k of ["QUO_API_KEY", "QUO_PHONE_NUMBER_ID", "QUO_FROM_NUMBERS", "SMS_DRY_RUN", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_MESSAGING_SERVICE_SID", "QUO_WEBHOOK_KEY"]) delete process.env[k];
  Object.assign(process.env, env);
}

beforeEach(() => {
  seed();
  calls = [];
  respond = () => accepted();
  setEnv({ QUO_API_KEY: "quo-test-key" });
});

describe("provider selection", () => {
  test("Quo wins when its key is set; Twilio untouched otherwise; none when empty", () => {
    expect(provider.smsProviderStatus({ QUO_API_KEY: "k" })).toMatchObject({ provider: "quo", ready: true, sender: "PNrZULvFMn" });
    // The default may only be an allowlisted number.
    expect(provider.smsProviderStatus({ QUO_API_KEY: "k", QUO_PHONE_NUMBER_ID: "PNother1" }).sender).toBe("PNrZULvFMn");
    expect(provider.smsProviderStatus({ QUO_API_KEY: "k", QUO_PHONE_NUMBER_ID: "PNcX8a0PLJ" }).sender).toBe("PNcX8a0PLJ");
    expect(provider.smsProviderStatus({ QUO_API_KEY: "k", QUO_PHONE_NUMBER_ID: "+18888338280" }).sender).toBe("PNrZULvFMn");
    expect(provider.smsProviderStatus({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+1555" })).toMatchObject({ provider: "twilio", ready: true });
    expect(provider.smsProviderStatus({ TWILIO_ACCOUNT_SID: "AC" })).toMatchObject({ provider: "twilio", ready: false });
    expect(provider.smsProviderStatus({})).toMatchObject({ provider: "none", ready: false });
    expect(provider.smsProviderStatus({ QUO_API_KEY: "k", SMS_DRY_RUN: "true" }).dryRun).toBe(true);
  });
});

describe("sending-number allowlist", () => {
  test("exactly the 888 and 813 lines, 888 first by default", () => {
    expect(provider.quoSenders({}).map((x) => [x.id, x.e164])).toEqual([["PNrZULvFMn", "+18888338280"], ["PNcX8a0PLJ", "+18132124174"]]);
    expect(provider.resolveQuoSender(undefined, {})?.id).toBe("PNrZULvFMn");
    expect(provider.resolveQuoSender("", {})?.id).toBe("PNrZULvFMn");
    expect(provider.resolveQuoSender("PNcX8a0PLJ", {})?.id).toBe("PNcX8a0PLJ");
    expect(provider.resolveQuoSender("PNsomeoneElse", {})).toBeNull();
    expect(provider.resolveQuoSender("+18132124174", {})).toBeNull();
  });
  test("QUO_FROM_NUMBERS can narrow the list but never add to it", () => {
    expect(provider.quoSenders({ QUO_FROM_NUMBERS: "PNrZULvFMn" }).map((x) => x.id)).toEqual(["PNrZULvFMn"]);
    expect(provider.resolveQuoSender("PNcX8a0PLJ", { QUO_FROM_NUMBERS: "PNrZULvFMn" })).toBeNull();
    expect(provider.quoSenders({ QUO_FROM_NUMBERS: "PNrZULvFMn,PNinjected" }).map((x) => x.id)).toEqual(["PNrZULvFMn"]);
    expect(provider.quoSenders({ QUO_FROM_NUMBERS: "PNinjected" }).map((x) => x.id)).toEqual(["PNrZULvFMn"]);
  });
  test("a logged number maps back to its line (used for the conversation default)", () => {
    expect(provider.quoSenderFor("+18132124174", {})?.id).toBe("PNcX8a0PLJ");
    expect(provider.quoSenderFor("PNrZULvFMn", {})?.id).toBe("PNrZULvFMn");
    expect(provider.quoSenderFor("+15555550123", {})).toBeNull();
    expect(provider.quoSenderFor(null, {})).toBeNull();
  });
});

describe("sendSms through Quo", () => {
  test("Send From 813: Quo gets PNcX8a0PLJ and the log records +18132124174", async () => {
    const r = await sendSms({ to: "5555550123", body: "From the 813", applicationId: APP, fromId: "PNcX8a0PLJ" });
    expect(r.ok).toBe(true);
    expect(JSON.parse(calls[0].init.body).from).toBe("PNcX8a0PLJ");
    expect(db.state.outbound_messages[0]).toMatchObject({ status: "sent", from_address: "+18132124174" });
  });

  test("no sender chosen (automations, activation, agreements): default 888", async () => {
    await sendSms({ to: "5555550123", body: "Step", kind: "automation", applicationId: APP, enrollmentId: "e9", stepId: "s9" });
    expect(JSON.parse(calls[0].init.body).from).toBe("PNrZULvFMn");
    expect(db.state.outbound_messages[0].from_address).toBe("+18888338280");
  });

  test("a sender off the allowlist is refused before any log or send", async () => {
    for (const bad of ["PNsomeoneElse", "+18132124174", "PNcX8a0PLJ "]) {
      const r = await sendSms({ to: "5555550123", body: `x ${bad}`, applicationId: APP, fromId: bad });
      expect(r).toEqual({ ok: false, skipped: true, reason: "sender_not_allowed" });
    }
    expect(calls.length).toBe(0);
    expect(db.state.outbound_messages.length).toBe(0);
  });

  test("a narrowed allowlist refuses the removed line", async () => {
    setEnv({ QUO_API_KEY: "quo-test-key", QUO_FROM_NUMBERS: "PNrZULvFMn" });
    expect(await sendSms({ to: "5555550123", body: "x", applicationId: APP, fromId: "PNcX8a0PLJ" })).toEqual({ ok: false, skipped: true, reason: "sender_not_allowed" });
    expect(calls.length).toBe(0);
  });

  test("choosing a Quo line while Twilio is the provider is refused", async () => {
    setEnv({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+15550000000" });
    expect(await sendSms({ to: "5555550123", body: "x", applicationId: APP, fromId: "PNcX8a0PLJ" })).toEqual({ ok: false, skipped: true, reason: "sender_not_allowed" });
    expect(calls.length).toBe(0);
  });

  test("success: one POST with the documented shape, logged as sent with Quo's id", async () => {
    const r = await sendSms({ to: "(555) 555-0123", body: "Hello from REAL", kind: "staff_message", applicationId: APP });
    expect(r).toEqual({ ok: true, id: "AC123" });
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("https://api.quo.com/messages");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe("quo-test-key");
    expect(calls[0].init.headers["Quo-Api-Version"]).toBe("2026-03-30");
    expect(JSON.parse(calls[0].init.body)).toEqual({ content: "Hello from REAL", from: "PNrZULvFMn", to: ["+15555550123"] });
    const log = db.state.outbound_messages;
    expect(log.length).toBe(1);
    expect(log[0]).toMatchObject({ status: "sent", provider: "quo", provider_message_id: "AC123", to_address: "+15555550123", from_address: "+18888338280", application_id: APP, error: null });
    expect(log[0].sent_at).toBeTruthy();
    expect(JSON.stringify(log)).not.toContain("quo-test-key");
  });

  test("4xx: logged failed with Quo's reason, not retried", async () => {
    respond = () => json(402, { title: "Not Enough Credits", message: "Out of credits", status: 402 });
    const r = await sendSms({ to: "5555550123", body: "a", applicationId: APP });
    expect(r).toEqual({ ok: false, error: "Not Enough Credits: Out of credits" });
    expect(calls.length).toBe(1);
    expect(db.state.outbound_messages[0]).toMatchObject({ status: "failed", provider: "quo" });
  });

  test("5xx: never resent; stays queued as Unconfirmed and blocks an immediate repeat", async () => {
    respond = () => json(500, { title: "Unexpected", message: "boom" });
    const r = await sendSms({ to: "5555550123", body: "rent due", applicationId: APP });
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(1);
    expect(db.state.outbound_messages[0].status).toBe("queued");
    expect(db.state.outbound_messages[0].error).toMatch(/^Unconfirmed: /);
    const again = await sendSms({ to: "5555550123", body: "rent due", applicationId: APP });
    expect(again).toEqual({ ok: false, skipped: true, reason: "duplicate" });
    expect(calls.length).toBe(1);
  });

  test("timeout / network drop: one attempt, Unconfirmed, no blind resend", async () => {
    respond = () => { throw new DOMException("timed out", "TimeoutError"); };
    const r = await sendSms({ to: "5555550123", body: "x", applicationId: APP });
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toMatch(/did not answer in time/);
    expect(calls.length).toBe(1);
    expect(db.state.outbound_messages[0]).toMatchObject({ status: "queued" });
  });

  test("idempotent retry: identical text to the same number within the window is not resent", async () => {
    const a = await sendSms({ to: "5555550123", body: "Your car is ready", applicationId: APP });
    const b = await sendSms({ to: "+1 555 555 0123", body: "Your car is ready", applicationId: APP });
    expect(a.ok).toBe(true);
    expect(b).toEqual({ ok: false, skipped: true, reason: "duplicate" });
    expect(calls.length).toBe(1);
    // A different text still goes.
    const c = await sendSms({ to: "5555550123", body: "Different text", applicationId: APP });
    expect(c.ok).toBe(true);
    expect(calls.length).toBe(2);
  });

  test("an inbound text with the same words does not block our reply", async () => {
    db.state.outbound_messages.push({ id: "in1", channel: "sms", to_address: "+15555550123", body: "ok", status: "sent", kind: "inbound_other", created_at: new Date().toISOString() });
    const r = await sendSms({ to: "5555550123", body: "ok", applicationId: APP });
    expect(r.ok).toBe(true);
  });

  test("automation step: claimed before sending, so an overlapping run cannot double-text", async () => {
    const step = { kind: "automation", applicationId: APP, enrollmentId: "e1", stepId: "s1" };
    const a = await sendSms({ to: "5555550123", body: "Step 1", ...step });
    const b = await sendSms({ to: "5555550123", body: "Step 1 (edited)", ...step });
    expect(a.ok).toBe(true);
    expect(b).toEqual({ ok: false, skipped: true, reason: "duplicate" });
    expect(calls.length).toBe(1);
  });

  test("missing key: nothing sent, logged skipped, not_configured", async () => {
    setEnv({});
    const r = await sendSms({ to: "5555550123", body: "x", applicationId: APP });
    expect(r).toEqual({ ok: false, skipped: true, reason: "not_configured" });
    expect(calls.length).toBe(0);
    expect(db.state.outbound_messages[0]).toMatchObject({ status: "skipped", error: "sms provider not configured" });
  });

  test("dry run: logs what would go out, never calls Quo", async () => {
    setEnv({ QUO_API_KEY: "quo-test-key", SMS_DRY_RUN: "true" });
    const r = await sendSms({ to: "5555550123", body: "preview", applicationId: APP });
    expect(r).toEqual({ ok: false, skipped: true, reason: "dry_run" });
    expect(calls.length).toBe(0);
    expect(db.state.outbound_messages[0]).toMatchObject({ status: "skipped", provider: "quo", error: "dry run: not sent", from_address: "+18888338280" });
  });

  test("opted out (our ledger): never reaches Quo", async () => {
    db.state.sms_opt_outs.push({ phone: "+15555550123", reason: "inbound STOP" });
    const r = await sendSms({ to: "5555550123", body: "x", applicationId: APP, requireConsent: false });
    expect(r).toEqual({ ok: false, skipped: true, reason: "opted_out" });
    expect(calls.length).toBe(0);
  });

  test("no consent on file: never reaches Quo", async () => {
    db.state.applications[0].sms_consent = false;
    const r = await sendSms({ to: "5555550123", body: "x", applicationId: APP });
    expect(r).toEqual({ ok: false, skipped: true, reason: "no_consent" });
    expect(calls.length).toBe(0);
  });

  test("Quo says opted out: mirrored into our opt-out ledger", async () => {
    respond = () => json(400, { title: "User Opted Out", message: "User has opted out of receiving messages" });
    const r = await sendSms({ to: "5555550123", body: "x", applicationId: APP });
    expect(r).toEqual({ ok: false, skipped: true, reason: "opted_out" });
    expect(db.state.sms_opt_outs).toEqual([{ phone: "+15555550123", reason: "Quo reported opt-out" }]);
    expect(db.state.outbound_messages[0]).toMatchObject({ status: "failed", error: "recipient opted out (Quo)" });
  });

  test("bad number: junk never reaches Quo; Quo-rejected number is reported invalid", async () => {
    expect(await sendSms({ to: "12345", body: "x", applicationId: APP })).toEqual({ ok: false, skipped: true, reason: "invalid_phone" });
    expect(calls.length).toBe(0);
    respond = () => json(400, { title: "Invalid `to` Phone Number", message: "At least one recipient in `to` is invalid" });
    expect(await sendSms({ to: "5555550123", body: "x", applicationId: APP })).toEqual({ ok: false, skipped: true, reason: "invalid_phone" });
  });

  test("log write failure: refuses to send rather than text without a record", async () => {
    const orig = db.from;
    (db as any).from = (t: string) => {
      const q = orig(t);
      if (t !== "outbound_messages") return q;
      const ins = q.insert;
      q.insert = (r: Row) => { ins(r); q.then = (res: any) => Promise.resolve({ data: null, error: { message: "permission denied" } }).then(res); return q; };
      return q;
    };
    const r = await sendSms({ to: "5555550123", body: "x", applicationId: APP });
    expect(r).toEqual({ ok: false, error: "could not record the text before sending" });
    expect(calls.length).toBe(0);
  });
});

describe("Quo client", () => {
  test("429 per-second rate limit is retried once; daily cap is not", async () => {
    let n = 0;
    const f = (async () => (++n === 1 ? json(429, { title: "Too Many Requests" }) : accepted("AC9"))) as any;
    const slept: number[] = [];
    const r = await quo.sendQuoMessage({ apiKey: "k", from: "PNx", to: "+15555550123", content: "hi", fetchFn: f, sleep: async (ms) => { slept.push(ms); } });
    expect(r).toEqual({ ok: true, id: "AC9", status: "queued" });
    expect(n).toBe(2);
    expect(slept.length).toBe(1);
    let m = 0;
    const daily = (async () => { m++; return json(429, { title: "Daily Conversation Limit Reached", code: "0200429" }); }) as any;
    const d = await quo.sendQuoMessage({ apiKey: "k", from: "PNx", to: "+15555550123", content: "hi", fetchFn: daily, sleep: async () => {} });
    expect(d.ok).toBe(false);
    expect(m).toBe(1);
  });

  test("content over 1600 characters is refused locally", async () => {
    const f = (async () => { throw new Error("should not be called"); }) as any;
    const r = await quo.sendQuoMessage({ apiKey: "k", from: "PNx", to: "+15555550123", content: "x".repeat(1601), fetchFn: f });
    expect(r.ok).toBe(false);
  });

  test("setup check is GET-only and never sends", async () => {
    const seen: any[] = [];
    const f = (async (u: string, i: any) => { seen.push([u, i.method]); return json(200, { data: { id: "PNrZULvFMn" } }); }) as any;
    expect(await quo.checkQuoSetup("k", "PNrZULvFMn", f)).toBe("ok");
    expect(seen).toEqual([["https://api.quo.com/phone-numbers/PNrZULvFMn", "GET"]]);
    const { runSmsSetupCheck } = await import("@/lib/sms-setup-check.server");
    const both: string[] = [];
    const okBoth = await runSmsSetupCheck({ QUO_API_KEY: "k" }, (async (u: string, i: any) => { expect(i.method).toBe("GET"); both.push(u); return json(200, {}); }) as any);
    expect(both).toEqual(["https://api.quo.com/phone-numbers/PNrZULvFMn", "https://api.quo.com/phone-numbers/PNcX8a0PLJ"]);
    expect(okBoth.status).toBe("ok");
    expect(okBoth.detail).toContain("REAL Rentals (888) 833-8280: OK");
    expect(okBoth.detail).toContain("Primary (813) 212-4174: OK");
    const half = await runSmsSetupCheck({ QUO_API_KEY: "k" }, (async (u: string) => json(u.endsWith("PNcX8a0PLJ") ? 404 : 200, {})) as any);
    expect(half.status).toBe("sender_missing");
    expect(half.detail).toContain("Primary (813) 212-4174: Not Found In Quo");
    expect((await runSmsSetupCheck({ QUO_API_KEY: "k" }, (async () => json(401, {})) as any)).status).toBe("rejected");
    expect((await runSmsSetupCheck({ QUO_API_KEY: "k" }, (async () => json(404, {})) as any)).status).toBe("sender_missing");
  });
});

describe("Quo webhook", () => {
  const SECRET = "whsec_" + Buffer.from("test-signing-secret-32-bytes-long!").toString("base64");
  const now = Math.floor(Date.now() / 1000);
  async function signed(body: unknown, opts: { secret?: string; ts?: number; id?: string } = {}) {
    const raw = JSON.stringify(body);
    const id = opts.id ?? "msg_1";
    const ts = String(opts.ts ?? now);
    const sig = await quo.signQuoWebhook(opts.secret ?? SECRET, id, ts, raw);
    return new Request("https://drivereal.com/api/public/sms/quo", {
      method: "POST", body: raw,
      headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` },
    });
  }
  const received = (text: string, pn = "PNrZULvFMn", id = "ACin1") => ({
    type: "message.received",
    data: { resource: { id, direction: "incoming", text, status: "received" }, context: { phoneNumberId: pn, senderIdentifier: "+15555550123", recipientIdentifiers: ["+18888338280"] } },
  });

  test("valid signature: inbound text handed to the shared inbound handler once", async () => {
    setEnv({ QUO_API_KEY: "k", QUO_WEBHOOK_KEY: SECRET });
    const { handleQuoWebhook } = await import("@/lib/quo-webhook.server");
    const seen: any[] = [];
    const processInbound = async (a: any) => { seen.push(a); db.state.outbound_messages.push({ provider: "quo", provider_message_id: a.providerMessageId }); };
    const r1 = await handleQuoWebhook(await signed(received("STOP")), { admin: db, processInbound });
    expect(r1.status).toBe(200);
    expect(seen).toEqual([{ from: "+15555550123", to: "+18888338280", body: "STOP", provider: "quo", providerMessageId: "ACin1" }]);
    const r2 = await handleQuoWebhook(await signed(received("STOP")), { admin: db, processInbound });
    expect(r2.status).toBe(200);
    expect(seen.length).toBe(1);
  });

  test("signature matches the documented Node crypto recipe", async () => {
    const { createHmac } = await import("node:crypto");
    const raw = '{"type":"message.received"}';
    const expected = createHmac("sha256", Buffer.from(SECRET.slice(6), "base64")).update(`wh_1.${now}.${raw}`).digest("base64");
    expect(await quo.signQuoWebhook(SECRET, "wh_1", String(now), raw)).toBe(expected);
    expect(await quo.verifyQuoWebhook(SECRET, { id: "wh_1", timestamp: String(now), signature: `v1,bogus v1,${expected}` }, raw, now)).toBe(true);
  });

  test("forged, stale or unsigned deliveries are rejected before reading", async () => {
    setEnv({ QUO_WEBHOOK_KEY: SECRET });
    const { handleQuoWebhook } = await import("@/lib/quo-webhook.server");
    const processInbound = async () => { throw new Error("must not run"); };
    const forged = await signed(received("STOP"), { secret: "whsec_" + Buffer.from("wrong-secret").toString("base64") });
    expect((await handleQuoWebhook(forged, { admin: db, processInbound })).status).toBe(403);
    const stale = await signed(received("STOP"), { ts: now - 3600 });
    expect((await handleQuoWebhook(stale, { admin: db, processInbound })).status).toBe(403);
    const bare = new Request("https://x/api/public/sms/quo", { method: "POST", body: JSON.stringify(received("STOP")) });
    expect((await handleQuoWebhook(bare, { admin: db, processInbound })).status).toBe(403);
    setEnv({});
    expect((await handleQuoWebhook(await signed(received("STOP")), { admin: db, processInbound })).status).toBe(503);
  });

  test("texts to either allowlisted line are accepted and tagged with that line", async () => {
    setEnv({ QUO_WEBHOOK_KEY: SECRET });
    const { handleQuoWebhook } = await import("@/lib/quo-webhook.server");
    const seen: any[] = [];
    const processInbound = async (a: any) => { seen.push(a); };
    expect((await handleQuoWebhook(await signed(received("hi 888", "PNrZULvFMn", "ACa")), { admin: db, processInbound })).status).toBe(200);
    expect((await handleQuoWebhook(await signed(received("hi 813", "PNcX8a0PLJ", "ACb")), { admin: db, processInbound })).status).toBe(200);
    expect(seen.map((x) => [x.body, x.to])).toEqual([["hi 888", "+18888338280"], ["hi 813", "+18132124174"]]);
  });

  test("events for any other Quo number (or none) are ignored", async () => {
    setEnv({ QUO_WEBHOOK_KEY: SECRET });
    const { handleQuoWebhook } = await import("@/lib/quo-webhook.server");
    const processInbound = async () => { throw new Error("must not run"); };
    expect((await handleQuoWebhook(await signed(received("hi", "PNnotOurs")), { admin: db, processInbound })).status).toBe(200);
    const noLine = { type: "message.received", data: { resource: { id: "ACz", text: "hi" }, context: { senderIdentifier: "+15555550123" } } };
    expect((await handleQuoWebhook(await signed(noLine), { admin: db, processInbound })).status).toBe(200);
    // A narrowed allowlist also narrows the webhook.
    setEnv({ QUO_WEBHOOK_KEY: SECRET, QUO_FROM_NUMBERS: "PNrZULvFMn" });
    expect((await handleQuoWebhook(await signed(received("hi", "PNcX8a0PLJ")), { admin: db, processInbound })).status).toBe(200);
  });

  test("message.failed marks our log row failed", async () => {
    setEnv({ QUO_WEBHOOK_KEY: SECRET });
    db.state.outbound_messages.push({ id: "o1", provider: "quo", provider_message_id: "ACout", status: "sent" });
    const { handleQuoWebhook } = await import("@/lib/quo-webhook.server");
    const ev = { type: "message.failed", data: { resource: { id: "ACout" }, context: { phoneNumberId: "PNrZULvFMn" } } };
    expect((await handleQuoWebhook(await signed(ev), { admin: db })).status).toBe(200);
    expect(db.state.outbound_messages[0]).toMatchObject({ status: "failed", error: "Quo: message failed" });
  });
});

describe("boundaries (source)", () => {
  function walk(dir: string, out: string[] = []) {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n)) out.push(p);
    }
    return out;
  }
  test("the Quo key is only read in server-only modules", () => {
    const readers = walk("src").filter((f) => /QUO_API_KEY/.test(readFileSync(f, "utf8")));
    expect(readers.length).toBeGreaterThan(0);
    for (const f of readers) expect(f).toMatch(/\.server\.ts$/);
  });
  test("staff texting stays behind requireStaff before any send", () => {
    const src = readFileSync("src/lib/messages.functions.ts", "utf8");
    const h = src.slice(src.indexOf("export const sendStaffMessage"));
    expect(h.indexOf("await requireStaff(context.userId)")).toBeGreaterThan(-1);
    expect(h.indexOf("await requireStaff(context.userId)")).toBeLessThan(h.indexOf("sendSms("));
    expect(h).toMatch(/requireSupabaseAuth/);
  });
  test("Send From is validated server-side and both send paths keep their role gates", () => {
    const msg = readFileSync("src/lib/messages.functions.ts", "utf8");
    const h = msg.slice(msg.indexOf("export const sendStaffMessage"));
    expect(h).toMatch(/fromId: z\.string\(\)\.trim\(\)\.regex\(\/\^PN/);
    expect(h.indexOf("await requireStaff(context.userId)")).toBeLessThan(h.indexOf("resolveQuoSender(data.fromId)"));
    expect(h).toMatch(/fromId: data\.fromId \?\? null/);
    const share = readFileSync("src/lib/vehicle-share.functions.ts", "utf8");
    const sh = share.slice(share.indexOf("export const sendVehicleSharePackage"));
    expect(sh).toMatch(/fromId: z\.string\(\)\.trim\(\)\.regex\(\/\^PN/);
    expect(sh.indexOf("await requireManager(context.userId)")).toBeGreaterThan(-1);
    expect(sh.indexOf("await requireManager(context.userId)")).toBeLessThan(sh.indexOf("sendSms("));
    // Automations never pass a sender, so they keep the default line.
    expect(readFileSync("src/lib/automations.server.ts", "utf8")).not.toMatch(/fromId/);
  });
  test("one Title Case Send From control in Messages and Vehicle Share", () => {
    const ui = readFileSync("src/components/admin/MessagesOverlay.tsx", "utf8");
    expect((ui.match(/Send From/g) ?? []).length).toBe(2); // visible label + aria-label
    expect(ui).toContain('data-testid="sms-send-from"');
    const share = readFileSync("src/components/admin/VehicleShareSendPanel.tsx", "utf8");
    expect(share).toContain(">Send From</label>");
  });
  test("no automation switch, workflow or campaign flag is touched by the Quo work", () => {
    for (const f of ["src/lib/sms.server.ts", "src/lib/quo.server.ts", "src/lib/sms-provider.server.ts", "src/lib/quo-webhook.server.ts"]) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/automation_workflows|app_settings|is_active|ENABLED\s*=/);
    }
  });
  test("staff see plain reasons for texts that did not go out", async () => {
    const { smsSkipMessage } = await import("@/lib/sms-messages");
    expect(smsSkipMessage("duplicate")).toMatch(/already sent/);
    expect(smsSkipMessage("dry_run")).toMatch(/^Test Mode/);
    expect(smsSkipMessage("opted_out")).toMatch(/opted out/);
  });
  test("UI text uses Title Case for the toast labels", () => {
    const ui = readFileSync("src/components/admin/MessagesOverlay.tsx", "utf8");
    expect(ui).toContain('"Text Sent"');
    expect(ui).toContain("sms-sender-note");
  });
});
