// Move Forward (Terms Confirmed row), Dolmar Nov 17 2026: staff confirm the
// terms after their call, FLEET gets applicant_ready_for_agreement, and
// send-agreement accepts channel "staff". Plus the applicant_approved team
// alert and the cleaned-up team-alert copy. Network refused; fake database.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const st = await import("@/lib/staff-terms");
const sts = await import("@/lib/staff-terms.server");
const fa = await import("@/lib/fleet-agreement.server");
const fta = await import("@/lib/fleet-team-alert.server");
const copy = await import("@/lib/team-alert-copy");
const ta = await import("@/lib/team-alerts");
const { driverNextStepRequirements } = await import("@/lib/driver-next-step-requirements");
const { NEXT_STEP_REQUIREMENT_KEYS } = await import("@/lib/activation-readiness");

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>, opts: { missing?: string[]; unique?: Record<string, string[]> } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  const uniq: Record<string, string[][]> = { staff_terms_confirmations: [["application_id", "terms_key"]], fleet_webhook_deliveries: [["dedupe_key"]], agreement_terms_confirmations: [["idempotency_key"]], team_alert_sends: [["key"]] };
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false; let ignoreDup = false; let lim = Infinity;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q,
      insert: (r: Row) => { op = "insert"; payload = r; return q; },
      upsert: (r: Row, o: any) => { op = "insert"; payload = r; ignoreDup = !!o?.ignoreDuplicates; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      gte: (c: string, v: any) => { f.push((r) => String(r[c] ?? "") >= String(v)); return q; },
      lte: () => q, in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      order: () => q, limit: (k: number) => { lim = k; return q; },
      maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (opts.missing?.includes(table)) return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
      const rows = state[table];
      if (op === "insert") {
        for (const cols of uniq[table] ?? []) {
          if (cols.every((c) => payload[c] != null) && rows.some((r) => cols.every((c) => r[c] === payload[c]))) {
            if (ignoreDup) return { data: [], error: null };
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
        }
        const r = { id: payload.id ?? `${table.slice(0, 4)}-${String(n++).padStart(4, "0")}-0000-4000-8000-000000000000`.slice(0, 36), ...payload };
        rows.push(r);
        return { data: single ? r : [r], error: null };
      }
      const hit = rows.filter((r) => f.every((x) => x(r)));
      if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
      const out = hit.slice(0, lim);
      return { data: single ? out[0] ?? null : out, error: null };
    }
    return q;
  }
  return { from, state };
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const V = "44444444-4444-4444-8444-444444444444";
const V2 = "55555555-5555-4555-8555-555555555555";
const ROSA = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-11-17T15:05:00Z"); // Tue 10:05 AM ET (Rosa on duty)
const okCheck = { blockers: [] as any[], weeklyRate: 325, reservationFee: 50, deposit: 0, startDate: "2026-11-18", vehicleId: V, vehicleLabel: "2021 Toyota Camry" };
const terms = (x: Row = {}) => ({ weekly_rate: "325", reservation_fee: "50", deposit: "0", start_date: "2026-11-18", vehicle_id: V, ...x });
const actor = { userId: ROSA, email: "rosa@drivereal.com", role: "team", tier: "manager" };

function harness(d: { check?: any; open?: boolean; enqueueFails?: boolean; deliver?: "delivered" | "failed" | "skipped" } = {}) {
  const enq: any[] = []; const dispatched: string[][] = []; const audits: any[] = [];
  const deps: any = {
    now: () => NOW,
    check: async () => d.check ?? okCheck,
    hasOpenOrSigned: async () => d.open ?? false,
    resolveName: async () => "Rosa DeJesus",
    enqueue: async (admin: any, row: any) => {
      enq.push(row);
      if (d.enqueueFails) return null;
      const r = await admin.from("fleet_webhook_deliveries").upsert({ ...row, status: "pending" }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
      return r.data?.[0]?.id ?? null;
    },
    dispatch: async (admin: any, ids: string[]) => {
      dispatched.push(ids);
      for (const id of ids) await admin.from("fleet_webhook_deliveries").update({ status: d.deliver ?? "delivered", delivered_at: d.deliver === "delivered" || !d.deliver ? NOW.toISOString() : null, last_error: d.deliver && d.deliver !== "delivered" ? "HTTP 500" : null }).eq("id", id);
    },
    audit: async (a: any, e: any) => { audits.push({ actor: a, ...e }); },
  };
  return { deps, enq, dispatched, audits };
}
const seed = (status = "approved", extra: Row = {}) => ({ applications: [{ id: A, status, full_name: "Briana Palmer", phone: "+10000000000", email: "b@example.com", deleted_at: null, contacted_at: null, ...extra }], staff_terms_confirmations: [], fleet_webhook_deliveries: [] });

describe("Terms Confirmed row", () => {
  test("sits right after Application Approved and before Rental Agreement Signed; hidden unless supplied", () => {
    const keys = NEXT_STEP_REQUIREMENT_KEYS as readonly string[];
    expect(keys.indexOf("terms_confirmed")).toBe(keys.indexOf("approved") + 1);
    expect(keys.indexOf("signed_agreement")).toBe(keys.indexOf("terms_confirmed") + 1);
    const reqs: any[] = [
      { key: "approved", label: "Application Approved", met: true, enforcement: "hard" },
      { key: "signed_agreement", label: "Rental Agreement Signed", met: false, enforcement: "hard" },
    ];
    const row = st.termsConfirmedRequirement(null, { approved: true, agreementSigned: false });
    expect(driverNextStepRequirements(reqs, null, row).map((r) => r.key).filter((k) => k !== "reservation_paid")).toEqual(["approved", "terms_confirmed", "signed_agreement"]);
    expect(driverNextStepRequirements(reqs, null).some((r) => r.key === "terms_confirmed")).toBe(false);
    expect(row).toMatchObject({ label: "Terms Confirmed", detail: "Not Done", met: false, enforcement: "advisory" });
  });
  test("status: Not Done -> Sent To FLEET <time> | Sending | Failed; button only for managers after approval", () => {
    const base = { ready: true, prefill: null, blockers: [] };
    const latest = (delivery: any) => ({ id: "e", clickedAt: NOW.toISOString(), clickedByName: "Rosa DeJesus", terms: { weekly_rate: 325, reservation_fee: 50, deposit: 0, start_date: "2026-11-18", vehicle_id: V, vehicle_label: null }, delivery, deliveredAt: NOW.toISOString(), error: null });
    expect(st.termsConfirmedRequirement({ ...base, latest: latest("sent") }, { approved: true, agreementSigned: false })).toMatchObject({ met: true, detail: "Sent To FLEET Nov 17, 10:05 AM" });
    expect(st.termsConfirmedRequirement({ ...base, latest: latest("failed") }, { approved: true, agreementSigned: false }).detail).toBe("Failed");
    expect(st.termsConfirmedRequirement({ ...base, latest: latest("sending") }, { approved: true, agreementSigned: false }).detail).toBe("Sending To FLEET");
    expect(st.moveForwardEnabled({ approved: true, isManager: true, agreementSigned: false })).toBe(true);
    expect(st.moveForwardEnabled({ approved: false, isManager: true, agreementSigned: false })).toBe(false);
    expect(st.moveForwardEnabled({ approved: true, isManager: false, agreementSigned: false })).toBe(false);
    expect(st.MOVE_FORWARD_LABEL.split(" ")).toHaveLength(2);
  });
  test("terms parsing and key", () => {
    expect(st.parseStaffTerms(terms()).ok).toBe(true);
    for (const bad of [{ weekly_rate: "0" }, { reservation_fee: "" }, { reservation_fee: "x" }, { deposit: "x" }, { start_date: "11/18/2026" }, { vehicle_id: "Camry" }]) expect(st.parseStaffTerms(terms(bad)).ok).toBe(false);
    const p = st.parseStaffTerms(terms({ weekly_rate: "$325.00" }));
    expect(p.ok && st.staffTermsKey(p.value)).toBe(`325.00|50.00|0.00|2026-11-18|${V}`);
  });
});

describe("confirmStaffTerms (Move Forward)", () => {
  test("happy path: one event, webhook queued with the agreed payload, dispatched, contact attributed to staff", async () => {
    const db = fakeDb(seed()); const h = harness();
    const r = await sts.confirmStaffTerms(db, { applicationId: A, terms: terms(), actor }, h.deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.duplicate).toBe(false);
    expect(r.delivery).toBe("sent");
    expect(h.enq).toHaveLength(1);
    expect(h.enq[0]).toMatchObject({ event_type: "applicant_ready_for_agreement", dedupe_key: `applicant_ready_for_agreement:${r.eventId}`, application_id: A });
    expect(h.enq[0].payload).toEqual({
      event: "applicant_ready_for_agreement", event_id: r.eventId, lead_id: A, application_id: A,
      clicked_by: { id: ROSA, name: "Rosa DeJesus" }, clicked_at: NOW.toISOString(),
      terms: { weekly_rate: 325, reservation_fee: 50, deposit: 0, start_date: "2026-11-18", vehicle_id: V },
    });
    expect(h.dispatched).toHaveLength(1);
    expect(db.state.staff_terms_confirmations).toHaveLength(1);
    expect(db.state.staff_terms_confirmations[0]).toMatchObject({ clicked_by: ROSA, clicked_by_name: "Rosa DeJesus", fleet_delivery_id: h.enq.length ? db.state.fleet_webhook_deliveries[0].id : null });
    expect(db.state.applications[0].contacted_at).toBe(NOW.toISOString());
    expect(h.audits.map((a) => a.action)).toEqual(["application.terms_confirmed_by_staff", "application.contacted_by_staff"]);
    expect(h.audits.every((a) => a.actor.userId === ROSA)).toBe(true);
  });
  test("double click: same event, nothing queued twice", async () => {
    const db = fakeDb(seed()); const h = harness();
    const [a, b] = await Promise.all([
      sts.confirmStaffTerms(db, { applicationId: A, terms: terms(), actor }, h.deps),
      sts.confirmStaffTerms(db, { applicationId: A, terms: terms({ weekly_rate: 325 }), actor }, h.deps),
    ]);
    expect(a.ok && b.ok && (a as any).eventId === (b as any).eventId).toBe(true);
    const again = await sts.confirmStaffTerms(db, { applicationId: A, terms: terms(), actor }, h.deps);
    expect(a?.ok && again.ok && again.duplicate && again.eventId === (a as any).eventId).toBe(true);
    expect(db.state.staff_terms_confirmations).toHaveLength(1);
    expect(db.state.fleet_webhook_deliveries).toHaveLength(1);
  });
  test("refusals store and queue nothing", async () => {
    for (const [status, d, t, want] of [
      ["new", {}, terms(), "Approve"],
      ["approved", { open: true }, terms(), "Already Out Or Signed"],
      ["approved", { check: { ...okCheck, blockers: [{ field: "vehicle_vin", label: "VIN", why: "x" }] } }, terms(), "VIN"],
      ["approved", {}, terms({ weekly_rate: "300", vehicle_id: V2 }), "Weekly Rate, Vehicle"],
      ["approved", {}, terms({ start_date: "bad" }), "Start Date"],
    ] as const) {
      const db = fakeDb(seed(status)); const h = harness(d as any);
      const r = await sts.confirmStaffTerms(db, { applicationId: A, terms: t, actor }, h.deps);
      expect(r.ok).toBe(false);
      expect((r as any).error).toContain(want);
      expect(db.state.staff_terms_confirmations).toHaveLength(0);
      expect(h.enq).toHaveLength(0);
    }
    const missing = fakeDb(seed(), { missing: ["staff_terms_confirmations"] });
    const r = await sts.confirmStaffTerms(missing, { applicationId: A, terms: terms(), actor }, harness().deps);
    expect(r).toMatchObject({ ok: false, status: 503 });
  });
  test("failed delivery: shows Failed; re-click does not resend; Retry re-queues the same row", async () => {
    const db = fakeDb(seed()); const h = harness({ deliver: "failed" });
    const r = await sts.confirmStaffTerms(db, { applicationId: A, terms: terms(), actor }, h.deps);
    expect(r.ok && r.delivery).toBe("failed");
    const state = await sts.readStaffTermsState(db, A, { check: async () => okCheck });
    expect(st.termsConfirmedRequirement(state, { approved: true, agreementSigned: false }).detail).toBe("Failed");
    const again = await sts.confirmStaffTerms(db, { applicationId: A, terms: terms(), actor }, h.deps);
    expect(h.dispatched).toHaveLength(1);
    expect(again.ok && again.retried).toBe(false);
    const ok = harness();
    const retry = await sts.confirmStaffTerms(db, { applicationId: A, terms: terms(), actor, retry: true }, ok.deps);
    expect(retry.ok && retry.retried && retry.delivery).toBe("sent");
    expect(ok.enq).toHaveLength(0); // same delivery row, reset to pending
    expect(db.state.fleet_webhook_deliveries).toHaveLength(1);
    expect(db.state.fleet_webhook_deliveries[0].status).toBe("delivered");
    expect(ok.audits.map((a) => a.action)).toEqual(["application.terms_confirmation_resent"]);
  });
  test("prefill comes from what the agreement would print", async () => {
    const db = fakeDb(seed());
    const s = await sts.readStaffTermsState(db, A, { check: async () => okCheck });
    expect(s).toMatchObject({ ready: true, latest: null, prefill: { weekly_rate: 325, reservation_fee: 50, deposit: 0, start_date: "2026-11-18", vehicle_id: V, vehicle_label: "2021 Toyota Camry" } });
  });
});

describe("send-agreement channel staff", () => {
  const KEY = "k".repeat(40);
  const ev = (x: Row = {}) => ({ id: "66666666-6666-4666-8666-666666666666", application_id: A, terms_key: "k", weekly_rate: 325, reservation_fee: 50, deposit: 0, start_date: "2026-11-18", vehicle_id: V, clicked_by: ROSA, clicked_by_name: "Rosa DeJesus", clicked_at: "2026-11-17T15:05:00Z", ...x });
  async function call(db: any, tc: Row, d: Row = {}) {
    const issued: any[] = []; const audits: any[] = [];
    const res = await fa.handleFleetSendAgreement(new Request("https://drivereal.com/api/public/fleet/send-agreement", {
      method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ lead_id: A, terms_confirmation: tc, ...(d.idem ? { idempotency_key: d.idem } : {}) }),
    }), {
      admin: db, env: { FLEET_API_KEY: KEY }, now: () => new Date("2026-11-17T15:10:00Z"), audit: async (e) => { audits.push(e); },
      check: async () => d.check ?? okCheck, hasOpenOrSigned: async () => false, reservationFee: d.fee ?? { enabled: true, amount: 50 },
      issue: async (_a: any, id: string, o: any) => { issued.push({ id, o }); return { id: "agr-1", url: "https://drivereal.com/sign/SECRET", delivery: { email: "sent", sms: "sent", delivered: true } }; },
    });
    return { status: res.status, body: await res.json(), issued, audits };
  }
  const db0 = (e: Row = ev()) => fakeDb({ ...seed(), staff_terms_confirmations: [e], agreement_terms_confirmations: [] });
  test("happy path: the staff event is the confirmation; FLEET does not stamp contacted_at; idempotent per event", async () => {
    const db = db0();
    const r = await call(db, { channel: "staff", staff_event_id: ev().id });
    expect(r.status).toBe(201);
    expect(r.issued).toHaveLength(1);
    expect(db.state.agreement_terms_confirmations[0]).toMatchObject({ channel: "staff", staff_event_id: ev().id, call_id: null, message_id: null, weekly_rate: 325, deposit: 0, start_date: "2026-11-18", vehicle_id: V, confirmed_at: "2026-11-17T15:05:00.000Z", idempotency_key: `staff:${ev().id}`, agreement_id: "agr-1" });
    expect(db.state.applications[0].contacted_at).toBeNull();
    expect(r.audits.some((a) => a.metadata?.step === "contacted")).toBe(false);
    expect(r.audits[0]).toMatchObject({ action: "agreement.fleet_sent", metadata: { channel: "staff", staff_event_id: ev().id, confirmed_by_staff: "Rosa DeJesus" } });
    expect(r.audits[0].summary).toContain("Rosa DeJesus confirmed the terms");
    const again = await call(db, { channel: "staff", staff_event_id: ev().id });
    expect(again.body).toMatchObject({ ok: true, duplicate: true });
    expect(again.issued).toHaveLength(0);
  });
  test("call/sms rows never carry staff_event_id (works before the migration)", async () => {
    const db = db0();
    const r = await call(db, { confirmed_at: "2026-11-17T10:04:00-05:00", channel: "call", call_id: "AC1", summary: "Confirmed $325/week, no deposit.", weekly_rate: 325, deposit: 0, start_date: "2026-11-18", vehicle_id: V });
    expect(r.status).toBe(201);
    expect("staff_event_id" in db.state.agreement_terms_confirmations[0]).toBe(false);
  });
  test("send-agreement (staff) refuses when the fee switch changed since Move Forward", async () => {
    const r = await call(db0(), { channel: "staff", staff_event_id: ev().id }, { fee: { enabled: false, amount: 50 } });
    expect(r.status).toBe(409);
    expect(r.body.mismatches[0]).toMatchObject({ field: "reservation_fee", confirmed: 50, agreement: 0 });
    expect(r.issued).toHaveLength(0);
    const ok = await call(db0(), { channel: "staff", staff_event_id: ev().id, reservation_fee: 50 });
    const badFleet = await call(db0(), { channel: "staff", staff_event_id: ev().id, reservation_fee: 75 });
    expect(badFleet.status).toBe(409);
    expect(badFleet.body.mismatches[0]).toMatchObject({ field: "reservation_fee", staff: 50 });
    expect(ok.status).toBe(201);
  });
  test("refusals", async () => {
    for (const [e, tc, d, code, want] of [
      [ev(), { channel: "staff" }, {}, 400, "staff_event_id is required"],
      [ev(), { channel: "staff", staff_event_id: "77777777-7777-4777-8777-777777777777" }, {}, 404, "No staff confirmation"],
      [ev({ application_id: B }), { channel: "staff", staff_event_id: ev().id }, {}, 409, "another applicant"],
      [ev({ clicked_at: "2026-11-01T15:05:00Z" }), { channel: "staff", staff_event_id: ev().id }, {}, 409, "older than 7 days"],
      [ev(), { channel: "staff", staff_event_id: ev().id, weekly_rate: 300 }, {}, 409, "differ from what staff confirmed"],
      [ev(), { channel: "staff", staff_event_id: ev().id }, { check: { ...okCheck, weeklyRate: 350 } }, 409, "do not match"],
    ] as const) {
      const db = db0(e as Row);
      const r = await call(db, tc as Row, d as Row);
      expect(r.status).toBe(code);
      expect(r.body.error).toContain(want);
      expect(r.issued).toHaveLength(0);
      expect(db.state.agreement_terms_confirmations).toHaveLength(0);
    }
    const missing = fakeDb(seed(), { missing: ["staff_terms_confirmations"] });
    expect((await call(missing, { channel: "staff", staff_event_id: ev().id })).status).toBe(503);
  });
});

describe("team-alert applicant_approved", () => {
  const KEY = "k".repeat(40);
  const req = (body: unknown) => new Request("https://drivereal.com/api/public/fleet/team-alert", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) });
  const ON = { gps: true, roadside_overnight: true, late_pickup: true, bot_handoff: true, applicant_approved: true };
  function io() {
    const sms: any[] = []; const emails: any[] = [];
    return { sms, emails, sendSms: async (a: any) => { sms.push(a); return { ok: true }; }, sendEmail: async (a: any) => { emails.push(a); return { ok: true }; } };
  }
  const run = async (db: any, at: Date, body: Row) => {
    const x = io();
    const res = await fta.handleFleetTeamAlert(req(body), { admin: db, env: { FLEET_API_KEY: KEY }, now: () => at, settings: ON, fieldRepNumbers: ["+10000000001"], hasOpenOrSigned: async () => false, ...x } as any);
    return { status: res.status, body: await res.json(), ...x };
  };
  const tsBody = { kind: "applicant_approved", lead_id: A, line_id: "PNrZULvFMn", approval_texted_at: "2026-11-17T14:38:00Z", summary: "Approved applicant — please call to review terms: Briana Palmer (000) 000-0000. Texted approval." };
  test("Rosa's hours: text to the other company line, email to team@ and rosa@; clean copy; once per lead", async () => {
    const db = fakeDb({ ...seed(), quo_events: [], staff_schedules: [] });
    const r = await run(db, NOW, tsBody);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "sent", email: "sent", sms: "sent", staff_email: "sent", routed_to: { staff_key: "rosa", via: "other_quo_line" } });
    expect(r.sms).toHaveLength(1);
    expect(r.sms[0].fromId).toBe("PNrZULvFMn");
    expect(r.sms[0].body).toBe(`REAL: APPROVED: Briana Palmer - Call To Review Terms https://drivereal.com/d/${A}`);
    expect(r.emails.map((e) => e.to).sort()).toEqual(["rosa@drivereal.com", "team@drivereal.com"]);
    const e = r.emails[0];
    expect(e.subject).toBe("APPROVED: Briana Palmer - Call To Review Terms");
    expect(e.html).toContain("Approval texted 9:38 AM · No reply yet · Agreement not sent");
    expect(e.html).toContain('href="tel:+10000000000"');
    expect(e.html).toContain("Open In Admin");
    expect(e.html).not.toContain("number removed");
    expect(e.html).not.toContain("Outside The Approved Templates");
    expect(e.html).not.toContain("Texted approval."); // FLEET's free text is not repeated
    expect(e.subject).not.toMatch(/\d{3}.?\d{4}/);
    const again = await run(db, NOW, tsBody);
    expect(again.body.status).toBe("duplicate");
    expect(again.sms.length + again.emails.length).toBe(0);
  });
  test("a reply since the approval text shows Replied", async () => {
    const db = fakeDb({ ...seed(), quo_events: [{ event_type: "message.received", from_e164: "+10000000000", occurred_at: "2026-11-17T14:50:00Z" }] });
    const r = await run(db, NOW, tsBody);
    expect(r.emails[0].html).toContain("Approval texted 9:38 AM · Replied · Agreement not sent");
  });
  test("outside Rosa's hours: field rep text, no rosa@ email; 9 PM-8 AM: email only, daytime alert still possible", async () => {
    const thu = new Date("2026-11-19T15:00:00Z"); // Thu 10 AM ET
    const db = fakeDb({ ...seed(), quo_events: [] });
    const r = await run(db, thu, tsBody);
    expect(r.sms.map((s) => s.to)).toEqual(["+10000000001"]);
    expect(r.emails.map((e) => e.to)).toEqual(["team@drivereal.com"]);
    expect(r.body.staff_email).toBe("not_on_duty");
    const night = new Date("2026-11-18T03:00:00Z"); // Tue 10 PM ET
    const db2 = fakeDb({ ...seed(), quo_events: [] });
    const n = await run(db2, night, tsBody);
    expect(n.body).toMatchObject({ status: "sent", sms: "quiet_hours", key: `applicant_approved:${A}:email-only` });
    expect(n.sms).toHaveLength(0);
    const day = await run(db2, new Date("2026-11-18T14:00:00Z"), tsBody);
    expect(day.body.status).toBe("sent");
    expect(day.sms).toHaveLength(1);
  });
  test("refusals: no lead, not approved", async () => {
    expect((await run(fakeDb(seed()), NOW, { kind: "applicant_approved" })).status).toBe(400);
    expect((await run(fakeDb(seed("new")), NOW, { kind: "applicant_approved", lead_id: A })).status).toBe(409);
  });
});

describe("team alert copy (before/after)", () => {
  test("approved subject and text follow 'STATUS: Name - Action'", () => {
    const c = copy.approvedApplicantCopy({ name: "Briana Palmer", approvalTextedAt: "2026-11-17T14:38:00Z", replied: false, agreementSent: false, smsLink: "https://drivereal.com/d/x" });
    expect(c.subject).toBe("APPROVED: Briana Palmer - Call To Review Terms");
    expect(c.status).toBe("Approval texted 9:38 AM · No reply yet · Agreement not sent");
    expect(c.sms).toBe("REAL: APPROVED: Briana Palmer - Call To Review Terms https://drivereal.com/d/x");
  });
  test("handoffs: human status, the summary once, paused line once, no internal codes", () => {
    const subjects = Object.keys(copy.HANDOFF_TITLES).map((reason) => copy.handoffCopy({ reason: reason as any, summary: "Wants to talk about the car", name: "Briana Palmer", link: "L" }).subject);
    expect(subjects).toEqual([
      "COMPLAINT: Briana Palmer - Call Back",
      "URGENT INJURY: Briana Palmer - Call Now",
      "PAYMENT DISPUTE: Briana Palmer - Call Back",
      "ASKED FOR A PERSON: Briana Palmer - Call Back",
      "NEEDS A PERSON: Briana Palmer - Reply To Them",
      "UNANSWERED: Briana Palmer - Reply To Them",
    ]);
    const h = copy.handoffCopy({ reason: "outside_templates", summary: "Asked about weekend pickup", name: null, link: "L" });
    expect(h.subject).toBe("NEEDS A PERSON: Reply To Them");
    expect(h.lines.filter((l) => l === "Asked about weekend pickup")).toHaveLength(1);
    expect(h.lines.filter((l) => l === copy.BOT_PAUSED_LINE)).toHaveLength(1);
    expect(JSON.stringify(h)).not.toMatch(/Outside The Approved Templates|Bot Hand-Off|Summary:/);
    expect(h.sms).toBe("REAL: NEEDS A PERSON: Reply To Them L");
  });
  test("bot_handoff over the endpoint: no summary in the subject, no placeholder for a scrubbed number", async () => {
    const KEY = "k".repeat(40);
    const sms: any[] = []; const emails: any[] = [];
    const db = fakeDb(seed());
    const res = await fta.handleFleetTeamAlert(new Request("https://x/api/public/fleet/team-alert", { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ kind: "bot_handoff", reason: "asked_for_person", lead_id: A, summary: "Wants a call back at (000) 000-0000 about pickup" }) }), {
      admin: db, env: { FLEET_API_KEY: KEY }, now: () => new Date("2026-11-19T15:00:00Z"), settings: { gps: true, roadside_overnight: true, late_pickup: true, bot_handoff: true, applicant_approved: true }, fieldRepNumbers: ["+10000000001"],
      sendSms: async (a: any) => { sms.push(a); return { ok: true }; }, sendEmail: async (a: any) => { emails.push(a); return { ok: true }; },
    } as any);
    expect(res.status).toBe(200);
    expect(emails[0].subject).toBe("ASKED FOR A PERSON: Briana Palmer - Call Back");
    expect(emails[0].html).toContain("Wants a call back at about pickup");
    expect(emails[0].html).not.toMatch(/number removed|\(\s*\)/);
    expect(sms[0].body).toBe(`REAL: ASKED FOR A PERSON: Briana Palmer - Call Back https://drivereal.com/d/${A}`);
  });
  test("scrubPhones leaves no placeholder; generic texts start 'REAL:'", () => {
    expect(ta.scrubPhones("Briana Palmer ((000) 000-0000). Texted")).toBe("Briana Palmer. Texted");
    expect(ta.teamAlertSms("GPS OFFLINE: R12 - Check Tracker", "L")).toBe("REAL: GPS OFFLINE: R12 - Check Tracker L");
    expect(copy.personName("briana palmer")).toBe("Briana Palmer");
    expect(copy.personName("MARY-ANN O'NEIL")).toBe("Mary-Ann O'Neil");
    expect(copy.personName("Ronald McDonald")).toBe("Ronald McDonald");
    expect(copy.displayPhone("+1 (000) 000-0000")).toEqual({ e164: "+10000000000", display: "(000) 000-0000" });
  });
});

describe("wiring and safety", () => {
  test("profile renders the row control; webhook event registered; short link route redirects only", () => {
    const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
    expect(panel).toContain("TermsConfirmedControl");
    expect(panel).toContain("termsConfirmed={termsConfirmedRow}");
    expect(readFileSync("src/lib/fleet-webhook.server.ts", "utf8")).toContain('"applicant_ready_for_agreement"');
    expect(readFileSync("src/lib/staff-terms.functions.ts", "utf8")).toContain("requireManager");
    const route = readFileSync("src/routes/d.$id.tsx", "utf8");
    expect(route).toContain("throw redirect");
    expect(route).not.toMatch(/supabase|from\(/);
  });
  test("no phone numbers in the new code", () => {
    for (const f of ["src/lib/staff-terms.ts", "src/lib/staff-terms.server.ts", "src/lib/staff-terms.functions.ts", "src/lib/team-alert-copy.ts", "src/lib/fleet-team-alert.server.ts", "src/components/admin/TermsConfirmedControl.tsx", "src/routes/d.$id.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/\+1\d{10}|\(\d{3}\)\s?\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/);
    }
  });
});

describe("proposed migration (PGlite)", () => {
  test("staff channel needs staff_event_id; new event allowed; once per lead+terms; re-runnable; rollback works", async () => {
    const pg = new PGlite();
    await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA private;
      CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE TABLE public.applications (id uuid primary key default gen_random_uuid());
      CREATE TABLE public.fleet_webhook_deliveries (id uuid primary key default gen_random_uuid(), event_type text not null, dedupe_key text unique,
        CONSTRAINT fleet_webhook_deliveries_event_type_check CHECK (event_type IN ('lead_created')));`);
    await pg.exec(readFileSync("proposed/agreement-terms-confirmations-v1.sql", "utf8"));
    const SQL = readFileSync("proposed/staff-terms-confirmations-v1.sql", "utf8");
    const SQL2 = readFileSync("proposed/staff-terms-confirmations-v2-reservation-fee.sql", "utf8");
    expect(SQL).toMatch(/PROPOSED, NOT APPLIED/);
    await pg.exec(SQL);
    await pg.exec(SQL);
    await pg.exec(SQL2);
    await pg.exec(SQL2);
    const app = (await pg.query<any>(`INSERT INTO applications DEFAULT VALUES RETURNING id`)).rows[0].id;
    const ev = (key = "325.00|0.00|2026-11-18|v") => pg.query<any>(`INSERT INTO staff_terms_confirmations (application_id, terms_key, weekly_rate, deposit, start_date, vehicle_id, clicked_by, clicked_by_name)
      VALUES ($1, $2, 325, 0, '2026-11-18', gen_random_uuid(), gen_random_uuid(), 'Rosa DeJesus') RETURNING id`, [app, key]);
    const id = (await ev()).rows[0].id;
    await expect(ev()).rejects.toThrow();
    expect((await pg.query<any>(`SELECT reservation_fee FROM staff_terms_confirmations WHERE id = $1`, [id])).rows[0].reservation_fee).toBe("0.00");
    await pg.query(`UPDATE staff_terms_confirmations SET reservation_fee = 50 WHERE id = $1`, [id]);
    await expect(pg.query(`UPDATE staff_terms_confirmations SET reservation_fee = -1 WHERE id = $1`, [id])).rejects.toThrow();
    const conf = (ch: string, staff: string | null) => pg.query(`INSERT INTO agreement_terms_confirmations (application_id, confirmed_at, channel, staff_event_id, summary, weekly_rate, deposit, start_date, vehicle_id, recorded_by)
      VALUES ($1, now(), $2, $3, 'Rosa confirmed the terms', 325, 0, '2026-11-18', gen_random_uuid(), 'FLEET (automated)')`, [app, ch, staff]);
    await conf("staff", id);
    await expect(conf("staff", null)).rejects.toThrow();
    await pg.query(`INSERT INTO fleet_webhook_deliveries (event_type, dedupe_key) VALUES ('applicant_ready_for_agreement', 'x')`);
    await pg.query(`INSERT INTO fleet_webhook_deliveries (event_type, dedupe_key) VALUES ('agreement_amendment_signed', 'y')`);
    await expect(pg.query(`INSERT INTO fleet_webhook_deliveries (event_type, dedupe_key) VALUES ('nope', 'z')`)).rejects.toThrow();
    const rollback2 = SQL2.split("-- Rollback")[1].split("\n").filter((l) => l.startsWith("-- ")).map((l) => l.slice(3)).join("\n");
    await pg.exec(rollback2);
    expect((await pg.query<any>(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'staff_terms_confirmations' AND column_name = 'reservation_fee'`)).rows[0].n).toBe(0);
    const rollback = SQL.split("-- Rollback")[1].split("\n").filter((l) => l.startsWith("-- ")).map((l) => l.slice(3)).filter((l) => !/^\(|^Rollback/.test(l)).join("\n");
    await pg.exec(rollback);
    await expect(conf("staff", null)).rejects.toThrow();
    expect((await pg.query<any>(`SELECT to_regclass('public.staff_terms_confirmations') AS t`)).rows[0].t).toBeNull();
  });
});

describe("Reservation and Deposit (Dolmar, Nov 17 10:35 and 10:36 AM)", () => {
  test("dialog has both Reservation ($) and Deposit ($); payload keeps deposit and adds reservation_fee", () => {
    const ui = readFileSync("src/components/admin/TermsConfirmedControl.tsx", "utf8");
    expect(ui).toContain(">Reservation ($)</Label>");
    expect(ui).toContain(">Deposit ($)</Label>");
    expect(ui.indexOf(">Reservation ($)")).toBeLessThan(ui.indexOf(">Deposit ($)"));
    const srv = readFileSync("src/lib/staff-terms.server.ts", "utf8");
    expect(srv).toContain('reservation_fee: "Reservation"');
    expect(srv).toContain('deposit: "Deposit"');
  });
  test("Deposit defaults to 0 when left out; Reservation is required", () => {
    const r = st.parseStaffTerms({ weekly_rate: "325", reservation_fee: "50", start_date: "2026-11-18", vehicle_id: V });
    expect(r).toEqual({ ok: true, value: { weekly_rate: 325, reservation_fee: 50, deposit: 0, start_date: "2026-11-18", vehicle_id: V } });
    expect(st.parseStaffTerms({ weekly_rate: "325", deposit: "0", start_date: "2026-11-18", vehicle_id: V })).toEqual({ ok: false, error: "Reservation must be an amount (0 if none)." });
    expect(st.staffTermsKey((r as any).value)).toBe(`325.00|50.00|0.00|2026-11-18|${V}`);
  });
  test("Move Forward refuses a Reservation that differs from what signing would charge; no deposit on file matches 0", async () => {
    const h = harness();
    const bad = await sts.confirmStaffTerms(fakeDb(seed()), { applicationId: A, terms: terms({ reservation_fee: "75" }), actor }, h.deps);
    expect(bad.ok).toBe(false);
    if (!bad.ok) { expect(bad.error).toContain("Reservation"); expect(bad.mismatches?.[0]).toMatchObject({ field: "reservation_fee", confirmed: 75, agreement: 50 }); }
    const h2 = harness({ check: { ...okCheck, deposit: null } });
    const ok = await sts.confirmStaffTerms(fakeDb(seed()), { applicationId: A, terms: terms(), actor }, h2.deps);
    expect(ok.ok).toBe(true);
  });
});
