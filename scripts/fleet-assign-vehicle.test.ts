// FLEET assigns a car: earliest available first, the car's listed rate and
// deposit, one car per person, start date on an open pickup day.
// Network refused; fake database; proposed index on PGlite.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const asg = await import("@/lib/fleet-assign.server");
const { DEFAULT_PICKUP_SCHEDULE } = await import("@/lib/pickup-schedule");

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>, opts: { missing?: string[] } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  const unique: Record<string, string> = { fleet_review_decisions: "idempotency_key", fleet_webhook_deliveries: "dedupe_key" };
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
const NOW = new Date("2026-11-16T13:00:00Z"); // Mon 8 AM ET
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const V1 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const V2 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const V3 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000003";
const V4 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000004";
const car = (id: string, extra: Row = {}) => ({ id, year: 2019, make: "Ford", model: "Fusion", status: "available", archived_at: null, weekly_rate: 350, deposit: null, created_at: "2026-10-06T08:00:00Z", ...extra });
function seed() {
  return {
    applications: [
      { id: A, status: "approved", deleted_at: null, vehicle_id: null, weekly_rent: null, deposit_amount: null, contract_start_date: null },
      { id: B, status: "approved", deleted_at: null, vehicle_id: null, weekly_rent: null, deposit_amount: null, contract_start_date: null },
    ],
    vehicles: [
      car(V1, { created_at: "2026-10-01T00:00:00Z" }), // returned Nov 10
      car(V2, { created_at: "2026-10-05T00:00:00Z" }), // never rented
      car(V3, { weekly_rate: 0 }),                     // no listed rate
      car(V4, { status: "maintenance" }),
    ],
    rentals: [{ id: "r1", vehicle_id: V1, status: "closed", start_date: "2026-10-01", end_date: "2026-11-10" }],
  };
}
const req = (body: unknown, key: string | null = KEY) => new Request("https://drivereal.com/api/public/fleet/assign-vehicle", {
  method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body),
});
const audits: any[] = [];
const deps = (db: any) => ({ admin: db, env: ENV, now: () => NOW, settings: DEFAULT_PICKUP_SCHEDULE, audit: async (e: any) => { audits.push(e); } });

describe("assign-vehicle", () => {
  test("auth", async () => {
    const db = fakeDb(seed());
    expect((await asg.handleFleetAssignVehicle(req({ action: "list" }, null), deps(db))).status).toBe(401);
  });
  test("list: free cars with a listed rate, earliest available first", async () => {
    const db = fakeDb(seed());
    const j = await (await asg.handleFleetAssignVehicle(req({ action: "list" }), deps(db))).json();
    expect(j.vehicles.map((v: any) => v.vehicle_id)).toEqual([V2, V1]);
    expect(j.vehicles[0]).toMatchObject({ weekly_rate: 350, deposit: 0, vehicle: "2019 Ford Fusion" });
  });
  test("assign: first car, listed rate, $0 deposit when none listed, start date on an open pickup day", async () => {
    const db = fakeDb(seed());
    audits.length = 0;
    const r = await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: A, start_date: "2026-11-18" }), deps(db));
    const j = await r.json();
    expect(r.status).toBe(201);
    expect(j).toMatchObject({ vehicle_id: V2, weekly_rate: 350, deposit: 0, start_date: "2026-11-18" });
    expect(db.state.applications[0]).toMatchObject({ vehicle_id: V2, weekly_rent: 350, deposit_amount: 0, contract_start_date: "2026-11-18" });
    expect(audits[0].action).toBe("application.fleet_vehicle_assigned");
    // Replay is a no-op.
    const again = await (await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: A }), deps(db))).json();
    expect(again).toMatchObject({ duplicate: true, vehicle_id: V2 });
    // One car, one person: B gets the next car, and cannot take V2.
    expect((await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: B, vehicle_id: V2 }), deps(db))).status).toBe(409);
    const b = await (await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: B }), deps(db))).json();
    expect(b.vehicle_id).toBe(V1);
    // A cannot switch cars through FLEET.
    expect((await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: A, vehicle_id: V1 }), deps(db))).status).toBe(409);
  });
  test("refusals: not approved, closed day, no rate, maintenance, reserved car", async () => {
    const db = fakeDb(seed());
    db.state.applications[0].status = "new";
    expect((await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: A }), deps(db))).status).toBe(409);
    db.state.applications[0].status = "approved";
    const sat = await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: A, start_date: "2026-11-21" }), deps(db));
    expect(sat.status).toBe(409);
    expect((await sat.json()).next_open_days.length).toBeGreaterThan(0);
    expect((await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: A, start_date: "2026-11-26" }), deps(db))).status).toBe(409); // Thanksgiving
    expect((await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: A, vehicle_id: V3 }), deps(db))).status).toBe(409);
    expect((await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: A, vehicle_id: V4 }), deps(db))).status).toBe(409);
    db.state.rentals.push({ id: "r2", vehicle_id: V2, status: "reserved", start_date: "2026-11-18" });
    const j = await (await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: A }), deps(db))).json();
    expect(j.vehicle_id).toBe(V1);
    expect(db.state.applications[0].vehicle_id).toBe(V1);
  });
  test("source never touches insurance, screening or verification and never reserves", () => {
    const s = readFileSync("src/lib/fleet-assign.server.ts", "utf8");
    // The insurance quote amount is reported back and audited, never written as an insurance field.
    expect(s).not.toMatch(/(insurance_status|insurance_verified|insurance_carrier|full_coverage|background_check|mvr_status|verified)\w*\s*:/);
    expect(s).not.toMatch(/patch\.insurance|insurance_quote_monthly:\s*quote\s*[,}]\s*\)\s*\.eq/);
    expect(s).not.toMatch(/createReservationCore|from\("rentals"\)\.insert/);
  });
});

describe("insurance quote over $350/month (Dolmar, t299s1618)", () => {
  const rate = () => import("@/lib/insurance-rate");
  test("formula: listed + ceil5((quote - 350) x 12 / 52)", async () => {
    const r = await rate();
    expect(r.insuranceSurchargeWeekly(350)).toBe(0);
    expect(r.insuranceSurchargeWeekly(300)).toBe(0);
    expect(r.insuranceSurchargeWeekly(351)).toBe(5);     // $0.23 -> $5
    expect(r.insuranceSurchargeWeekly(371.66)).toBe(5);  // $4.998
    expect(r.insuranceSurchargeWeekly(371.67)).toBe(10); // $5.0008 -> $10
    expect(r.insuranceSurchargeWeekly(450)).toBe(25);    // $23.08
    expect(r.insuranceSurchargeWeekly(500)).toBe(35);    // $34.62
    expect(r.insuranceSurchargeWeekly(600)).toBe(60);    // $57.69
    expect(r.insuranceAdjustedRate(325, 450)).toEqual({ listed: 325, surcharge: 25, weekly: 350 });
    // Always covers the quote: surcharge x 52 / 12 >= quote - 350.
    for (let q = 351; q < 1000; q += 7.31) expect(r.insuranceSurchargeWeekly(q) * 52 / 12).toBeGreaterThanOrEqual(q - 350 - 1e-9);
  });
  test("switch off (default): a quote over $350 is refused with needs_staff and nothing changes", async () => {
    const db = fakeDb(seed());
    const r = await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: A, start_date: "2026-11-18", insurance_quote_monthly: 450 }), deps(db));
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j).toMatchObject({ needs_staff: true, would_offer: { listed_weekly: 350, insurance_surcharge_weekly: 25, weekly_rate: 375 } });
    expect(db.state.applications[0].vehicle_id).toBe(null);
  });
  test("a quote at or under $350 assigns at the listed rate either way", async () => {
    const db = fakeDb(seed());
    const j = await (await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: A, start_date: "2026-11-18", insurance_quote_monthly: 340 }), deps(db))).json();
    expect(j).toMatchObject({ weekly_rate: 350, insurance_surcharge_weekly: 0 });
  });
  test("switch on: assigns at the higher rate, the agreement prints it, and the quote text says so", async () => {
    const db = fakeDb(seed());
    audits.length = 0;
    const on = { enabled: true, includedMonthly: 350, maxAutoMonthly: 1000 };
    const r = await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: A, start_date: "2026-11-18", insurance_quote_monthly: 450 }), { ...deps(db), insurance: on });
    const j = await r.json();
    expect(r.status).toBe(201);
    expect(j).toMatchObject({ weekly_rate: 375, listed_weekly_rate: 350, insurance_surcharge_weekly: 25 });
    expect(db.state.applications[0].weekly_rent).toBe(375);
    expect(j.quote_text).toBe("Real Rentals: Your quote is ready: 2019 Ford Fusion at $375/week (includes $25/week for your insurance quote), no deposit, starting Wed, Nov 18 with pickup at 3500 E Hillsborough Ave, Tampa, FL 33610. Rent is paid weekly. Reply YES to accept and we'll send your rental agreement to sign. Reply STOP to opt out.");
    expect(audits[0].metadata).toMatchObject({ insurance_quote_monthly: 450, insurance_surcharge_weekly: 25, weekly_rate: 375 });
    // Over the ceiling still goes to staff.
    const db2 = fakeDb(seed());
    expect((await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: A, insurance_quote_monthly: 1200 }), { ...deps(db2), insurance: on })).status).toBe(409);
    // A later quote re-prices an assigned car, but not once an agreement is out.
    const re = await (await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: A, insurance_quote_monthly: 500 }), { ...deps(db), insurance: on, hasOpenOrSigned: async () => false })).json();
    expect(re).toMatchObject({ duplicate: true, rate_updated: true, weekly_rate: 385 });
    const locked = await asg.handleFleetAssignVehicle(req({ action: "assign", lead_id: A, insurance_quote_monthly: 600 }), { ...deps(db), insurance: on, hasOpenOrSigned: async () => true });
    expect(locked.status).toBe(409);
    expect(db.state.applications[0].weekly_rent).toBe(385);
  });
  test("quote text without a surcharge, and with the Reservation Fee line", async () => {
    const r = await rate();
    expect(r.fleetQuoteText({ vehicle: "2017 Ford Fusion", weekly: 325, surcharge: 0, deposit: 0, startDate: "2026-11-18", location: "3500 E Hillsborough Ave, Tampa, FL 33610", reservationFee: 50 }))
      .toBe("Real Rentals: Your quote is ready: 2017 Ford Fusion at $325/week, no deposit, starting Wed, Nov 18 with pickup at 3500 E Hillsborough Ave, Tampa, FL 33610. Rent is paid weekly. A $50 Reservation Fee is charged to your card on file when you sign and applied to your first week. Reply YES to accept and we'll send your rental agreement to sign. Reply STOP to opt out.");
  });
});

describe("proposed index (PGlite)", () => {
  test("one Approved applicant per car; Active and deleted do not count", async () => {
    const pg = new PGlite();
    await pg.exec(`CREATE TABLE public.applications (id serial primary key, vehicle_id uuid, status text, deleted_at timestamptz);`);
    const SQL = readFileSync("proposed/fleet-assign-vehicle-v1.sql", "utf8");
    await pg.exec(SQL);
    await pg.exec(SQL);
    await pg.query(`INSERT INTO applications (vehicle_id, status) VALUES ($1, 'approved')`, [V1]);
    await expect(pg.query(`INSERT INTO applications (vehicle_id, status) VALUES ($1, 'approved')`, [V1])).rejects.toThrow();
    await pg.query(`INSERT INTO applications (vehicle_id, status) VALUES ($1, 'active')`, [V1]);
    await pg.query(`INSERT INTO applications (vehicle_id, status, deleted_at) VALUES ($1, 'approved', now())`, [V1]);
    expect(SQL).toMatch(/PROPOSED, NOT APPLIED/);
  });
});
