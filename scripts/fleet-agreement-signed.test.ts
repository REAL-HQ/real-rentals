// FLEET agreement_signed_by_renter: payload, queue + send, signing wiring,
// and the proposed constraint migration (PGlite). Network is refused.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;

const fw = await import("@/lib/fleet-webhook.server");

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
      is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
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
const AG = "22222222-2222-4222-8222-222222222222";
const VEH = "33333333-3333-4333-8333-333333333333";
function seed(over: Record<string, any> = {}): Record<string, Row[]> {
  return {
    applications: [{ id: APP, full_name: "Jordan Test", vehicle_id: null }],
    agreements: [{
      id: AG, application_id: APP, rental_id: null, vehicle_id: VEH, status: "signed", signer_name: "Jordan Q Test",
      signed_at: "2026-11-15T20:00:00.000Z", sent_at: "2026-11-15T18:00:00.000Z", auth_method: "email_link",
      company_signer_name: "Dolmar Cross", company_signer_title: "Authorized Representative",
      merge_data: { vehicle: "2022 Toyota Camry" }, archive_status: "archived", document_id: "doc-1", voided_at: null, ...over,
    }],
    rentals: [{ id: "rent-1", application_id: APP, vehicle_id: VEH, end_date: null, created_at: "2026-11-15T19:00:00.000Z" }],
    vehicles: [{ id: VEH, year: 2022, make: "Toyota", model: "Camry", license_plate: "ABC1234", unit_number: "R12" }],
    fleet_webhook_deliveries: [],
  };
}
const ENV_ON = { FLEET_WEBHOOK_URL: "https://fleet.example.test/hooks/lead", FLEET_WEBHOOK_KEY: "fleet-test-key" };

describe("agreement_signed_by_renter payload", () => {
  test("agreement, rental, renter, vehicle, signed_at and the pre-applied countersign", async () => {
    const p = await fw.buildAgreementSignedPayload(fakeDb(seed()), AG);
    expect(p).toEqual({
      event: "agreement_signed_by_renter", agreement_id: AG, lead_id: APP, rental_id: "rent-1", renter_name: "Jordan Q Test",
      vehicle: { id: VEH, label: "2022 Toyota Camry", plate: "ABC1234", unit_number: "R12" },
      signed_at: "2026-11-15T20:00:00.000Z", signed_via: "email_link", signed_pdf_ready: true,
      countersign: { required: false, status: "pre_applied_at_send", name: "Dolmar Cross", title: "Authorized Representative", applied_at: "2026-11-15T18:00:00.000Z" },
      admin_url: `https://drivereal.com/admin?tab=drivers&id=${APP}`,
    });
  });
  test("no rental yet: rental_id null; unsigned or voided: no payload", async () => {
    const s = seed(); s.rentals = [];
    expect((await fw.buildAgreementSignedPayload(fakeDb(s), AG))?.rental_id).toBeNull();
    expect(await fw.buildAgreementSignedPayload(fakeDb(seed({ status: "sent", signed_at: null })), AG)).toBeNull();
    expect(await fw.buildAgreementSignedPayload(fakeDb(seed({ voided_at: "2026-11-15T21:00:00Z" })), AG)).toBeNull();
    expect(await fw.buildAgreementSignedPayload(fakeDb(seed()), "missing")).toBeNull();
  });
  test("pdf not archived yet is reported, not hidden", async () => {
    expect((await fw.buildAgreementSignedPayload(fakeDb(seed({ archive_status: "failed" })), AG))?.signed_pdf_ready).toBe(false);
  });
});

describe("notifyFleetAgreementSigned", () => {
  test("queues once per agreement and sends signed + Bearer", async () => {
    const db = fakeDb(seed());
    const calls: any[] = [];
    const fetch = (async (url: string, init: any) => { calls.push({ url, init }); return new Response("ok", { status: 200 }); }) as any;
    const id = await fw.notifyFleetAgreementSigned(db, AG, { env: ENV_ON, fetch });
    expect(id).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers.Authorization).toBe("Bearer fleet-test-key");
    expect(calls[0].init.headers["X-Real-Event"]).toBe("agreement_signed_by_renter");
    const body = JSON.parse(calls[0].init.body);
    expect(body).toMatchObject({ event: "agreement_signed_by_renter", agreement_id: AG, delivery_id: id });
    const rows = db.state.fleet_webhook_deliveries;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_type: "agreement_signed_by_renter", dedupe_key: `agreement_signed_by_renter:${AG}`, application_id: APP, status: "delivered" });
    // A second call (retry, double submit) adds no row and sends nothing.
    await fw.notifyFleetAgreementSigned(db, AG, { env: ENV_ON, fetch });
    expect(db.state.fleet_webhook_deliveries).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
  test("disabled config: row skipped, nothing sent", async () => {
    const db = fakeDb(seed());
    await fw.notifyFleetAgreementSigned(db, AG, { env: {} });
    expect(db.state.fleet_webhook_deliveries[0].status).toBe("skipped");
  });
  test("never throws: a broken database does not fail signing", async () => {
    const broken = { from: () => { throw new Error("db down"); } };
    expect(await fw.notifyFleetAgreementSigned(broken, AG, { env: ENV_ON })).toBeNull();
  });
});

describe("wiring", () => {
  test("completeSigning notifies FLEET after archive, guarded by try/catch", () => {
    const s = readFileSync("src/lib/esign.server.ts", "utf8");
    expect(s).toMatch(/archiveDocument\(admin, ag, null\);\s*\/\/ FLEET[^\n]*\n\s*try \{\s*const \{ notifyFleetAgreementSigned \}[\s\S]*?await notifyFleetAgreementSigned\(admin, args\.id\);\s*\} catch/);
    expect(fw.FLEET_AGREEMENT_EVENTS).toEqual(["agreement_signed_by_renter"]);
    expect(readFileSync("docs/fleet-webhooks.md", "utf8")).toContain("agreement_signed_by_renter");
  });
});

describe("proposed migration (PGlite)", () => {
  const BASE = readFileSync("supabase/migrations/20261114130000_fleet_webhooks_quo_events_lead_activity.sql", "utf8");
  const SQL = readFileSync("proposed/fleet-agreement-signed-event-v1.sql", "utf8");
  test("before: refused; after: accepted; old events still accepted; bogus still refused; re-runnable", async () => {
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
    await pg.exec(BASE);
    const ins = (e: string) => pg.query(`INSERT INTO fleet_webhook_deliveries (event_type, dedupe_key) VALUES ($1, $2)`, [e, `${e}:${Math.random()}`]);
    await expect(ins("agreement_signed_by_renter")).rejects.toThrow();
    await pg.exec(SQL);
    await ins("agreement_signed_by_renter");
    for (const e of ["lead_created", "stage_changed", "quo_message_received", "quo_call", "quo_voicemail", "quo_transcript"]) await ins(e);
    await expect(ins("nope")).rejects.toThrow();
    await pg.exec(SQL);
    await ins("agreement_signed_by_renter");
  });
  test("not in supabase/migrations (proposed only)", () => {
    expect(SQL).toMatch(/PROPOSED, NOT APPLIED/);
    expect(SQL).not.toMatch(/\bDROP TABLE\b|\bDELETE FROM\b|\bTRUNCATE\b/i);
  });
});
