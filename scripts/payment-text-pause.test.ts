// Payment text pause: parsing, FLEET key auth, the FLEET endpoint, and the
// proposed table (PGlite). Network refused; fake database.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const p = await import("@/lib/payment-text-pause.server");

// ---------------------------------------------------------------- fake db
type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  const unique: Record<string, string> = { payment_text_pauses: "idempotency_key" };
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
      gt: (c: string, v: any) => { f.push((r) => String(r[c]) > String(v)); return q; },
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

const KEY = "k".repeat(40);
const ENV = { FLEET_API_KEY: KEY };
const NOW = new Date("2026-11-15T23:30:00Z"); // 6:30 PM ET
const APP = "11111111-1111-4111-8111-111111111111";
const APP2 = "22222222-2222-4222-8222-222222222222";
const RENT = "33333333-3333-4333-8333-333333333333";
function seed() {
  return {
    applications: [{ id: APP, phone: "(813) 470-6143", deleted_at: null }, { id: APP2, phone: "8135550000", deleted_at: null }],
    rentals: [{ id: RENT, application_id: APP, status: "active" }, { id: "old", application_id: APP, status: "completed" }],
    payment_text_pauses: [],
  };
}
const req = (body: unknown, key: string | null = KEY, method = "POST") => new Request("https://drivereal.com/api/public/fleet/payment-text-pause", {
  method, headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
});
async function call(db: any, body: unknown, key: string | null = KEY, audits: any[] = []) {
  const res = await p.handleFleetPaymentPause(req(body, key), { admin: db, env: ENV, now: () => NOW, audit: async (e) => { audits.push(e); } });
  return { status: res.status, body: await res.json() };
}

describe("pause_until", () => {
  test("a date means 11:59:59 PM Eastern that day (EST and EDT)", () => {
    expect((p.parsePauseUntil("2026-11-21", NOW) as any).until.toISOString()).toBe("2026-11-22T04:59:59.000Z");
    expect((p.parsePauseUntil("2026-11-21T12:00:00-05:00", NOW) as any).until.toISOString()).toBe("2026-11-21T17:00:00.000Z");
  });
  test("refuses past, zone-less, too long, garbage", () => {
    expect(p.parsePauseUntil("2026-11-14", NOW).ok).toBe(false);
    expect(p.parsePauseUntil("2026-11-21T12:00:00", NOW).ok).toBe(false);
    expect(p.parsePauseUntil("2027-02-01", NOW).ok).toBe(false);
    expect(p.parsePauseUntil("next friday", NOW).ok).toBe(false);
  });
});

describe("FLEET key", () => {
  test("not configured (missing or short key), wrong key, right key", async () => {
    const r = (k: string | null) => req({}, k);
    expect(await p.fleetApiAuthorized(r(KEY), {})).toBe("not_configured");
    expect(await p.fleetApiAuthorized(r("short"), { FLEET_API_KEY: "short" })).toBe("not_configured");
    expect(await p.fleetApiAuthorized(r(null), ENV)).toBe("unauthorized");
    expect(await p.fleetApiAuthorized(r(KEY + "x"), ENV)).toBe("unauthorized");
    expect(await p.fleetApiAuthorized(r(KEY), ENV)).toBe("ok");
  });
  test("endpoint: 401 wrong key, 503 unset key, 405 non-POST; nothing written", async () => {
    const db = fakeDb(seed());
    expect((await call(db, { action: "status", phone: "8134706143" }, "nope")).status).toBe(401);
    const unset = await p.handleFleetPaymentPause(req({}), { admin: db, env: {}, now: () => NOW });
    expect(unset.status).toBe(503);
    const get = await p.handleFleetPaymentPause(req(null, KEY, "GET"), { admin: db, env: ENV, now: () => NOW });
    expect(get.status).toBe(405);
    expect(db.state.payment_text_pauses).toHaveLength(0);
  });
});

describe("FLEET endpoint", () => {
  test("pause by phone: one row, end of day ET, audited as FLEET; status reads it back; activePaymentPause sees it", async () => {
    const db = fakeDb(seed()); const audits: any[] = [];
    const r = await call(db, { action: "pause", phone: "+1 (813) 470-6143", pause_until: "2026-11-21", reason: "Deal: $1,050 by 11/21", requested_by: "Dolmar", idempotency_key: "deal-1" }, KEY, audits);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, rental_id: RENT, lead_id: APP, pause_until: "2026-11-22T04:59:59.000Z" });
    expect(db.state.payment_text_pauses[0]).toMatchObject({ rental_id: RENT, source: "fleet", created_by: "FLEET (automated) for Dolmar", reason: "Deal: $1,050 by 11/21" });
    expect(audits[0]).toMatchObject({ action: "payment_text_pause.created", entityId: RENT });
    const s = await call(db, { action: "status", rental_id: RENT });
    expect(s.body).toMatchObject({ paused: true, pause_until: "2026-11-22T04:59:59.000Z" });
    expect(await p.activePaymentPause(db, RENT, NOW)).toMatchObject({ paused: true });
    expect(await p.activePaymentPause(db, RENT, new Date("2026-11-22T05:00:00Z"))).toEqual({ paused: false });
  });
  test("idempotent with the same key; the key cannot be reused for another rental", async () => {
    const db = fakeDb(seed());
    const body = { action: "pause", rental_id: RENT, pause_until: "2026-11-21", reason: "Deal: pays Friday", idempotency_key: "deal-2" };
    expect((await call(db, body)).status).toBe(201);
    const again = await call(db, body);
    expect(again).toMatchObject({ status: 200, body: { duplicate: true } });
    expect(db.state.payment_text_pauses).toHaveLength(1);
  });
  test("cancel lifts it early and is audited; a second cancel is 404", async () => {
    const PID = "44444444-4444-4444-8444-444444444444";
    const db = fakeDb({ ...seed(), payment_text_pauses: [{ id: PID, rental_id: RENT, starts_at: "2026-11-15T00:00:00Z", pause_until: "2026-11-22T04:59:59Z", reason: "Deal: pays Friday", cancelled_at: null }] });
    const audits: any[] = [];
    expect(await p.activePaymentPause(db, RENT, NOW)).toMatchObject({ paused: true, id: PID });
    const c = await call(db, { action: "cancel", pause_id: PID, reason: "Paid in full" }, KEY, audits);
    expect(c).toMatchObject({ status: 200, body: { ok: true, pause_id: PID } });
    expect(db.state.payment_text_pauses[0]).toMatchObject({ cancelled_by: "FLEET (automated)", cancel_reason: "Paid in full" });
    expect(await p.activePaymentPause(db, RENT, NOW)).toEqual({ paused: false });
    expect(audits[0]).toMatchObject({ action: "payment_text_pause.cancelled", entityId: RENT });
    expect((await call(db, { action: "cancel", pause_id: PID })).status).toBe(404);
  });
  test("refuses: no renter, no active rental, ambiguous, missing reason, bad date, bad action", async () => {
    const db = fakeDb(seed());
    expect((await call(db, { action: "pause", phone: "8130000000", pause_until: "2026-11-21", reason: "Deal: x y z" })).status).toBe(404);
    expect((await call(db, { action: "pause", lead_id: APP2, pause_until: "2026-11-21", reason: "Deal: x y z" })).status).toBe(404);
    const two = fakeDb({ ...seed(), rentals: [{ id: RENT, application_id: APP, status: "active" }, { id: "r2", application_id: APP, status: "active" }] });
    expect((await call(two, { action: "pause", lead_id: APP, pause_until: "2026-11-21", reason: "Deal: x y z" })).status).toBe(409);
    expect((await call(db, { action: "pause", rental_id: RENT, pause_until: "2026-11-21", reason: "x" })).status).toBe(400);
    expect((await call(db, { action: "pause", rental_id: RENT, pause_until: "tomorrow", reason: "Deal: x y z" })).status).toBe(400);
    expect((await call(db, { action: "nuke", rental_id: RENT })).status).toBe(400);
    expect((await call(db, { action: "pause", pause_until: "2026-11-21", reason: "Deal: x y z" })).status).toBe(400);
    expect(db.state.payment_text_pauses).toHaveLength(0);
  });
});

describe("wiring", () => {
  test("route is POST-only and only calls the handler; key read server-side only", () => {
    const r = readFileSync("src/routes/api/public/fleet/payment-text-pause.ts", "utf8");
    expect(r).toContain('createFileRoute("/api/public/fleet/payment-text-pause")');
    expect(r).not.toMatch(/GET:/);
    expect(readFileSync("src/routeTree.gen.ts", "utf8")).toContain("/api/public/fleet/payment-text-pause");
    for (const f of ["src/lib/rent-reminders.server.ts", "src/lib/failed-payment-notice.server.ts", "src/routes/api/public/payments/webhook.ts"])
      expect(readFileSync(f, "utf8")).toContain("activePaymentPause");
  });
});

describe("proposed migration (PGlite)", () => {
  const SQL = readFileSync("proposed/payment-text-pauses-v1.sql", "utf8");
  test("table, window cap, reason check, idempotency unique, staff-read RLS; re-runnable", async () => {
    const pg = new PGlite();
    await pg.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA private;
      CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE TABLE public.applications (id uuid primary key default gen_random_uuid(), email text, phone text, status text, created_at timestamptz default now());
      CREATE TABLE public.rentals (id uuid primary key default gen_random_uuid(), application_id uuid, status text);
      CREATE TABLE public.outbound_messages (id uuid primary key default gen_random_uuid(), channel text, to_address text, from_address text, subject text, body text,
        status text, kind text, application_id uuid, sent_at timestamptz, created_at timestamptz default now());
      CREATE TABLE public.messages (id uuid primary key default gen_random_uuid(), application_id uuid, body text, direction text, delivery_state text, created_at timestamptz default now());
      CREATE TABLE public.email_deliveries (id uuid primary key default gen_random_uuid(), workflow text, recipient text, state text, created_at timestamptz default now());
    `);
    await pg.exec(SQL);
    const r = (await pg.query<any>(`INSERT INTO rentals (status) VALUES ('active') RETURNING id`)).rows[0].id;
    const ins = (until: string, reason = "Deal: pays Friday", key: string | null = null) =>
      pg.query(`INSERT INTO payment_text_pauses (rental_id, pause_until, reason, created_by, source, idempotency_key) VALUES ($1, now() + $2::interval, $3, 'FLEET (automated)', 'fleet', $4)`, [r, until, reason, key]);
    await ins("6 days", "Deal: pays Friday", "k1");
    await expect(ins("6 days", "Deal: pays Friday", "k1")).rejects.toThrow();
    await expect(ins("46 days")).rejects.toThrow();
    await expect(ins("-1 day")).rejects.toThrow();
    await expect(ins("1 day", "x")).rejects.toThrow();
    await expect(pg.query(`INSERT INTO payment_text_pauses (rental_id, pause_until, reason, created_by, source) VALUES ($1, now() + interval '1 day', 'Deal: ok ok', 'x', 'robot')`, [r])).rejects.toThrow();
    expect((await pg.query<any>(`SELECT relrowsecurity FROM pg_class WHERE relname='payment_text_pauses'`)).rows[0].relrowsecurity).toBe(true);
    await pg.exec(SQL);
    expect(SQL).toMatch(/PROPOSED, NOT APPLIED/);
    expect(SQL).not.toMatch(/\bDELETE FROM\b|\bTRUNCATE\b/i);
  });
});
