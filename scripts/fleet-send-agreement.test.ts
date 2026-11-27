// FLEET send-agreement: confirmation parsing, refusals, term matching,
// store-then-send order, idempotency, and the proposed table (PGlite).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const m = await import("@/lib/fleet-agreement.server");

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>, opts: { missing?: string[] } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false; let sort: { c: string; asc: boolean } | null = null; let lim: number | null = null;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q, insert: (r: Row) => { op = "insert"; payload = r; return q; }, update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      order: (c: string, o: any = {}) => { sort = { c, asc: o.ascending !== false }; return q; }, limit: (k: number) => { lim = k; return q; },
      maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (opts.missing?.includes(table)) return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
      const rows = state[table];
      if (op === "insert") {
        if (payload.idempotency_key && rows.some((r) => r.idempotency_key === payload.idempotency_key)) return { data: null, error: { code: "23505", message: "dup" } };
        const r = { id: `${table}-${n++}`, ...payload }; rows.push(r); return { data: { id: r.id }, error: null };
      }
      let hit = rows.filter((r) => f.every((x) => x(r)));
      if (sort) { const { c, asc } = sort; hit = [...hit].sort((x, y) => (String(x[c]) < String(y[c]) ? -1 : String(x[c]) > String(y[c]) ? 1 : 0) * (asc ? 1 : -1)); }
      if (lim != null && op === "select") hit = hit.slice(0, lim);
      if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
      return { data: single ? hit[0] ?? null : hit, error: null };
    }
    return q;
  }
  return { from, state };
}

const KEY = "k".repeat(40);
const NOW = new Date("2026-11-16T20:10:00Z");
const A = "11111111-1111-4111-8111-111111111111";
const V = "44444444-4444-4444-8444-444444444444";
const V2 = "55555555-5555-4555-8555-555555555555";
const okCheck = { blockers: [], weeklyRate: 325, deposit: 0, startDate: "2026-11-18", vehicleId: V, vehicleLabel: "2021 Toyota Camry" };
const conf = (x: Row = {}) => ({ confirmed_at: "2026-11-16T15:04:00-05:00", channel: "call", call_id: "ACcall1", summary: "Confirmed $325/week, no deposit, pickup Wed.", weekly_rate: 325, deposit: 0, start_date: "2026-11-18", vehicle_id: V, ...x });
const seed = (status = "approved") => ({ applications: [{ id: A, status, full_name: "Test Renter", email: "t@example.com", deleted_at: null }], agreement_terms_confirmations: [] });
async function call(db: any, body: Row, d: Row = {}) {
  const issued: any[] = []; const audits: any[] = [];
  const res = await m.handleFleetSendAgreement(new Request("https://drivereal.com/api/public/fleet/send-agreement", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), {
    admin: db, env: { FLEET_API_KEY: KEY }, now: () => NOW, audit: async (e) => { audits.push(e); },
    check: async () => d.check ?? okCheck,
    hasOpenOrSigned: async () => d.open ?? false,
    ...(d.staffApproval !== undefined ? { staffApproval: async () => d.staffApproval } : {}),
    dncSuppressed: async (_a: any, who: any) => { if (d.dncCalls) d.dncCalls.push(who); return d.dnc ?? false; },
    issue: async (_a: any, id: string, o: any) => { if (d.fail) throw new Error("Resend down"); issued.push({ id, o }); return { id: "agr-1", url: "https://drivereal.com/sign/SECRET", delivery: { email: "sent", sms: "sent", delivered: true } }; },
  });
  return { status: res.status, body: await res.json(), issued, audits };
}

describe("confirmation parsing", () => {
  test("requires zone, channel id, summary, positive rate, deposit, date, vehicle; not stale or future", () => {
    expect(m.parseTermsConfirmation(conf(), NOW).ok).toBe(true);
    for (const bad of [
      { confirmed_at: "2026-11-16 15:04" }, { confirmed_at: "2026-11-25T00:00:00Z" }, { confirmed_at: "2026-11-01T00:00:00Z" },
      { channel: "email" }, { call_id: "" }, { channel: "sms", call_id: null }, { summary: "ok" }, { weekly_rate: 0 }, { deposit: "x" },
      { start_date: "11/18/2026" }, { vehicle_id: "Camry" },
    ]) expect(m.parseTermsConfirmation(conf(bad), NOW).ok).toBe(false);
    expect(m.parseTermsConfirmation(conf({ channel: "sms", call_id: null, message_id: "MSG1" }), NOW).ok).toBe(true);
  });
});

describe("send-agreement endpoint", () => {
  test("happy path: stores the confirmation, then sends via issueAgreement(createdBy null); signing link never returned", async () => {
    const db = fakeDb(seed());
    const r = await call(db, { lead_id: A, idempotency_key: "agr-A-1", terms_confirmation: conf() });
    expect(r.status).toBe(201);
    expect(r.issued).toHaveLength(1);
    expect(r.issued[0]).toMatchObject({ id: A, o: { createdBy: null, prep: { reservation: { mode: "not_required" }, damageWaiver: "declined", payment: { method: "Card Autopay" } } } });
    expect(JSON.stringify(r.body)).not.toContain("/sign/");
    expect(db.state.agreement_terms_confirmations[0]).toMatchObject({ application_id: A, channel: "call", call_id: "ACcall1", weekly_rate: 325, deposit: 0, start_date: "2026-11-18", vehicle_id: V, recorded_by: "FLEET (automated)", agreement_id: "agr-1" });
    expect(r.audits[0]).toMatchObject({ action: "agreement.fleet_sent", entityId: A, metadata: { decided_by: "FLEET (automated)", agreement_id: "agr-1" } });
    const again = await call(db, { lead_id: A, idempotency_key: "agr-A-1", terms_confirmation: conf() });
    expect(again.body).toMatchObject({ ok: true, duplicate: true, agreement_id: "agr-1" });
    expect(again.issued).toHaveLength(0);
  });
  test("refusals send nothing and store nothing", async () => {
    for (const [s, d, want] of [
      ["new", {}, "Approved"], ["approved", { open: true }, "already out"],
      ["approved", { check: { ...okCheck, vehicleId: null } }, "No vehicle"], ["approved", { check: { ...okCheck, weeklyRate: null } }, "No weekly rate"],
      ["approved", { check: { ...okCheck, blockers: [{ field: "vehicle_vin", label: "VIN", why: "x" }] } }, "missing details"],
    ] as const) {
      const db = fakeDb(seed(s));
      const r = await call(db, { lead_id: A, terms_confirmation: conf() }, d as any);
      expect(r.status).toBe(409);
      expect(r.body.error).toContain(want);
      expect(r.issued).toHaveLength(0);
      expect(db.state.agreement_terms_confirmations).toHaveLength(0);
    }
  });
  test("a confirmed term that differs from the agreement blocks the send", async () => {
    const db = fakeDb(seed());
    const r = await call(db, { lead_id: A, terms_confirmation: conf({ weekly_rate: 300, vehicle_id: V2 }) });
    expect(r.status).toBe(409);
    expect(r.body.mismatches.map((x: any) => x.field).sort()).toEqual(["vehicle_id", "weekly_rate"]);
    expect(r.issued).toHaveLength(0);
    expect(db.state.agreement_terms_confirmations).toHaveLength(0);
  });
  test("no table: 503 and nothing sent; send failure keeps the record and a retry reuses it", async () => {
    const missing = fakeDb(seed(), { missing: ["agreement_terms_confirmations"] });
    const r = await call(missing, { lead_id: A, terms_confirmation: conf() });
    expect(r.status).toBe(503);
    expect(r.issued).toHaveLength(0);
    const db = fakeDb(seed());
    const fail = await call(db, { lead_id: A, idempotency_key: "k1", terms_confirmation: conf() }, { fail: true });
    expect(fail.status).toBe(409);
    expect(fail.audits[0].action).toBe("agreement.fleet_send_failed");
    expect(db.state.agreement_terms_confirmations).toHaveLength(1);
    const retry = await call(db, { lead_id: A, idempotency_key: "k1", terms_confirmation: conf() });
    expect(retry.status).toBe(201);
    expect(db.state.agreement_terms_confirmations).toHaveLength(1);
    expect(db.state.agreement_terms_confirmations[0].agreement_id).toBe("agr-1");
  });
  test("auth required", async () => {
    const res = await m.handleFleetSendAgreement(new Request("https://x/api/public/fleet/send-agreement", { method: "POST", body: "{}" }), { admin: fakeDb(seed()), env: { FLEET_API_KEY: KEY } });
    expect(res.status).toBe(401);
  });
});

describe("wiring", () => {
  test("route POST-only; uses issueAgreement and never touches the company signer setting", () => {
    const r = readFileSync("src/routes/api/public/fleet/send-agreement.ts", "utf8");
    expect(r).toContain('createFileRoute("/api/public/fleet/send-agreement")');
    expect(r).not.toMatch(/GET:/);
    expect(readFileSync("src/routeTree.gen.ts", "utf8")).toContain("/api/public/fleet/send-agreement");
    const src = readFileSync("src/lib/fleet-agreement.server.ts", "utf8");
    expect(src).toContain("issueAgreement");
    expect(src).not.toMatch(/esign_company_signer|company_signer_name\s*:|setCompanySigner/);
  });
});

describe("proposed migration (PGlite)", () => {
  const SQL = readFileSync("proposed/agreement-terms-confirmations-v1.sql", "utf8");
  test("checks channel ids, amounts, summary; re-runnable", async () => {
    const pg = new PGlite();
    await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA private;
      CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE TABLE public.applications (id uuid primary key default gen_random_uuid());`);
    await pg.exec(SQL);
    const app = (await pg.query<any>(`INSERT INTO applications DEFAULT VALUES RETURNING id`)).rows[0].id;
    const ins = (ch: string, call: string | null, msg: string | null, rate = 325, summary = "Confirmed the terms") =>
      pg.query(`INSERT INTO agreement_terms_confirmations (application_id, confirmed_at, channel, call_id, message_id, summary, weekly_rate, deposit, start_date, vehicle_id, recorded_by)
        VALUES ($1, now(), $2, $3, $4, $5, $6, 0, '2026-11-18', gen_random_uuid(), 'FLEET (automated)')`, [app, ch, call, msg, summary, rate]);
    await ins("call", "AC1", null);
    await ins("sms", null, "M1");
    await expect(ins("call", null, "M1")).rejects.toThrow();
    await expect(ins("email", "AC1", null)).rejects.toThrow();
    await expect(ins("call", "AC1", null, 0)).rejects.toThrow();
    await expect(ins("call", "AC1", null, 325, "ok")).rejects.toThrow();
    await pg.exec(SQL);
    expect(SQL).toMatch(/PROPOSED, NOT APPLIED/);
  });
});

describe("terms confirmation waived for staff-approved applicants (Dolmar, Nov 27 2026)", () => {
  const STAFF_UID = "99999999-9999-4999-8999-999999999999";
  const approvedRow = (x: Row = {}) => ({ id: "aud-1", action: "application.approved", entity_id: A, actor_user_id: STAFF_UID, actor_email: "rosa@drivereal.com", actor_role: "team", metadata: { previous_status: "reviewing" }, created_at: "2026-11-25T16:59:03Z", ...x });
  const withAudit = (status: string, rows: Row[]) => ({ ...seed(status), audit_log: rows });

  test("loadStaffApproval: staff entry counts; FLEET's automated approval and no entry do not; latest entry wins", async () => {
    expect(await m.loadStaffApproval(fakeDb(withAudit("approved", [approvedRow()])), A)).toMatchObject({ approver_user_id: STAFF_UID, approver_email: "rosa@drivereal.com", approved_at: "2026-11-25T16:59:03Z", audit_id: "aud-1" });
    expect(await m.loadStaffApproval(fakeDb(withAudit("approved", [approvedRow({ actor_user_id: null, actor_email: null, actor_role: null, metadata: { decided_by: "FLEET (automated)" } })])), A)).toBeNull();
    expect(await m.loadStaffApproval(fakeDb(withAudit("approved", [])), A)).toBeNull();
    expect(await m.loadStaffApproval(fakeDb(withAudit("approved", [approvedRow({ entity_id: "someone-else" })])), A)).toBeNull();
    // Staff approved, later re-approved by FLEET: the latest (FLEET) entry is the approval.
    expect(await m.loadStaffApproval(fakeDb(withAudit("approved", [approvedRow(), approvedRow({ id: "aud-2", actor_user_id: null, metadata: { decided_by: "FLEET (automated)" }, created_at: "2026-11-26T10:00:00Z" })])), A)).toBeNull();
    // FLEET approved, later approved by staff: staff counts.
    expect(await m.loadStaffApproval(fakeDb(withAudit("approved", [approvedRow({ id: "aud-0", actor_user_id: null, metadata: { decided_by: "FLEET (automated)" }, created_at: "2026-11-20T10:00:00Z" }), approvedRow()])), A)).toMatchObject({ audit_id: "aud-1" });
  });

  test("approved by staff: sends without terms_confirmation, writes the waiver audit row, stores no confirmation", async () => {
    const db = fakeDb(withAudit("approved", [approvedRow()]));
    const r = await call(db, { lead_id: A, idempotency_key: "fast-1" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, agreement_id: "agr-1", confirmation_id: null, terms_confirmation_waived: true, approved_by: "rosa@drivereal.com", approved_at: "2026-11-25T16:59:03Z" });
    expect(JSON.stringify(r.body)).not.toContain("/sign/");
    expect(r.issued).toHaveLength(1);
    expect(r.issued[0]).toMatchObject({ id: A, o: { createdBy: null, prep: { reservation: { mode: "not_required" } } } });
    const waiver = r.audits.find((e) => e.action === "agreement.terms_confirmation_waived_approved");
    expect(waiver).toMatchObject({ entityType: "application", entityId: A, metadata: { decided_by: "FLEET (automated)", application_id: A, approved_by_user_id: STAFF_UID, approved_by_email: "rosa@drivereal.com", approved_at: "2026-11-25T16:59:03Z", approval_audit_id: "aud-1" } });
    // The waiver is logged before the send.
    expect(r.audits.findIndex((e) => e.action === "agreement.terms_confirmation_waived_approved")).toBeLessThan(r.audits.findIndex((e) => e.action === "agreement.fleet_sent"));
    expect(r.audits.find((e) => e.action === "agreement.fleet_sent")).toMatchObject({ metadata: { channel: "waived_approved", terms_confirmation_waived: true, agreement_id: "agr-1" } });
    expect(db.state.agreement_terms_confirmations).toHaveLength(0);
  });

  test("not approved by staff: the existing requirement stands and nothing is sent or logged as waived", async () => {
    const cases: [string, Row[]][] = [
      ["approved", [approvedRow({ actor_user_id: null, actor_email: null, actor_role: null, metadata: { decided_by: "FLEET (automated)" } })]],
      ["approved", []],
      ["reviewing", [approvedRow()]],
      ["new", []],
      ["active", [approvedRow()]],
    ];
    for (const [status, rows] of cases) {
      const db = fakeDb(withAudit(status, rows));
      const r = await call(db, { lead_id: A });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("terms_confirmation is required.");
      expect(r.issued).toHaveLength(0);
      expect(r.audits.some((e) => e.action === "agreement.terms_confirmation_waived_approved")).toBe(false);
    }
  });

  test("DNC List still blocks: staff-approved waiver and confirmed sends both refuse", async () => {
    const calls: any[] = [];
    const db = fakeDb(withAudit("approved", [approvedRow()]));
    const r = await call(db, { lead_id: A }, { dnc: true, dncCalls: calls });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain("DNC List");
    expect(r.issued).toHaveLength(0);
    expect(r.audits.some((e) => e.action === "agreement.terms_confirmation_waived_approved")).toBe(false);
    expect(calls[0]).toMatchObject({ applicationId: A, email: "t@example.com" });
    const c = await call(fakeDb(seed()), { lead_id: A, terms_confirmation: conf() }, { dnc: true });
    expect(c.status).toBe(409);
    expect(c.issued).toHaveLength(0);
  });

  test("other guards still apply on the waiver path: agreement already out, blockers, no vehicle", async () => {
    for (const [d, want] of [
      [{ open: true }, "already out"],
      [{ check: { ...okCheck, blockers: [{ field: "vehicle_vin", label: "VIN", why: "x" }] } }, "missing details"],
      [{ check: { ...okCheck, vehicleId: null } }, "No vehicle"],
    ] as const) {
      const r = await call(fakeDb(withAudit("approved", [approvedRow()])), { lead_id: A }, d as any);
      expect(r.status).toBe(409);
      expect(r.body.error).toContain(want);
      expect(r.issued).toHaveLength(0);
      expect(r.audits.some((e) => e.action === "agreement.terms_confirmation_waived_approved")).toBe(false);
    }
  });

  test("auth still required", async () => {
    const res = await m.handleFleetSendAgreement(new Request("https://drivereal.com/api/public/fleet/send-agreement", { method: "POST", headers: { Authorization: "Bearer wrong", "Content-Type": "application/json" }, body: JSON.stringify({ lead_id: A }) }), { admin: fakeDb(withAudit("approved", [approvedRow()])), env: { FLEET_API_KEY: KEY }, now: () => NOW, audit: async () => {}, staffApproval: async () => ({ approved_at: "x", approver_user_id: STAFF_UID, approver_email: null, approver_role: null, audit_id: null }), issue: async () => { throw new Error("must not send"); } });
    expect(res.status).toBe(401);
  });
});
