// FLEET webhooks, Quo events on both lines, and the lead activity log.
// Fake database + mocked fetch: every network call is refused unless a test
// supplies its own fetch, so nothing ever leaves. Migration SQL runs in PGlite.
import { beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;

const fw = await import("@/lib/fleet-webhook.server");
const qe = await import("@/lib/quo-events.server");
const quo = await import("@/lib/quo.server");
const { handleQuoWebhook } = await import("@/lib/quo-webhook.server");

// ---------------------------------------------------------------- fake db
type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  const unique: Record<string, string> = { fleet_webhook_deliveries: "dedupe_key", quo_events: "quo_event_id" };
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false; let lim: number | null = null; let wantRows = false;
    let order: { c: string; asc: boolean } | null = null;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => { wantRows = true; return q; },
      insert: (r: Row) => { op = "insert"; payload = r; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      upsert: (r: Row, o: any) => { op = o?.ignoreDuplicates ? "insert_ignore" : "insert"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      lte: (c: string, v: any) => { f.push((r) => String(r[c]) <= String(v)); return q; },
      ilike: (c: string, p: string) => { const re = new RegExp("^" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i"); f.push((r) => re.test(String(r[c] ?? ""))); return q; },
      order: (c: string, o?: any) => { order = { c, asc: o?.ascending !== false }; return q; },
      limit: (x: number) => { lim = x; return q; },
      maybeSingle: () => { single = true; return q; },
      single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = state[table];
      if (op === "insert" || op === "insert_ignore") {
        const u = unique[table];
        if (u && rows.some((r) => r[u] === payload[u])) return { data: [], error: null };
        const r = { id: `${table}-${n++}`, created_at: new Date().toISOString(), attempts: 0, next_attempt_at: new Date(0).toISOString(), ...payload };
        rows.push(r);
        return { data: wantRows ? [{ id: r.id }] : null, error: null };
      }
      let m = rows.filter((r) => f.every((x) => x(r)));
      if (op === "update") { for (const r of m) Object.assign(r, payload); return { data: wantRows ? m.map((r) => ({ id: r.id })) : null, error: null }; }
      if (order) { const { c, asc } = order; m = [...m].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (asc ? 1 : -1)); }
      if (lim != null) m = m.slice(0, lim);
      return { data: single ? m[0] ?? null : m, error: null };
    }
    return q;
  }
  return { from, state };
}

const APP = "11111111-1111-4111-8111-111111111111";
function leadSeed(): Record<string, Row[]> {
  return {
    applications: [{
      id: APP, full_name: "Jordan Test", phone: "(813) 555-0142", email: "jordan@example.com", status: "reviewing",
      sms_consent: true, sms_consent_at: "2026-11-14T15:00:00.000Z", sms_opt_out_at: null, source: "homepage",
      background_check_status: "pending", deposit_status: null, deposit_paid: false, pickup_date: "2026-11-20", pickup_time: "10:30",
      created_at: "2026-11-14T15:00:00.000Z", address: "1 Main St, Tampa FL", profile_screenshot_url: null,
    }],
    documents: [
      { driver_id: APP, category: "license_front", review_status: "pending", is_current: true },
      { driver_id: APP, category: "license_back", review_status: "rejected", is_current: true },
      { driver_id: APP, category: "gig_profile", review_status: "pending", is_current: true },
    ],
    payments: [{ id: "p1", driver_id: APP, type: "deposit", status: "paid" }],
    agreements: [{ application_id: APP, status: "voided", signed_at: "2026-11-10T00:00:00Z", voided_at: "2026-11-11T00:00:00Z" }],
    outbound_messages: [
      { application_id: APP, channel: "sms", status: "sent", kind: "automation", workflow_id: "wf", step_id: "s2", sent_at: "2026-11-14T15:05:00.000Z", from_address: "+18888338280" },
      { application_id: APP, channel: "sms", status: "skipped", kind: "automation", step_id: "s3", sent_at: "2026-11-15T15:05:00.000Z" },
      { application_id: APP, channel: "email", status: "sent", kind: "automation", step_id: "s1", sent_at: "2026-11-16T15:05:00.000Z" },
    ],
    fleet_webhook_deliveries: [], quo_events: [],
  };
}
const ENV_ON = { FLEET_WEBHOOK_URL: "https://fleet.example.test/hooks/lead", FLEET_WEBHOOK_KEY: "fleet-test-key" };

describe("FLEET config", () => {
  test("disabled until both URL and key are set, https only", () => {
    expect(fw.fleetWebhookConfig({}).enabled).toBe(false);
    expect(fw.fleetWebhookConfig({ FLEET_WEBHOOK_URL: ENV_ON.FLEET_WEBHOOK_URL }).enabled).toBe(false);
    expect(fw.fleetWebhookConfig({ FLEET_WEBHOOK_KEY: "k" }).enabled).toBe(false);
    expect(fw.fleetWebhookConfig({ FLEET_WEBHOOK_URL: "http://fleet.example.test/x", FLEET_WEBHOOK_KEY: "k" }).enabled).toBe(false);
  });
  test("default Authorization: Bearer <key>; custom header gets the raw key; scheme override; signing secret defaults to key", () => {
    expect(fw.fleetWebhookConfig(ENV_ON)).toMatchObject({ enabled: true, authHeader: "Authorization", authValue: "Bearer fleet-test-key", signingSecret: "fleet-test-key" });
    expect(fw.fleetWebhookConfig({ ...ENV_ON, FLEET_WEBHOOK_AUTH_HEADER: "X-Api-Key" })).toMatchObject({ authHeader: "X-Api-Key", authValue: "fleet-test-key" });
    expect(fw.fleetWebhookConfig({ ...ENV_ON, FLEET_WEBHOOK_AUTH_SCHEME: "Token" })).toMatchObject({ authValue: "Token fleet-test-key" });
    expect(fw.fleetWebhookConfig({ ...ENV_ON, FLEET_WEBHOOK_SIGNING_SECRET: "sig" })).toMatchObject({ signingSecret: "sig" });
  });
  test("signature equals the documented Node recipe", async () => {
    const body = '{"event":"lead_created"}';
    const expected = "v1=" + createHmac("sha256", "s3cret").update(`1763150400.${body}`).digest("hex");
    expect(await fw.signFleetBody("s3cret", "1763150400", body)).toBe(expected);
    expect(readFileSync("docs/fleet-webhooks.md", "utf8")).toContain('createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex")');
  });
  test("retry backoff", () => {
    expect([1, 2, 3, 4].map(fw.retryDelayMs)).toEqual([60_000, 300_000, 900_000, 3_600_000]);
    expect(fw.FLEET_MAX_ATTEMPTS).toBe(8);
  });
});

describe("lead payload", () => {
  test("every field FLEET asked for", async () => {
    const db = fakeDb(leadSeed());
    const p = await fw.buildLeadPayload(db, { event: "stage_changed", applicationId: APP, stage: "reviewing", previousStage: "new" });
    expect(p).toEqual({
      event: "stage_changed", lead_id: APP, name: "Jordan Test", phone: "+18135550142", email: "jordan@example.com",
      stage: "reviewing", previous_stage: "new", current_stage: "reviewing",
      sms_consent: true, consent_timestamp: "2026-11-14T15:00:00.000Z", source: "homepage",
      docs: { received: ["license_front", "gig_profile_screenshot", "home_address"], missing: ["license_back"], optional_missing: ["income"] },
      background_check_status: "pending", reservation_fee_paid: true, agreement_signed: false,
      pickup_at: "2026-11-20T10:30:00-05:00", created_at: "2026-11-14T15:00:00.000Z",
      last_text_sent: { type: "automation", template: "s2", workflow_id: "wf", step_id: "s2", sent_at: "2026-11-14T15:05:00.000Z", status: "sent", from: "+18888338280" },
    });
  });
  test("lead_created has no previous_stage; opted-out reads as no consent", async () => {
    const seed = leadSeed();
    seed.applications[0].sms_opt_out_at = "2026-11-14T16:00:00Z";
    const p = await fw.buildLeadPayload(fakeDb(seed), { event: "lead_created", applicationId: APP, stage: "partial" });
    expect(p).not.toHaveProperty("previous_stage");
    expect(p).toMatchObject({ stage: "partial", sms_consent: false, consent_timestamp: null });
  });
  test("pickup_at handles daylight time and date-only", () => {
    expect(fw.pickupAt("2026-07-01", "09:00")).toBe("2026-07-01T09:00:00-04:00");
    expect(fw.pickupAt("2026-07-01", null)).toBe("2026-07-01");
    expect(fw.pickupAt(null, "09:00")).toBeNull();
  });
});

describe("dispatch", () => {
  let db: ReturnType<typeof fakeDb>;
  beforeEach(async () => {
    db = fakeDb(leadSeed());
    await fw.enqueueFleetEvent(db, { event_type: "lead_created", dedupe_key: `lead_created:${APP}`, application_id: APP, payload: { stage: "partial" } });
  });

  test("not configured: nothing sent, row marked skipped (no backlog replay later)", async () => {
    const calls: any[] = [];
    const r = await fw.dispatchFleetWebhooks(db, {}, { env: {}, fetch: (async (...a: any[]) => { calls.push(a); return new Response("ok"); }) as any });
    expect(r).toMatchObject({ disabled: true, skipped: 1, delivered: 0 });
    expect(calls.length).toBe(0);
    expect(db.state.fleet_webhook_deliveries[0]).toMatchObject({ status: "skipped" });
    expect(db.state.fleet_webhook_deliveries[0].last_error).toContain("not sent");
  });

  test("enqueue is idempotent on the dedupe key", async () => {
    expect(await fw.enqueueFleetEvent(db, { event_type: "lead_created", dedupe_key: `lead_created:${APP}`, application_id: APP, payload: {} })).toBeNull();
    expect(db.state.fleet_webhook_deliveries.length).toBe(1);
  });

  test("configured: one signed POST with the auth header; delivery logged with the exact payload", async () => {
    const calls: { url: string; init: any }[] = [];
    const now = Date.parse("2026-11-14T20:00:00Z");
    const r = await fw.dispatchFleetWebhooks(db, {}, { env: ENV_ON, now: () => now, fetch: (async (url: any, init: any) => { calls.push({ url, init }); return new Response("ok", { status: 200 }); }) as any });
    expect(r).toMatchObject({ delivered: 1, disabled: false });
    expect(calls.length).toBe(1);
    const { url, init } = calls[0];
    expect(url).toBe(ENV_ON.FLEET_WEBHOOK_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer fleet-test-key");
    expect(init.headers["X-Real-Event"]).toBe("lead_created");
    const row = db.state.fleet_webhook_deliveries[0];
    expect(init.headers["X-Real-Delivery-Id"]).toBe(row.id);
    const ts = init.headers["X-Real-Timestamp"];
    expect(ts).toBe(String(now / 1000));
    expect(init.headers["X-Real-Signature"]).toBe("v1=" + createHmac("sha256", "fleet-test-key").update(`${ts}.${init.body}`).digest("hex"));
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ event: "lead_created", lead_id: APP, stage: "partial", delivery_id: row.id, phone: "+18135550142" });
    expect(row).toMatchObject({ status: "delivered", attempts: 1, last_status_code: 200, last_error: null });
    expect(row.payload.lead_id).toBe(APP);
  });

  test("failure retries with backoff, then stops as failed after the last attempt", async () => {
    let now = Date.parse("2026-11-14T20:00:00Z");
    const fail = (async () => new Response("nope", { status: 503 })) as any;
    const r1 = await fw.dispatchFleetWebhooks(db, {}, { env: ENV_ON, now: () => now, fetch: fail });
    expect(r1.retrying).toBe(1);
    const row = db.state.fleet_webhook_deliveries[0];
    expect(row).toMatchObject({ status: "pending", attempts: 1, last_status_code: 503 });
    expect(row.last_error).toContain("HTTP 503");
    expect(Date.parse(row.next_attempt_at) - now).toBe(60_000);
    // Not due yet: nothing happens.
    expect((await fw.dispatchFleetWebhooks(db, {}, { env: ENV_ON, now: () => now + 1000, fetch: fail })).retrying).toBe(0);
    for (let i = 2; i <= fw.FLEET_MAX_ATTEMPTS; i++) {
      now = Date.parse(row.next_attempt_at) + 1;
      await fw.dispatchFleetWebhooks(db, {}, { env: ENV_ON, now: () => now, fetch: fail });
    }
    expect(row).toMatchObject({ status: "failed", attempts: fw.FLEET_MAX_ATTEMPTS });
    now += 86400_000;
    const calls: any[] = [];
    await fw.dispatchFleetWebhooks(db, {}, { env: ENV_ON, now: () => now, fetch: (async (...a: any[]) => { calls.push(a); return new Response("ok"); }) as any });
    expect(calls.length).toBe(0);
  });

  test("network error is logged and retried", async () => {
    await fw.dispatchFleetWebhooks(db, {}, { env: ENV_ON, fetch: (async () => { throw new Error("ECONNRESET"); }) as any });
    expect(db.state.fleet_webhook_deliveries[0]).toMatchObject({ status: "pending", attempts: 1, last_error: "ECONNRESET" });
  });
});

// ---------------------------------------------------------------- Quo, both lines
describe("Quo events on both lines → activity log + FLEET", () => {
  const SECRET = "whsec_" + Buffer.from("test-signing-secret-32-bytes-long!").toString("base64");
  const nowS = Math.floor(Date.now() / 1000);
  async function signed(body: unknown, id = "wh_" + Math.random().toString(36).slice(2)) {
    const raw = JSON.stringify(body);
    const sig = await quo.signQuoWebhook(SECRET, id, String(nowS), raw);
    return new Request("https://drivereal.com/api/public/sms/quo", { method: "POST", body: raw, headers: { "webhook-id": id, "webhook-timestamp": String(nowS), "webhook-signature": `v1,${sig}` } });
  }
  const L813 = "PNcX8a0PLJ"; const L888 = "PNrZULvFMn";
  const text = (id: string, pn: string, from = "+18135550142") => ({ id, type: "message.received", apiVersion: "2026-03-30", createdAt: "2026-11-14T20:00:00.000Z",
    data: { resource: { id: `AC${id}`, direction: "incoming", text: "Is a car still open?", createdAt: "2026-11-14T20:00:00.000Z" }, context: { phoneNumberId: pn, senderIdentifier: from, recipientIdentifiers: [pn === L813 ? "+18132124174" : "+18888338280"] } } });
  const callDone = (id: string, pn: string, ext = "+15555550199") => ({ id, type: "call.completed", createdAt: "2026-11-14T20:01:00.000Z",
    data: { resource: { id: "CA1", direction: "incoming", status: "completed", createdAt: "2026-11-14T20:00:00.000Z", completedAt: "2026-11-14T20:01:00.000Z", duration: 61, hasVoicemail: false },
      context: { phoneNumberId: pn, conversationId: "CN1", participants: { workspace: [], external: [ext] } } } });
  const voicemail = (id: string, pn: string) => ({ id, type: "call.voicemail.completed",
    data: { resource: { id: "VM1", voicemailId: "VM1", callId: "CA2", direction: "incoming", duration: 22, from: "+18135550142", to: pn === L813 ? "+18132124174" : "+18888338280",
      transcript: "Hi, calling about the car.", recordingUrl: "https://files.quo.example/vm1.mp3", createdAt: "2026-11-14T20:02:00.000Z" }, context: { phoneNumberId: pn } } });
  const transcript = (id: string, pn: string) => ({ id, type: "call.transcript.completed",
    data: { resource: { callId: "CA3", createdAt: "2026-11-14T20:03:00.000Z", duration: 30, processingStatus: "completed",
      dialogue: [{ identifier: "+18135550142", content: "When can I pick up?", start: 0, end: 2 }, { identifier: "+18888338280", userId: "US1", content: "Tomorrow at 10.", start: 2, end: 4 }] },
      context: { phoneNumberId: pn, participants: { external: [{ identifier: "+18135550142" }] } } } });
  const missed = (id: string, pn: string) => ({ id, type: "call.missed", data: { resource: { id: "CA4", createdAt: "2026-11-14T20:04:00.000Z" }, context: { phoneNumberId: pn, participants: { external: ["+18135550142"] } } } });

  let db: ReturnType<typeof fakeDb>;
  let dispatched: string[][];
  let inbound: any[];
  const deps = () => ({ admin: db, processInbound: async (a: any) => { inbound.push(a); }, dispatch: async (_: any, ids: string[]) => { dispatched.push(ids); } });
  beforeEach(() => {
    db = fakeDb({ ...leadSeed(), applications: [{ ...leadSeed().applications[0] }, { id: "dup", phone: "813-555-0142", status: "duplicate", created_at: "2026-11-15T00:00:00Z" }] });
    dispatched = []; inbound = [];
    for (const k of ["QUO_WEBHOOK_KEY", "QUO_INBOUND_NUMBER_IDS", "QUO_FROM_NUMBERS"]) delete process.env[k];
    process.env.QUO_WEBHOOK_KEY = SECRET;
  });
  test("text on 813 from a lead: threaded as before, logged on the lead with the line, forwarded to FLEET at once", async () => {
    expect((await handleQuoWebhook(await signed(text("EV1", L813)), deps())).status).toBe(200);
    expect(inbound).toEqual([{ from: "+18135550142", to: "+18132124174", body: "Is a car still open?", provider: "quo", providerMessageId: "ACEV1" }]);
    expect(db.state.quo_events).toHaveLength(1);
    expect(db.state.quo_events[0]).toMatchObject({ quo_event_id: "EV1", event_type: "message.received", application_id: APP,
      phone_number_id: L813, line_e164: "+18132124174", line_label: "Primary 813", from_e164: "+18135550142", to_e164: "+18132124174", body: "Is a car still open?" });
    const d = db.state.fleet_webhook_deliveries[0];
    expect(d).toMatchObject({ event_type: "quo_message_received", dedupe_key: "quo:EV1", application_id: APP, status: "pending" });
    expect(d.payload).toMatchObject({ event: "quo_message_received", lead_id: APP, from: "+18135550142", to: "+18132124174", body: "Is a car still open?",
      line: { e164: "+18132124174", phone_number_id: L813, label: "Primary 813" }, quo: { event_id: "EV1", resource_id: "ACEV1", type: "message.received" } });
    expect(dispatched).toEqual([[d.id]]);
  });

  test("call on 888 from an unknown number: logged unmatched and still forwarded, with the 888 line", async () => {
    expect((await handleQuoWebhook(await signed(callDone("EV2", L888)), deps())).status).toBe(200);
    expect(db.state.quo_events[0]).toMatchObject({ application_id: null, line_label: "REAL Rentals 888", line_e164: "+18888338280", phone_number_id: L888,
      from_e164: "+15555550199", to_e164: "+18888338280", call_id: "CA1", duration_seconds: 61, occurred_at: "2026-11-14T20:01:00.000Z" });
    expect(db.state.fleet_webhook_deliveries[0]).toMatchObject({ event_type: "quo_call", application_id: null });
    expect(db.state.fleet_webhook_deliveries[0].payload).toMatchObject({ lead_id: null, from: "+15555550199", line: { label: "REAL Rentals 888" } });
    expect(inbound).toHaveLength(0);
  });

  for (const [pn, label, e164] of [[L813, "Primary 813", "+18132124174"], [L888, "REAL Rentals 888", "+18888338280"]] as const) {
    test(`voicemail, transcript and missed call on ${label}`, async () => {
      await handleQuoWebhook(await signed(voicemail(`VM-${pn}`, pn)), deps());
      await handleQuoWebhook(await signed(transcript(`TR-${pn}`, pn)), deps());
      await handleQuoWebhook(await signed(missed(`MC-${pn}`, pn)), deps());
      const [vm, tr, mc] = db.state.quo_events;
      for (const ev of [vm, tr, mc]) expect(ev).toMatchObject({ application_id: APP, phone_number_id: pn, line_label: label, line_e164: e164 });
      expect(vm).toMatchObject({ transcript: "Hi, calling about the car.", voicemail_url: "https://files.quo.example/vm1.mp3", recording_url: "https://files.quo.example/vm1.mp3", call_id: "CA2" });
      expect(tr.transcript).toBe("+18135550142: When can I pick up?\n+18888338280: Tomorrow at 10.");
      expect(tr.call_id).toBe("CA3");
      expect(mc).toMatchObject({ direction: "incoming", from_e164: "+18135550142", call_id: "CA4" });
      expect(db.state.fleet_webhook_deliveries.map((d) => d.event_type)).toEqual(["quo_voicemail", "quo_transcript", "quo_call"]);
      for (const d of db.state.fleet_webhook_deliveries) expect(d.payload.line).toEqual({ e164, phone_number_id: pn, label });
      expect(db.state.fleet_webhook_deliveries[0].payload).toMatchObject({ voicemail_url: "https://files.quo.example/vm1.mp3", transcript: "Hi, calling about the car." });
    });
  }

  test("idempotent on the Quo event id: a retried delivery adds nothing and sends nothing new", async () => {
    const ev = callDone("EV3", L813);
    await handleQuoWebhook(await signed(ev, "a"), deps());
    await handleQuoWebhook(await signed(ev, "b"), deps());
    expect(db.state.quo_events).toHaveLength(1);
    expect(db.state.fleet_webhook_deliveries).toHaveLength(1);
    expect(dispatched).toHaveLength(1);
    // A retried text: already threaded (outbound_messages) → not re-processed, not re-forwarded.
    db.state.outbound_messages.push({ provider: "quo", provider_message_id: "ACEV4" });
    await handleQuoWebhook(await signed(text("EV4", L888)), deps());
    await handleQuoWebhook(await signed(text("EV4", L888)), deps());
    expect(inbound).toHaveLength(0);
    expect(db.state.fleet_webhook_deliveries.filter((d) => d.dedupe_key === "quo:EV4")).toHaveLength(1);
  });

  test("other Quo numbers are ignored; the accepted list is configurable and independent of sending", async () => {
    await handleQuoWebhook(await signed(callDone("EV5", "PNnotOurs")), deps());
    expect(db.state.quo_events).toHaveLength(0);
    process.env.QUO_FROM_NUMBERS = "PNrZULvFMn"; // narrows sending only
    await handleQuoWebhook(await signed(callDone("EV6", L813)), deps());
    expect(db.state.quo_events).toHaveLength(1);
    process.env.QUO_INBOUND_NUMBER_IDS = "PNrZULvFMn";
    await handleQuoWebhook(await signed(callDone("EV7", L813)), deps());
    expect(db.state.quo_events).toHaveLength(1);
    expect(qe.quoInboundLines({ QUO_INBOUND_NUMBER_IDS: "PNcX8a0PLJ, PNnew123|(727) 555-0100|St Pete" })).toEqual([
      { id: "PNcX8a0PLJ", e164: "+18132124174", label: "Primary 813" }, { id: "PNnew123", e164: "+17275550100", label: "St Pete" }]);
    expect(qe.quoInboundLines({}).map((l) => l.id)).toEqual(["PNcX8a0PLJ", "PNrZULvFMn"]);
  });

  test("forged signature: nothing logged or forwarded", async () => {
    const req = await signed(callDone("EV8", L813));
    const bad = new Request(req.url, { method: "POST", body: await req.text(), headers: { "webhook-id": "x", "webhook-timestamp": String(nowS), "webhook-signature": "v1,AAAA" } });
    expect((await handleQuoWebhook(bad, deps())).status).toBe(403);
    expect(db.state.quo_events).toHaveLength(0);
    expect(db.state.fleet_webhook_deliveries).toHaveLength(0);
  });

  test("forward goes out through the same signed sender (no real send: injected fetch)", async () => {
    await handleQuoWebhook(await signed(text("EV9", L888)), { admin: db, processInbound: async () => {} });
    // Default inline dispatch with no FLEET env: skipped, nothing sent.
    expect(db.state.fleet_webhook_deliveries[0]).toMatchObject({ status: "skipped" });
    db.state.fleet_webhook_deliveries[0].status = "pending";
    const calls: any[] = [];
    await fw.dispatchFleetWebhooks(db, {}, { env: ENV_ON, fetch: (async (u: any, i: any) => { calls.push(i); return new Response("ok"); }) as any });
    const body = JSON.parse(calls[0].body);
    expect(calls[0].headers["X-Real-Event"]).toBe("quo_message_received");
    expect(body).toMatchObject({ event: "quo_message_received", lead_id: APP, line: { e164: "+18888338280", phone_number_id: L888, label: "REAL Rentals 888" } });
  });
});

// ---------------------------------------------------------------- migration
describe("migration (PGlite)", () => {
  const SQL = readFileSync("supabase/migrations/20261114130000_fleet_webhooks_quo_events_lead_activity.sql", "utf8");
  test("trigger records every stage change and queues FLEET events; the view unifies texts, calls, emails and stages", async () => {
    const pg = new PGlite();
    await pg.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA private;
      CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE TABLE public.applications (id uuid primary key default gen_random_uuid(), email text, phone text, status text, created_at timestamptz default now());
      CREATE TABLE public.outbound_messages (id uuid primary key default gen_random_uuid(), channel text, to_address text, from_address text, subject text, body text,
        status text, kind text, application_id uuid, sent_at timestamptz, created_at timestamptz default now());
      CREATE TABLE public.messages (id uuid primary key default gen_random_uuid(), application_id uuid, body text, direction text, delivery_state text, created_at timestamptz default now());
      CREATE TABLE public.email_deliveries (id uuid primary key default gen_random_uuid(), workflow text, recipient text, state text, created_at timestamptz default now());
    `);
    await pg.exec(SQL);
    const id = (await pg.query<any>(`INSERT INTO applications (email, phone, status) VALUES ('J@x.com','8135550142','partial') RETURNING id`)).rows[0].id;
    await pg.query(`UPDATE applications SET status='new' WHERE id=$1`, [id]);
    await pg.query(`UPDATE applications SET phone='8135550143' WHERE id=$1`, [id]); // not a stage change
    await pg.query(`UPDATE applications SET status='new' WHERE id=$1`, [id]); // same stage
    await pg.query(`UPDATE applications SET status='reviewing' WHERE id=$1`, [id]);
    const ch = (await pg.query<any>(`SELECT from_status, to_status FROM application_status_changes ORDER BY changed_at, to_status`)).rows;
    expect(ch.map((c) => `${c.from_status}>${c.to_status}`).sort()).toEqual(["new>reviewing", "null>partial", "partial>new"]);
    const del = (await pg.query<any>(`SELECT event_type, payload, status FROM fleet_webhook_deliveries ORDER BY created_at, event_type`)).rows;
    expect(del.map((d) => d.event_type).sort()).toEqual(["lead_created", "stage_changed", "stage_changed"]);
    expect(del.every((d) => d.status === "pending")).toBe(true);
    expect(del.some((d) => d.payload.previous_stage === "new" && d.payload.stage === "reviewing")).toBe(true);
    await pg.query(`INSERT INTO outbound_messages (channel, from_address, body, status, kind, application_id, sent_at) VALUES ('sms','+18888338280','Hi','sent','automation',$1, now())`, [id]);
    await pg.query(`INSERT INTO quo_events (quo_event_id, event_type, phone_number_id, line_e164, line_label, application_id, direction, transcript, voicemail_url, occurred_at)
      VALUES ('EV1','call.voicemail.completed','PNcX8a0PLJ','+18132124174','Primary 813',$1,'incoming','Hi there','https://x/vm.mp3', now())`, [id]);
    await pg.query(`INSERT INTO quo_events (quo_event_id, event_type, phone_number_id, line_e164, line_label, application_id, direction, body, occurred_at)
      VALUES ('EV2','message.received','PNrZULvFMn','+18888338280','REAL Rentals 888',$1,'incoming','Yes please', now())`, [id]);
    await pg.query(`INSERT INTO messages (application_id, body, direction, delivery_state) VALUES ($1,'Yes please','inbound','delivered'), ($1,'Old text','inbound','delivered')`, [id]);
    await pg.query(`INSERT INTO email_deliveries (workflow, recipient, state) VALUES ('application_resume','j@x.com','delivered')`);
    // The Step 1 thank-you is logged on the lead and tracked for delivery: listed once.
    await pg.query(`INSERT INTO outbound_messages (channel, to_address, subject, status, kind, application_id, sent_at) VALUES ('email','j@x.com','Step 2: Finish Your Application','sent','step1_thank_you',$1, now())`, [id]);
    await pg.query(`INSERT INTO email_deliveries (workflow, recipient, state) VALUES ('application_step1_thank_you','J@x.com','delivered')`);
    const act = (await pg.query<any>(`SELECT activity_type, direction, summary, line_label, phone_number_id, recording_url, source_table FROM lead_activity WHERE application_id=$1`, [id])).rows;
    const types = act.map((a) => a.activity_type).sort();
    expect(types).toEqual(["email", "email", "status_change", "status_change", "status_change", "text", "text", "text", "voicemail"]);
    expect(act.filter((a) => a.activity_type === "email").map((a) => a.source_table).sort()).toEqual(["email_deliveries", "outbound_messages"]);
    expect(act.find((a) => a.activity_type === "voicemail")).toMatchObject({ line_label: "Primary 813", phone_number_id: "PNcX8a0PLJ", recording_url: "https://x/vm.mp3", summary: "Hi there" });
    expect(act.find((a) => a.source_table === "outbound_messages")).toMatchObject({ line_label: "REAL Rentals 888", phone_number_id: "PNrZULvFMn", direction: "outbound" });
    // The Quo text and its threaded copy show once; the older thread-only text still shows.
    expect(act.filter((a) => a.summary === "Yes please")).toHaveLength(1);
    expect(act.filter((a) => a.summary === "Old text")).toHaveLength(1);
    // Idempotent re-run.
    await pg.exec(SQL);
  });
  test("additive, staff-read RLS, no deletes", () => {
    expect(SQL).not.toMatch(/\bDROP TABLE\b|\bDELETE FROM\b|\bTRUNCATE\b/i);
    for (const t of ["application_status_changes", "fleet_webhook_deliveries", "quo_events"]) expect(SQL).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    expect(SQL).toContain("WITH (security_invoker = true)");
    expect(SQL).toMatch(/SECURITY DEFINER SET search_path = ''/);
  });
});

describe("wiring", () => {
  test("Activity tab on the lead record; FLEET env read only server-side; cron route token-guarded", () => {
    const p = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
    expect(p).toContain('["activity", "Activity"]');
    expect(p).toContain("<LeadActivity applicationId={driver.id} />");
    expect(readFileSync("src/lib/lead-activity.functions.ts", "utf8")).toMatch(/await requireStaff\(context\.userId\);[\s\S]*from\("lead_activity"\)/);
    const cron = readFileSync("src/routes/api/public/cron/fleet-webhooks.ts", "utf8");
    expect(cron).toContain('get_cron_token", { _name: "fleet-webhooks" }');
    expect(cron.indexOf("unauthorized")).toBeLessThan(cron.indexOf("dispatchFleetWebhooks(supabaseAdmin"));
    expect(readFileSync("src/lib/applications.functions.ts", "utf8")).toMatch(/void import\("@\/lib\/fleet-webhook\.server"\)/);
  });
  test("the site's follow-up texts are not touched", () => {
    const a = readFileSync("src/lib/automations.server.ts", "utf8");
    expect(a).toMatch(/kind: "automation"/);
    expect(readFileSync("src/lib/fleet-webhook.server.ts", "utf8")).not.toMatch(/sendSms|sendEmail/);
    expect(readFileSync("src/lib/quo-events.server.ts", "utf8")).not.toMatch(/sendSms|sendEmail|api\.quo\.com/);
  });
});
