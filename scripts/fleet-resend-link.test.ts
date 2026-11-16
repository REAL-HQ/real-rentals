// FLEET resend-link: off by default, quiet hours, handoff pause, signing
// reissue rules and caps, upload link rules. Fake database; nothing real sent.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
import { fakeDb, KEY, req } from "./fleet-fake-db";
const r = await import("@/lib/fleet-resend-link.server");
const cat = await import("@/lib/automation-catalog");

const DAY = new Date("2026-11-16T15:00:00Z"); // 10 AM ET
const NIGHT = new Date("2026-11-16T02:30:00Z"); // 9:30 PM ET
const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";
const AG = "66666666-6666-4666-8666-666666666666";
const env = { FLEET_API_KEY: KEY };
const fullMerge = Object.fromEntries(r.SIGNING_REQUIRED_KEYS.map((k) => [k, "x"]));

function seed(extra: Record<string, any[]> = {}) {
  return fakeDb({
    applications: [
      { id: L1, full_name: "ana test", status: "approved", email: "ana@example.com", phone: "8135550101", sms_consent: true, deleted_at: null },
      { id: L2, full_name: "ben test", status: "new", email: "ben@example.com", phone: "8135550102", sms_consent: true, deleted_at: null, vehicle_size: "sedan", pickup_date: "2026-11-18", expected_duration: "1-3 months", gig_status: "active", drive_type: "uber" },
    ],
    agreements: [{ id: AG, application_id: L1, status: "sent", sent_at: "2026-11-16T08:00:00Z", signer_email: "ana@example.com", merge_data: { ...fullMerge, driver_name: "Ana Test", vehicle: "2017 Ford Fusion" }, voided_at: null, created_at: "2026-11-16T08:00:00Z", token_hash: "old" }],
    esign_recipients: [{ id: "rc1", document_id: AG, role: "signer", token_hash: "old" }],
    documents: [{ driver_id: L2, category: "license_front", is_current: true }],
    audit_log: [],
    outbound_messages: [],
    applicant_outreach_log: [],
    fleet_review_decisions: [],
    ...extra,
  });
}
function deps(db: any, now = DAY, gate: "send" | "off" | "held" = "send") {
  const calls: any = { deliver: [], email: [], sms: [], audit: [] };
  return {
    calls,
    d: {
      admin: db, env, now: () => now, gate: async () => gate,
      audit: async (e: any) => { calls.audit.push(e); db.state.audit_log.push({ id: `au${calls.audit.length}`, action: e.action, entity_id: e.entityId, metadata: e.metadata, created_at: now.toISOString() }); },
      deliverSigning: async (_a: any, args: any) => { calls.deliver.push(args); return { email: "sent", sms: "sent", delivered: true }; },
      mintUploadLink: async () => "https://drivereal.com/thank-you?t=TEST",
      sendEmail: async (a: any) => { calls.email.push(a); return { ok: true }; },
      sendSms: async (a: any) => { calls.sms.push(a); return { ok: true }; },
      companyPhone: async () => "(888) 833-8280",
      siteUrl: () => "https://drivereal.com",
    } as any,
  };
}
const call = async (body: any, dd: any) => { const res = await r.handleFleetResendLink(req(body), dd); return { status: res.status, json: (await res.json()) as any }; };

describe("gates", () => {
  test("switch is Off by default in the catalog, and Off refuses", async () => {
    expect(cat.isDefaultOff("fleet_link_resends")).toBe(true);
    const { d, calls } = deps(seed(), DAY, "off");
    const out = await call({ kind: "signing", lead_id: L1 }, d);
    expect(out).toMatchObject({ status: 409, json: { reason: "switched_off" } });
    expect(calls.deliver.length).toBe(0);
  });
  test("unreadable switches hold", async () => {
    const { d } = deps(seed(), DAY, "held");
    expect((await call({ kind: "upload", lead_id: L2 }, d)).status).toBe(503);
  });
  test("quiet hours refuse", async () => {
    const { d, calls } = deps(seed(), NIGHT);
    expect((await call({ kind: "upload", lead_id: L2 }, d)).json.reason).toBe("quiet_hours");
    expect(calls.email.length + calls.sms.length).toBe(0);
  });
  test("handoff pauses the bot: 423", async () => {
    const db = seed({ fleet_review_decisions: [{ id: "d1", application_id: L1, decision: "needs_staff", reason: "Handoff (Complaint): upset", escalation_codes: ["handoff:complaint"], resolved_at: null }] });
    const { d, calls } = deps(db);
    expect((await call({ kind: "signing", lead_id: L1 }, d)).status).toBe(423);
    expect(calls.deliver.length).toBe(0);
  });
  test("auth and kind", async () => {
    const { d } = deps(seed());
    expect((await r.handleFleetResendLink(req({ kind: "signing", lead_id: L1 }, null), d)).status).toBe(401);
    expect((await call({ kind: "email", lead_id: L1 }, d)).status).toBe(400);
  });
});

describe("signing", () => {
  test("reissues the token (old link dies), same staff delivery, audited, link never returned", async () => {
    const db = seed();
    const { d, calls } = deps(db);
    const out = await call({ kind: "signing", lead_id: L1 }, d);
    expect(out.status).toBe(200);
    expect(out.json).toMatchObject({ ok: true, agreement_id: AG, email: "sent", sms: "sent" });
    expect(JSON.stringify(out.json)).not.toContain("/sign/");
    const ag = db.state.agreements[0];
    expect(ag.token_hash).not.toBe("old");
    expect(ag.status).toBe("sent");
    expect(db.state.esign_recipients[0].token_hash).toBe(ag.token_hash);
    expect(calls.deliver[0]).toMatchObject({ id: AG, email: "ana@example.com", phone: "8135550101", name: "Ana Test", actor: null });
    expect(calls.deliver[0].url).toMatch(/^https:\/\/drivereal\.com\/sign\/[0-9a-f]{64}$/);
    expect(calls.audit[0]).toMatchObject({ action: "document.resent", metadata: { by: "FLEET" } });
  });
  test("under 4 hours since the last send: 429", async () => {
    const db = seed();
    db.state.agreements[0].sent_at = "2026-11-16T13:30:00Z";
    const { d } = deps(db);
    const out = await call({ kind: "signing", agreement_id: AG }, d);
    expect(out.status).toBe(429);
    expect(out.json.retry_after).toBe("2026-11-16T17:30:00.000Z");
  });
  test("3 FLEET resends in 7 days: staff should call", async () => {
    const db = seed({ audit_log: [1, 2, 3].map((i) => ({ id: `p${i}`, action: "document.resent", entity_id: AG, metadata: { by: "FLEET" }, created_at: "2026-11-14T15:00:00Z" })) });
    const { d } = deps(db);
    expect((await call({ kind: "signing", agreement_id: AG }, d)).json.reason).toBe("resend_cap");
  });
  test("signed, voided, draft or being-signed agreements are never resent", async () => {
    for (const status of ["signed", "voided", "draft", "signing"]) {
      const db = seed();
      db.state.agreements[0].status = status;
      const { d, calls } = deps(db);
      expect((await call({ kind: "signing", agreement_id: AG }, d)).status).toBe(409);
      expect(calls.deliver.length).toBe(0);
    }
  });
  test("prepared without required details: 409 with the gaps", async () => {
    const db = seed();
    db.state.agreements[0].merge_data = { ...fullMerge, vehicle_vin: "" };
    const { d } = deps(db);
    const out = await call({ kind: "signing", agreement_id: AG }, d);
    expect(out.status).toBe(409);
    expect(out.json.gaps).toEqual(["vehicle_vin"]);
  });
});

describe("upload", () => {
  test("sends the approved step-1 message with only what is missing", async () => {
    const db = seed();
    const { d, calls } = deps(db);
    const out = await call({ kind: "upload", lead_id: L2 }, d);
    expect(out.status).toBe(200);
    expect(out.json.missing).toEqual(["gig_profile", "income"]);
    expect(calls.email[0]).toMatchObject({ to: "ben@example.com", track: { workflow: "fleet_upload_link_resend" } });
    expect(calls.sms[0]).toMatchObject({ kind: "missing_items_resend", applicationId: L2 });
    expect(calls.sms[0].body).toContain("Hi Ben, it's REAL RENTALS");
    expect(calls.sms[0].body).toContain("https://drivereal.com/thank-you?t=TEST");
    expect(calls.audit[0].action).toBe("application.upload_link_resent");
    expect(db.state.outbound_messages[0]).toMatchObject({ kind: "missing_items_resend", channel: "email" });
  });
  test("a missing-items message in the last 24 hours: 429; nothing missing or closed: 409", async () => {
    const db = seed({ outbound_messages: [{ id: "m1", application_id: L2, kind: "missing_items", created_at: "2026-11-16T05:00:00Z" }] });
    const { d } = deps(db);
    expect((await call({ kind: "upload", lead_id: L2 }, d)).status).toBe(429);
    const db2 = seed();
    db2.state.applications[1].status = "declined";
    expect((await call({ kind: "upload", lead_id: L2 }, deps(db2).d)).status).toBe(409);
    const db3 = seed({ documents: ["license_front", "gig_profile", "income"].map((c) => ({ driver_id: L2, category: c, is_current: true })) });
    expect((await call({ kind: "upload", lead_id: L2 }, deps(db3).d)).json.reason).toBe("nothing_missing");
  });
  test("no SMS consent: email only", async () => {
    const db = seed();
    db.state.applications[1].sms_consent = false;
    const { d, calls } = deps(db);
    const out = await call({ kind: "upload", lead_id: L2 }, d);
    expect(out.json).toMatchObject({ email: "sent", sms: "not_attempted" });
    expect(calls.sms.length).toBe(0);
  });
  test("no phone literals in the code", () => {
    expect(readFileSync("src/lib/fleet-resend-link.server.ts", "utf8")).not.toMatch(/\+1\d{10}|\d{3}[-.)\s]\d{3}[-.\s]\d{4}/);
  });
});
