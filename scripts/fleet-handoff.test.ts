// FLEET / AIVA handoff: opens (or extends) a Needs Staff flag, pauses bots,
// optional staff text to the pickup alert line only, never a renter phone.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
import { fakeDb, KEY, req } from "./fleet-fake-db";
const h = await import("@/lib/fleet-handoff.server");
const st = await import("@/lib/fleet-status.server");

const DAY = new Date("2026-11-16T15:00:00Z"); // 10 AM ET
const NIGHT = new Date("2026-11-17T04:00:00Z"); // 11 PM ET
const L1 = "11111111-1111-4111-8111-111111111111";
const R1 = "44444444-4444-4444-8444-444444444444";
const env = { FLEET_API_KEY: KEY };

function seed(alert = false, extra: Record<string, any[]> = {}) {
  return fakeDb({
    applications: [{ id: L1, full_name: "Ana Maria Test", status: "active", phone: "8135550101", deleted_at: null }],
    rentals: [{ id: R1, application_id: L1, status: "active" }],
    fleet_review_decisions: [],
    app_settings: alert ? [{ key: "fleet_handoff", value: { alert_sms: true } }] : [],
    ...extra,
  }, { unique: { fleet_review_decisions: "idempotency_key" } });
}
function run(db: any, body: any, now = DAY, sent: any[] = []) {
  const audits: any[] = [];
  return h.handleFleetHandoff(req(body), {
    admin: db, env, now: () => now, audit: async (e) => { audits.push(e); },
    sendSms: async (a) => { sent.push(a); return { ok: true }; },
    alertNumbers: async () => ["+10000000000"],
  }).then(async (r) => ({ status: r.status, json: (await r.json()) as any, audits, sent }));
}

describe("handoff", () => {
  test("opens a Needs Staff flag with the handoff code; bots paused; audited", async () => {
    const db = seed();
    const r = await run(db, { action: "handoff", rental_id: R1, reason: "complaint", note: "Says the car pulls left and is upset.", source: "aiva" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ ok: true, lead_id: L1, bots_paused: true, staff_alert: "off" });
    const row = db.state.fleet_review_decisions[0];
    expect(row).toMatchObject({ application_id: L1, decision: "needs_staff", escalation_codes: ["handoff:complaint"], decided_by: "AIVA (automated)" });
    expect(row.reason).toContain("Handoff (Complaint)");
    expect(r.audits[0].action).toBe("application.bot_handoff");
    const s = await (await h.handleFleetHandoff(req({ action: "status", lead_id: L1 }), { admin: db, env })).json() as any;
    expect(s.bots_paused).toBe(true);
  });
  test("an open review flag gets the handoff code added, not a second flag", async () => {
    const db = seed(false, { fleet_review_decisions: [{ id: "d1", application_id: L1, decision: "needs_staff", reason: "rating under 4.0", escalation_codes: ["low_rating"], resolved_at: null }] });
    const r = await run(db, { action: "handoff", lead_id: L1, reason: "payment_dispute", note: "Disputes last week's charge." });
    expect(r.status).toBe(200);
    expect(r.json.added_to_open_flag).toBe(true);
    expect(db.state.fleet_review_decisions.length).toBe(1);
    expect(db.state.fleet_review_decisions[0].escalation_codes).toEqual(["low_rating", "handoff:payment_dispute"]);
  });
  test("idempotent replay", async () => {
    const db = seed();
    await run(db, { action: "handoff", lead_id: L1, reason: "other", note: "Asked for a manager.", idempotency_key: "k1" });
    const r = await run(db, { action: "handoff", lead_id: L1, reason: "other", note: "Asked for a manager.", idempotency_key: "k1" });
    expect(r.json.duplicate).toBe(true);
    expect(db.state.fleet_review_decisions.length).toBe(1);
  });
  test("validation", async () => {
    const db = seed();
    expect((await run(db, { action: "handoff", lead_id: L1, reason: "bored", note: "x x x x x" })).status).toBe(400);
    expect((await run(db, { action: "handoff", lead_id: L1, reason: "injury", note: "" })).status).toBe(400);
    expect((await run(db, { action: "handoff", reason: "injury", note: "hurt in a crash" })).status).toBe(400);
    expect((await run(db, { action: "release", lead_id: L1 })).status).toBe(400); // FLEET cannot clear a handoff
    expect((await h.handleFleetHandoff(req({ action: "status", lead_id: L1 }, null), { admin: db, env })).status).toBe(401);
  });
  test("staff text: off by default; on → daytime sends; night only for injuries/accidents", async () => {
    const off = await run(seed(false), { action: "handoff", lead_id: L1, reason: "injury", note: "Renter hurt in a crash." });
    expect(off.sent.length).toBe(0);
    const day = await run(seed(true), { action: "handoff", lead_id: L1, reason: "complaint", note: "Unhappy with the car." });
    expect(day.json.staff_alert).toBe("sent");
    expect(day.sent[0]).toMatchObject({ to: "+10000000000", requireConsent: false, kind: "fleet_handoff_staff" });
    expect(day.sent[0].body).toContain("Ana T.");
    expect(day.sent[0].body).not.toContain("8135550101");
    const night = await run(seed(true), { action: "handoff", lead_id: L1, reason: "complaint", note: "Unhappy with the car." }, NIGHT);
    expect(night.json.staff_alert).toBe("quiet_hours");
    const urgent = await run(seed(true), { action: "handoff", lead_id: L1, reason: "injury", note: "Renter hurt in a crash." }, NIGHT);
    expect(urgent.json.staff_alert).toBe("sent");
  });
  test("status endpoint: a handoff makes the owner staff", async () => {
    const db = seed();
    await run(db, { action: "handoff", lead_id: L1, reason: "complaint", note: "Unhappy with the car." });
    const lead = await st.leadStatus(db, L1, DAY);
    expect(lead!.next).toMatchObject({ step: "staff_handling", owner: "staff" });
  });
  test("no phone literal in the handoff code; alert line comes from the Pickup Schedule defaults", () => {
    const src = readFileSync("src/lib/fleet-handoff.server.ts", "utf8");
    expect(src).not.toMatch(/\+1\d{10}/);
    expect(src).toContain("DEFAULT_PICKUP_SCHEDULE.notify.sms");
  });
});
