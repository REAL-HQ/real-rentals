// Staff-text bot pause (card t310s1681). Behavioral: the real sendSms (Quo,
// mocked fetch), the real Quo webhook handler and the real pause module
// against an in-memory database. No network; nothing is ever sent.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fakeDb } from "./fleet-fake-db";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";

let db: ReturnType<typeof fakeDb>;
mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: new Proxy({}, { get: (_t, p) => (db as any)[p] }),
}));

let quoCalls = 0;
let nextQuoId = 1;
globalThis.fetch = (async (url: any) => {
  if (!String(url).startsWith("https://api.quo.com/")) throw new Error(`network refused in test: ${url}`);
  quoCalls++;
  return new Response(JSON.stringify({ data: { id: `AC${nextQuoId++}`, status: "queued" } }), { status: 202, headers: { "content-type": "application/json" } });
}) as any;

const SECRET = "whsec_" + Buffer.from("test-signing-secret-32-bytes-long!").toString("base64");
const STAFF = "USdolmar01";   // a person on the team (also the line owner)
const STAFF2 = "USmaria002";
const FLEET = "USfleetbot";   // the Quo user FLEET sends as
const L888 = { id: "PNrZULvFMn", e164: "+18888338280" };
const L813 = { id: "PNcX8a0PLJ", e164: "+18132124174" };
const SETTINGS = { hours: 48, staffUserIds: [] as string[], botUserIds: [FLEET] };

const { sendSms } = await import("@/lib/sms.server");
const { signQuoWebhook } = await import("@/lib/quo.server");
const { handleQuoWebhook } = await import("@/lib/quo-webhook.server");
const P = await import("@/lib/staff-text-pause.server");

const phoneN = (i: number) => `+1813555${String(1000 + i).padStart(4, "0")}`;
function seed(nApps = 60) {
  db = fakeDb({
    applications: Array.from({ length: nApps }, (_, i) => ({ id: `app-${i}`, phone: phoneN(i), sms_consent: true, sms_opt_out_at: null, status: "new", created_at: "2026-11-01T00:00:00Z" })),
    outbound_messages: [],
    sms_opt_outs: [],
    bot_text_pauses: [],
  });
}
function setEnv() {
  for (const k of ["QUO_PHONE_NUMBER_ID", "QUO_FROM_NUMBERS", "SMS_DRY_RUN", "TWILIO_ACCOUNT_SID", "QUO_INBOUND_NUMBER_IDS"]) delete process.env[k];
  process.env.QUO_API_KEY = "quo-test-key";
  process.env.QUO_WEBHOOK_KEY = SECRET;
}
beforeEach(() => { seed(); setEnv(); quoCalls = 0; });

let evn = 1;
function delivered(o: { to: string; text: string; id?: string | null; userId?: string | null; line?: { id: string; e164: string } }) {
  const line = o.line ?? L888;
  return {
    id: `EV${evn++}`,
    type: "message.delivered",
    data: {
      resource: { ...(o.id === null ? {} : { id: o.id ?? `ACq${evn}` }), direction: "outgoing", text: o.text, status: "delivered", createdAt: new Date().toISOString() },
      context: { phoneNumberId: line.id, ...(o.userId === null ? {} : { userId: o.userId ?? STAFF }), senderIdentifier: line.e164, recipientIdentifiers: [o.to] },
    },
  };
}
async function hook(ev: unknown, opts: { gate?: "send" | "off" | "held"; settings?: typeof SETTINGS; now?: number } = {}) {
  const raw = JSON.stringify(ev);
  const ts = String(opts.now ?? Math.floor(Date.now() / 1000));
  const sig = await signQuoWebhook(SECRET, "wh1", ts, raw);
  const req = new Request("https://drivereal.com/api/public/sms/quo", { method: "POST", body: raw, headers: { "webhook-id": "wh1", "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` } });
  const res = await handleQuoWebhook(req, { admin: db, staffPauseGate: async () => opts.gate ?? "send", staffPauseSettings: opts.settings ?? SETTINGS, now: opts.now });
  expect(res.status).toBe(200);
}
const pauses = () => db.state.bot_text_pauses;

// ------------------------------------------------------------------ pure decision

describe("decideOutbound", () => {
  const d = (o: Partial<Parameters<typeof P.decideOutbound>[0]>) => P.decideOutbound({ ownLogMatched: false, userId: STAFF, body: "hi", settings: SETTINGS, ...o }).verdict;
  test("our own log decides first: bot kinds are bots even when Quo names a staff user", () => {
    for (const kind of ["missing_items", "automation", "rent_reminder_late", "payment_failed", "pickup_reminder_two_hour", "agreement_sign_morning", "missing_items_resend", "missing_items_closed", "reservation_confirmed_staff", "agreement_sent", null]) {
      expect(d({ ownLogMatched: true, ownLogKind: kind })).toBe("bot");
    }
    expect(d({ ownLogMatched: true, ownLogKind: "staff_message" })).toBe("staff");
  });
  test("no user, a Quo system actor, a listed bot user, or automated wording is a bot", () => {
    expect(d({ userId: null })).toBe("bot");
    expect(d({ userId: "SYUsona1" })).toBe("bot");
    expect(d({ userId: FLEET })).toBe("bot");
    expect(d({ body: "Real Rentals: Your quote is ready ... Reply YES to accept. Reply STOP to opt out." })).toBe("bot");
  });
  test("staff only when the lists say so; never a guess", () => {
    expect(d({})).toBe("staff"); // bot list set, user not on it
    expect(P.decideOutbound({ ownLogMatched: false, userId: STAFF, body: "hi", settings: { hours: 48, staffUserIds: [], botUserIds: [] } }).verdict).toBe("unknown");
    expect(P.decideOutbound({ ownLogMatched: false, userId: STAFF, body: "hi", settings: { hours: 48, staffUserIds: [STAFF2], botUserIds: [] } }).verdict).toBe("unknown");
    expect(P.decideOutbound({ ownLogMatched: false, userId: STAFF2, body: "hi", settings: { hours: 48, staffUserIds: [STAFF2], botUserIds: [] } }).verdict).toBe("staff");
  });
  test("settings: 48 hours by default, bounded", () => {
    expect(P.readStaffTextPauseSettings(null)).toEqual({ hours: 48, staffUserIds: [], botUserIds: [] });
    expect(P.readStaffTextPauseSettings({ hours: 9999 }).hours).toBe(48);
    expect(P.readStaffTextPauseSettings({ hours: 72, staff_user_ids: ["USa1", "bad id", 5], bot_user_ids: ["USb2"] })).toEqual({ hours: 72, staffUserIds: ["USa1"], botUserIds: ["USb2"] });
  });
});

// ------------------------------------------------------------------ bot sends never pause

describe("bot texts never trigger a pause", () => {
  test("a 52-text missing-items send, delivered back through the webhook as the line owner, pauses nobody", async () => {
    for (let i = 0; i < 52; i++) {
      const r = await sendSms({ to: phoneN(i), body: `Real Rentals: Hi there, we still need a few things (${i}). Reply STOP to opt out.`, kind: "missing_items", applicationId: `app-${i}` });
      expect(r.ok).toBe(true);
    }
    expect(quoCalls).toBe(52);
    const sent = db.state.outbound_messages.filter((m: any) => m.status === "sent");
    expect(sent.length).toBe(52);
    for (const m of sent) await hook(delivered({ to: m.to_address, text: m.body, id: m.provider_message_id, userId: STAFF }));
    expect(pauses().length).toBe(0);
  });

  test("every bot sender's kind (follow-ups, reminders, rent and late-fee, failed payment, FLEET resends, auto-close) stays a bot text", async () => {
    const kinds: [string, boolean][] = [
      ["automation", true], ["pickup_reminder_two_hour", true], ["agreement_sign_morning", true], ["missing_items_resend", true],
      ["missing_items_closed", true], ["rent_reminder_late", false], ["rent_reminder_daily", false], ["payment_failed", false], ["reservation_confirmed_staff", false],
    ];
    let i = 0;
    for (const [kind, consent] of kinds) {
      // Plain wording (no STOP line) so only the log can tell these apart.
      const r = await sendSms({ to: phoneN(i), body: `Hi, quick note number ${i}`, kind, applicationId: `app-${i}`, requireConsent: consent ? undefined : false });
      expect(r.ok).toBe(true);
      i++;
    }
    for (const m of db.state.outbound_messages.filter((x: any) => x.status === "sent")) {
      await hook(delivered({ to: m.to_address, text: m.body, id: m.provider_message_id, userId: STAFF }));
    }
    expect(pauses().length).toBe(0);
  });

  test("the delivery can beat the id update: matched on recipient + wording while the row is still queued", async () => {
    db.state.outbound_messages.push({ id: "q1", channel: "sms", to_address: phoneN(3), body: "Hi, your pickup is at 10:00 AM", status: "queued", provider: "quo", kind: "pickup_reminder_two_hour", created_at: new Date().toISOString() });
    await hook(delivered({ to: phoneN(3), text: "Hi, your pickup is at 10:00 AM", id: "ACunknown", userId: STAFF }));
    expect(pauses().length).toBe(0);
  });

  test("FLEET's own Quo texts (its bot user, a Quo system actor, or template wording) pause nobody", async () => {
    await hook(delivered({ to: phoneN(1), text: "Sure, I can help with that. What time works?", userId: FLEET }));
    await hook(delivered({ to: phoneN(1), text: "Sure, what time works?", userId: "SYUsona77" }));
    await hook(delivered({ to: phoneN(1), text: "Sure, what time works?", userId: null }));
    await hook(delivered({ to: phoneN(1), text: "Real Rentals: Your quote is ready: 2022 Camry at $350/week. Reply YES to accept. Reply STOP to opt out.", userId: STAFF }));
    expect(pauses().length).toBe(0);
  });

  test("switch Off, controls unreadable, or Quo users not configured: nothing pauses", async () => {
    const ev = () => delivered({ to: phoneN(2), text: "Hey, it's Dolmar. Call me when you can." });
    await hook(ev(), { gate: "off" });
    await hook(ev(), { gate: "held" });
    await hook(ev(), { settings: { hours: 48, staffUserIds: [], botUserIds: [] } });
    expect(pauses().length).toBe(0);
  });

  test("inbound texts, failures and other lines never pause", async () => {
    await hook({ type: "message.received", data: { resource: { id: "ACin", direction: "incoming", text: "hi" }, context: { phoneNumberId: L888.id, senderIdentifier: phoneN(4), recipientIdentifiers: [L888.e164] } } });
    const f = delivered({ to: phoneN(4), text: "Hey it's Dolmar" }); (f as any).type = "message.failed";
    await hook(f);
    await hook(delivered({ to: phoneN(4), text: "Hey it's Dolmar", line: { id: "PNnotOurs", e164: "+15555550000" } }));
    expect(pauses().length).toBe(0);
  });
});

// ------------------------------------------------------------------ staff texts pause

describe("staff texts pause bot outreach (light pause)", () => {
  test("a person texting from the Quo app pauses that one person for 48 hours; a later text extends it", async () => {
    const t0 = Math.floor(Date.parse("2026-11-16T15:00:00Z") / 1000);
    await hook(delivered({ to: phoneN(5), text: "Hey Marcus, it's Dolmar. Can you come in at 2?", userId: STAFF, line: L813 }), { now: t0 });
    expect(pauses().length).toBe(1);
    const row = pauses()[0];
    expect(row).toMatchObject({ phone_key: phoneN(5).slice(2), reason: "staff_text", source: "quo_staff_text", quo_user_id: STAFF, line_e164: L813.e164, application_id: "app-5", cleared_at: null });
    expect(row.paused_until).toBe("2026-11-18T15:00:00.000Z");
    // Not a Needs Staff handoff: no review flag is opened.
    expect(db.state.fleet_review_decisions ?? []).toEqual([]);
    await hook(delivered({ to: phoneN(5), text: "Running 10 min late, see you soon", userId: STAFF }), { now: t0 + 10 * 3600 });
    expect(pauses().length).toBe(1);
    expect(pauses()[0].paused_until).toBe("2026-11-19T01:00:00.000Z");
    const p = await P.activeStaffTextPause(db, phoneN(5), new Date("2026-11-17T12:00:00Z"));
    expect(p).toMatchObject({ paused: true, until: "2026-11-19T01:00:00.000Z" });
    expect(await P.activeStaffTextPause(db, phoneN(5), new Date("2026-11-19T01:00:01Z"))).toEqual({ paused: false });
    expect(await P.activeStaffTextPause(db, phoneN(6), new Date("2026-11-17T12:00:00Z"))).toEqual({ paused: false });
  });

  test("a staff text sent from the site (Messages → Text) also pauses", async () => {
    const r = await sendSms({ to: phoneN(7), body: "Hi, it's Maria from Real Rentals. Did you get the car?", kind: "staff_message", applicationId: "app-7" });
    expect(r.ok).toBe(true);
    const m = db.state.outbound_messages.find((x: any) => x.kind === "staff_message");
    await hook(delivered({ to: m.to_address, text: m.body, id: m.provider_message_id, userId: STAFF }));
    expect(pauses()[0]).toMatchObject({ phone_key: phoneN(7).slice(2), source: "site_staff_text" });
  });

  test("with a staff list, only those people pause", async () => {
    const s = { hours: 48, staffUserIds: [STAFF2], botUserIds: [] };
    await hook(delivered({ to: phoneN(8), text: "hello from the owner seat", userId: STAFF }), { settings: s });
    expect(pauses().length).toBe(0);
    await hook(delivered({ to: phoneN(8), text: "hello from Maria", userId: STAFF2 }), { settings: s });
    expect(pauses().length).toBe(1);
  });

  test("staff clear it; staff can extend it by hand", async () => {
    const now = new Date("2026-11-16T15:00:00Z");
    expect(await P.setStaffTextPause(db, { phone: phoneN(9), hours: 48, reason: "staff_manual", source: "staff", by: "u1" }, now)).toBe(true);
    expect((await P.activeStaffTextPause(db, phoneN(9), now) as any).paused).toBe(true);
    await P.clearStaffTextPause(db, phoneN(9), "u1", now);
    expect(await P.activeStaffTextPause(db, phoneN(9), now)).toEqual({ paused: false });
    expect(await P.setStaffTextPause(db, { phone: phoneN(9), hours: 72, reason: "staff_manual", source: "staff", by: "u1" }, now)).toBe(true);
    expect((await P.activeStaffTextPause(db, phoneN(9), now) as any).until).toBe("2026-11-19T15:00:00.000Z");
    // Capped at 14 days.
    await P.setStaffTextPause(db, { phone: phoneN(9), hours: 9999, reason: "staff_manual", source: "staff", by: "u1" }, now);
    expect((await P.activeStaffTextPause(db, phoneN(9), now) as any).until).toBe("2026-11-30T15:00:00.000Z");
  });

  test("before the table is installed: nothing pauses, nothing breaks", async () => {
    db = fakeDb({ applications: [], outbound_messages: [], sms_opt_outs: [] }, { missing: ["bot_text_pauses"] });
    await hook(delivered({ to: phoneN(1), text: "Hey it's Dolmar" }));
    expect(await P.activeStaffTextPause(db, phoneN(1))).toEqual({ paused: false });
    expect(await P.activePauseKeys(db)).toEqual(new Set());
  });
});

// ------------------------------------------------------------------ sendSms backstop

describe("sendSms backstop", () => {
  test("while paused, bot kinds are refused before Quo is called; staff texts still go", async () => {
    await P.setStaffTextPause(db, { phone: phoneN(10), hours: 48, reason: "staff_text", source: "quo_staff_text", by: STAFF });
    for (const kind of ["missing_items", "automation", "rent_reminder_overdue", "payment_failed", "pickup_reminder_evening", "agreement_sign_four_hour", "missing_items_resend"]) {
      const r = await sendSms({ to: phoneN(10), body: `bot ${kind}`, kind, applicationId: "app-10", requireConsent: false });
      expect(r).toEqual({ ok: false, skipped: true, reason: "bot_paused" });
    }
    expect(quoCalls).toBe(0);
    expect(db.state.outbound_messages.every((m: any) => m.status === "skipped" && /bots paused/.test(m.error))).toBe(true);
    const staff = await sendSms({ to: phoneN(10), body: "Hi, it's Maria", kind: "staff_message", applicationId: "app-10" });
    expect(staff.ok).toBe(true);
    const receipt = await sendSms({ to: phoneN(10), body: "Reservation confirmed", kind: "reservation_confirmed_staff", requireConsent: false });
    expect(receipt.ok).toBe(true);
    expect(quoCalls).toBe(2);
  });
  test("bot outreach kinds", () => {
    for (const k of ["automation", "missing_items", "missing_items_closed", "missing_items_resend", "rent_reminder_late", "payment_failed", "pickup_reminder_booked", "agreement_sign_morning", "late_pickup_release"]) expect(P.isBotOutreachKind(k)).toBe(true);
    for (const k of ["staff_message", "vehicle_share", "agreement_sent", "rental_agreement", "reservation_confirmed_staff", "roadside_staff", "rental_activated", "inbound_sms", null]) expect(P.isBotOutreachKind(k)).toBe(false);
  });
});
