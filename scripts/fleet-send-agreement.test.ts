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
    let op = "select"; let payload: any = null; let single = false;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q, insert: (r: Row) => { op = "insert"; payload = r; return q; }, update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
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
      const hit = rows.filter((r) => f.every((x) => x(r)));
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
    expect(r.issued).toEqual([{ id: A, o: { createdBy: null } }]);
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
