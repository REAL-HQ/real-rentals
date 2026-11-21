// FLEET license readings: DOB and license expiry read off the license photo,
// saved labelled "Read by FLEET from license photo", never verified; only
// empty or FLEET-written fields are filled; the review rules then use them.
// Network refused; fake database; proposed table on PGlite.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const lic = await import("@/lib/fleet-license.server");
const srv = await import("@/lib/fleet-review.server");

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>, opts: { missing?: string[] } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  const unique: Record<string, string> = { fleet_review_decisions: "idempotency_key", fleet_webhook_deliveries: "dedupe_key", fleet_license_readings: "idempotency_key" };
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false; let lim: number | null = null; let wantRows = false; let cols = "";
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: (c?: string) => { wantRows = true; cols = c ?? ""; return q; },
      insert: (r: Row) => { op = "insert"; payload = r; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      upsert: (r: Row, o: any) => { op = o?.ignoreDuplicates ? "insert_ignore" : "insert"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      neq: (c: string, v: any) => { f.push((r) => r[c] !== v); return q; },
      is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      gte: (c: string, v: any) => { f.push((r) => String(r[c] ?? "") >= String(v)); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      order: () => q,
      limit: (x: number) => { lim = x; return q; },
      maybeSingle: () => { single = true; return q; },
      single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (opts.missing?.includes(table)) return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
      if (table === "applications" && cols.includes("approval_evidence_version"))
        return { data: null, error: { code: "42703", message: "column applications.approval_evidence_version does not exist" } };
      const rows = state[table];
      if (op === "insert" || op === "insert_ignore") {
        const u = unique[table];
        if (u && payload[u] != null && rows.some((r) => r[u] === payload[u])) {
          if (op === "insert_ignore") return { data: [], error: null };
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        if (table === "fleet_review_decisions" && payload.decision === "needs_staff" && rows.some((r) => r.application_id === payload.application_id && r.decision === "needs_staff" && !r.resolved_at))
          return { data: null, error: { code: "23505", message: "one open" } };
        const r = { id: `${table}-${n++}`, created_at: new Date().toISOString(), resolved_at: null, ...payload };
        rows.push(r);
        return { data: wantRows ? (single ? { id: r.id } : [{ id: r.id }]) : null, error: null };
      }
      let m = rows.filter((r) => f.every((x) => x(r)));
      if (op === "update") { for (const r of m) Object.assign(r, payload); return { data: wantRows ? m.map((r) => ({ ...r })) : null, error: null }; }
      if (lim != null) m = m.slice(0, lim);
      return { data: single ? m[0] ?? null : m, error: null };
    }
    return q;
  }
  return { from, state, storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed.example/${p}?t=1` } }) }) } };
}

const KEY = "k".repeat(40);
const ENV = { FLEET_API_KEY: KEY };
const NOW = new Date("2026-11-16T15:00:00Z");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const DOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BACK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const app = (id: string, extra: Row = {}) => ({
  id, full_name: "Test Renter", email: `t${id.slice(0, 2)}@example.com`, phone: "8135550100", status: "new", dob: null, license_expiration: null,
  license_valid: true, rating: 4.95, trips_completed: 2400, gig_status: "Yes, already driving", background_check_status: "pending", mvr_status: "pending",
  deleted_at: null, primary_application_id: null, resubmission_count: 0, created_at: "2026-11-15T12:00:00Z", insurance_status: "unknown", ...extra,
});
function seed(extra: Row = {}) {
  return {
    applications: [app(A, extra), app(B)],
    documents: [
      { id: DOC, driver_id: A, category: "license_front", review_status: "uploaded", is_current: true, created_at: "2026-11-16T14:00:00Z" },
      { id: `${A}-g`, driver_id: A, category: "gig_profile", review_status: "uploaded", is_current: true, created_at: "2026-11-16T14:00:00Z" },
      { id: BACK, driver_id: A, category: "license_back", review_status: "uploaded", is_current: true, created_at: "2026-11-16T14:00:00Z" },
      { id: OTHER, driver_id: B, category: "license_front", review_status: "uploaded", is_current: true, created_at: "2026-11-16T14:00:00Z" },
    ],
    driver_screenings: [], agreements: [], fleet_review_decisions: [], fleet_webhook_deliveries: [], fleet_license_readings: [],
  };
}
const req = (body: unknown, key: string | null = KEY) => new Request("https://drivereal.com/api/public/fleet/license-facts", {
  method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body),
});
const audits: any[] = [];
const deps = (db: any, extra: Row = {}) => ({ admin: db, env: ENV, now: () => NOW, audit: async (e: any) => { audits.push(e); }, ...extra });
const good = { lead_id: A, document_id: DOC, dob: "1990-02-03", license_expiration: "2029-05-01", confidence: 0.97, idempotency_key: "lic-A-1" };

describe("license-facts endpoint", () => {
  test("auth and validation", async () => {
    const db = fakeDb(seed());
    expect((await lic.handleFleetLicenseFacts(req(good, null), deps(db))).status).toBe(401);
    expect((await lic.handleFleetLicenseFacts(req(good), { ...deps(db), env: {} })).status).toBe(503);
    for (const bad of [
      { ...good, lead_id: "x" }, { ...good, document_id: "x" }, { ...good, dob: "1990-02-30" }, { ...good, dob: "2015-01-01" },
      { ...good, dob: "2027-01-01" }, { ...good, license_expiration: "29-05-01" }, { lead_id: A, document_id: DOC }, { ...good, confidence: 2 },
    ]) expect((await lic.handleFleetLicenseFacts(req(bad), deps(db))).status).toBe(400);
    expect(db.state.fleet_license_readings).toHaveLength(0);
  });
  test("document must be this applicant's current license front", async () => {
    const db = fakeDb(seed());
    expect((await lic.handleFleetLicenseFacts(req({ ...good, document_id: OTHER }), deps(db))).status).toBe(409);
    expect((await lic.handleFleetLicenseFacts(req({ ...good, document_id: BACK }), deps(db))).status).toBe(409);
    db.state.documents[0].review_status = "rejected";
    expect((await lic.handleFleetLicenseFacts(req(good), deps(db))).status).toBe(409);
    expect(db.state.fleet_license_readings).toHaveLength(0);
  });
  test("fills empty fields, labelled, not verified; the rules then approve; replay is a no-op", async () => {
    const db = fakeDb(seed());
    audits.length = 0;
    const before = await srv.buildReviewPacket(db, A, { now: NOW });
    expect(before!.assessment.escalations.map((e: any) => e.code)).toEqual(expect.arrayContaining(["no_dob", "no_license_expiry"]));
    const r = await lic.handleFleetLicenseFacts(req(good), deps(db));
    const j = await r.json();
    expect(r.status).toBe(201);
    expect(j).toMatchObject({ ok: true, verified: false, label: "Read by FLEET from license photo", applied: ["dob", "license_expiration"], conflicts: [] });
    expect(j.assessment.recommendation).toBe("approve");
    const a = db.state.applications.find((x: Row) => x.id === A)!;
    expect(a.dob).toBe("1990-02-03");
    expect(a.license_expiration).toBe("2029-05-01");
    const row = db.state.fleet_license_readings[0];
    expect(row).toMatchObject({ source_label: "Read by FLEET from license photo", read_by: "FLEET (automated)", document_id: DOC });
    // Never touches review status or verification.
    expect(db.state.documents[0].review_status).toBe("uploaded");
    expect(audits[0].action).toBe("application.fleet_license_read");
    expect(audits[0].summary).toContain("not verified");
    expect(audits[0].summary).not.toContain("1990");
    const p = await srv.buildReviewPacket(db, A, { now: NOW });
    expect(p!.license_reading).toMatchObject({ dob: "1990-02-03", verified: false, label: "Read by FLEET from license photo" });
    expect(p!.assessment.notes.map((n: any) => n.code)).toContain("license_read_by_fleet");
    const again = await (await lic.handleFleetLicenseFacts(req(good), deps(db))).json();
    expect(again.duplicate).toBe(true);
    expect(db.state.fleet_license_readings).toHaveLength(1);
    expect((await lic.handleFleetLicenseFacts(req({ ...good, lead_id: B, document_id: OTHER }), deps(db))).status).toBe(409);
  });
  test("never overwrites a date staff or the applicant entered; FLEET may correct its own", async () => {
    const db = fakeDb(seed({ dob: "1991-01-01" }));
    const j = await (await lic.handleFleetLicenseFacts(req(good), deps(db))).json();
    expect(j.applied).toEqual(["license_expiration"]);
    expect(j.conflicts).toEqual([{ field: "dob", on_file: "1991-01-01", read: "1990-02-03" }]);
    expect(db.state.applications.find((x: Row) => x.id === A)!.dob).toBe("1991-01-01");
    // FLEET re-reads and corrects its own expiry.
    const k = await (await lic.handleFleetLicenseFacts(req({ ...good, dob: undefined, license_expiration: "2030-05-01", idempotency_key: "lic-A-2" }), deps(db))).json();
    expect(k.applied).toEqual(["license_expiration"]);
    expect(db.state.applications.find((x: Row) => x.id === A)!.license_expiration).toBe("2030-05-01");
  });
  test("license number and state: filled when empty, validated, never echoed in full", async () => {
    const db = fakeDb(seed({ license_number: "Z9999999" }));
    for (const bad of [{ ...good, license_number: "x!" }, { ...good, license_state: "ZZ" }]) expect((await lic.handleFleetLicenseFacts(req(bad), deps(db))).status).toBe(400);
    const j = await (await lic.handleFleetLicenseFacts(req({ ...good, license_number: "c123-456-789", license_state: "fl" }), deps(db))).json();
    expect(j.applied).toEqual(["dob", "license_expiration", "license_state"]);
    expect(j.conflicts).toEqual([{ field: "license_number", on_file: "****9999", read: "******6789" }]);
    const a = db.state.applications.find((x: Row) => x.id === A)!;
    expect(a.license_number).toBe("Z9999999");
    expect(a.license_state).toBe("FL");
    expect(JSON.stringify(j)).not.toContain("C123456789");
    const p = await srv.buildReviewPacket(db, A, { now: NOW });
    expect(p!.license_reading!.license_number_masked).toBe("******6789");
  });
  test("an expired license read off the photo becomes a hard blocker; under 23 is a hard blocker (minimum age, Nov 21 2026)", async () => {
    const db = fakeDb(seed());
    const j = await (await lic.handleFleetLicenseFacts(req({ ...good, dob: "2004-06-01", license_expiration: "2026-10-01" }), deps(db))).json();
    expect(j.assessment.hard_blockers.map((b: any) => b.code)).toEqual(expect.arrayContaining(["license_expired", "under_min_age"]));
    // 23 (was a young-driver escalation under 25) is not blocked or escalated for age.
    const db23 = fakeDb(seed());
    const j23 = await (await lic.handleFleetLicenseFacts(req({ ...good, dob: "2003-06-01" }), deps(db23))).json();
    expect(j23.assessment.hard_blockers.map((b: any) => b.code)).not.toContain("under_min_age");
    expect(j23.assessment.escalations.map((b: any) => b.code)).not.toContain("young_driver");
  });
  test("table not installed: 503, nothing changed", async () => {
    const db = fakeDb(seed(), { missing: ["fleet_license_readings"] });
    const r = await lic.handleFleetLicenseFacts(req({ ...good, idempotency_key: undefined }), deps(db));
    expect(r.status).toBe(503);
    expect(db.state.applications.find((x: Row) => x.id === A)!.dob).toBeNull();
  });
  test("source never writes verification fields", () => {
    const s = readFileSync("src/lib/fleet-license.server.ts", "utf8");
    expect(s).not.toMatch(/review_status:\s*["']verified/);
    expect(s).not.toMatch(/(insurance_verified|background_check_status|mvr_status|license_verified)\s*:/);
  });
});

describe("proposed migration (PGlite)", () => {
  const SQL = readFileSync("proposed/fleet-license-readings-v1.sql", "utf8");
  test("table, label default, checks; re-runnable", async () => {
    const pg = new PGlite();
    await pg.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA private;
      CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE TABLE public.applications (id uuid primary key default gen_random_uuid());
      CREATE TABLE public.documents (id uuid primary key default gen_random_uuid());
    `);
    await pg.exec(SQL);
    const id = (await pg.query<any>(`INSERT INTO applications DEFAULT VALUES RETURNING id`)).rows[0].id;
    const r = (await pg.query<any>(`INSERT INTO fleet_license_readings (application_id, dob) VALUES ($1, '1990-02-03') RETURNING source_label`, [id])).rows[0];
    expect(r.source_label).toBe("Read by FLEET from license photo");
    await expect(pg.query(`INSERT INTO fleet_license_readings (application_id) VALUES ($1)`, [id])).rejects.toThrow();
    await expect(pg.query(`INSERT INTO fleet_license_readings (application_id, dob, confidence) VALUES ($1, '1990-01-01', 3)`, [id])).rejects.toThrow();
    await pg.exec(SQL);
    expect(SQL).toMatch(/PROPOSED, NOT APPLIED/);
  });
});
