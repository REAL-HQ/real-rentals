// Team alerts (Dolmar, t299s1618): GPS rules, overnight roadside, bot hand-offs.
// Network refused; fake database. All kinds OFF by default.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const ta = await import("@/lib/team-alerts");
const tas = await import("@/lib/team-alerts.server");
const gps = await import("@/lib/gps-alerts");
const gpss = await import("@/lib/gps-alerts.server");
const fta = await import("@/lib/fleet-team-alert.server");
const dia = await import("@/lib/driver-issue-alert.server");

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]> = {}, opts: { missing?: string[] } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q, insert: (r: Row) => { op = "insert"; payload = r; return q; }, update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; }, is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; }, limit: () => q, order: () => q,
      maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (opts.missing?.includes(table)) return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
      const rows = state[table];
      if (op === "insert") {
        if (table === "team_alert_sends" && rows.some((r) => r.key === payload.key)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        rows.push({ ...payload }); return { data: null, error: null };
      }
      const m = rows.filter((r) => f.every((x) => x(r)));
      if (op === "update") { for (const r of m) Object.assign(r, payload); return { data: null, error: null }; }
      return { data: single ? m[0] ?? null : m, error: null };
    }
    return q;
  }
  return { from, state };
}
const ALL_ON = { gps: true, roadside_overnight: true, late_pickup: true, bot_handoff: true };
function io() {
  const sms: any[] = []; const emails: any[] = [];
  return { sms, emails, sendSms: async (a: any) => { sms.push(a); return { ok: true }; }, sendEmail: async (a: any) => { emails.push(a); return { ok: true }; } };
}
const KEY = "k".repeat(40);
const req = (path: string, body: unknown) => new Request(`https://drivereal.com/api/public/fleet/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) });

describe("team alert switch and sending", () => {
  test("every kind is OFF with no row, a malformed row or a non-true value", () => {
    expect(ta.readTeamAlertSettings(null)).toEqual({ gps: false, roadside_overnight: false, late_pickup: false, bot_handoff: false });
    expect(ta.readTeamAlertSettings({ gps: true, roadside_overnight: { enabled: "true" } }).gps).toBe(false);
    expect(ta.readTeamAlertSettings({ gps: { enabled: true } }).gps).toBe(true);
  });
  test("off: nothing claimed or sent", async () => {
    const db = fakeDb(); const x = io();
    const out = await tas.sendTeamAlert(db, { kind: "gps", dedupeKey: "a", title: "t", lines: [] }, { ...x, settings: ta.readTeamAlertSettings(null) });
    expect(out.status).toBe("off");
    expect(x.sms.length + x.emails.length).toBe(0);
    expect(db.state.team_alert_sends ?? []).toEqual([]);
  });
  test("on: one email to the team, one text to the field rep only, once per key; phone numbers removed", async () => {
    const db = fakeDb(); const x = io();
    const afterHours = new Date("2026-01-06T00:00:00Z"); // Mon 7 PM EST, Rosa off
    const deps = { ...x, settings: ALL_ON, fieldRepNumbers: ["+10000000000"], now: () => afterHours };
    const a = { kind: "bot_handoff" as const, dedupeKey: "m1", title: "Complaint from renter at (813) 555-0101", lines: ["Call 813-555-0101 back"], link: "https://drivereal.com/admin" };
    expect((await tas.sendTeamAlert(db, a, deps)).status).toBe("sent");
    expect((await tas.sendTeamAlert(db, a, deps)).status).toBe("duplicate");
    expect(x.sms.map((s) => s.to)).toEqual(["+10000000000"]);
    expect(x.emails.map((e) => e.to)).toEqual(["team@drivereal.com"]);
    expect(JSON.stringify([x.sms, x.emails])).not.toMatch(/555[\s.-]?0101/);
    expect(x.sms[0].requireConsent).toBe(false);
  });

  test("during Rosa's hours a bot handoff texts the other company line", async () => {
    const db = fakeDb(); const x = io();
    const rosaHours = new Date("2026-01-05T19:00:00Z");
    const a = { kind: "bot_handoff" as const, dedupeKey: "m2", title: "Asked for a person", lines: ["Wants a call"], link: "https://drivereal.com/admin", activeLine: "PNrZULvFMn", handoffReason: "asked_for_person" };
    expect((await tas.sendTeamAlert(db, a, { ...x, settings: ALL_ON, fieldRepNumbers: ["+10000000000"], now: () => rosaHours })).status).toBe("sent");
    expect(x.sms[0]).toMatchObject({ to: "+18132124174", fromId: "PNrZULvFMn", requireConsent: false });
  });
  test("no table: nothing sent", async () => {
    const db = fakeDb({}, { missing: ["team_alert_sends"] }); const x = io();
    expect((await tas.sendTeamAlert(db, { kind: "gps", dedupeKey: "a", title: "t", lines: [] }, { ...x, settings: ALL_ON })).status).toBe("no_table");
    expect(x.sms.length).toBe(0);
  });
  test("alert code never reads a renter or applicant phone number", () => {
    for (const f of ["src/lib/team-alerts.ts", "src/lib/team-alerts.server.ts", "src/lib/gps-alerts.ts", "src/lib/gps-alerts.server.ts", "src/lib/fleet-team-alert.server.ts"]) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/\.phone\b|"phone"|,phone|phone,/);
      const numbers = s.match(/\+1\d{10}/g) ?? [];
      expect(numbers.every((n) => n === ta.FIELD_REP_ALERT_NUMBER)).toBe(true);
    }
  });
  test("overnight is 6 PM to 6 AM Eastern", () => {
    expect(ta.isOvernightEt(new Date("2026-11-16T23:00:00Z"))).toBe(true);  // 6:00 PM ET
    expect(ta.isOvernightEt(new Date("2026-11-16T22:59:00Z"))).toBe(false); // 5:59 PM ET
    expect(ta.isOvernightEt(new Date("2026-11-17T10:59:00Z"))).toBe(true);  // 5:59 AM ET
    expect(ta.isOvernightEt(new Date("2026-11-17T11:00:00Z"))).toBe(false); // 6:00 AM ET
  });
});

describe("GPS rules", () => {
  const car = (extra: Row = {}) => ({ id: "v9", license_plate: "CZO6DA", unit_number: "RR-009", gps_device_id: null, status: "rented", label: "RR-009 · 2014 Ford Fusion · CZO6DA", ...extra });
  const NOW = new Date("2026-11-16T13:00:00Z");
  test("tracker labels match plates even with letter O for zero; names in labels are ignored", () => {
    expect(gps.matchVehicle({ device: "CZ06DA - SOME RENTER" }, [car()])?.id).toBe("v9");
    expect(gps.matchVehicle({ device: "#1" }, [car()])).toBe(null);
    expect(gps.matchVehicle({ device: "8/26 #2" }, [car()])).toBe(null);
  });
  test("outside the service area: more than 100 miles from Tampa (t311u)", () => {
    expect(gps.GPS_RULES.maxMilesFromShop).toBe(100);
    expect(gps.GPS_RULES.offlineHours).toBe(24);
    expect(gps.evaluateGps({ address: "100 Main St, Valdosta, GA 31601" }, car(), NOW).map((f) => f.rule)).toContain("outside_area");
    expect(gps.evaluateGps({ address: "1 Davis Islands Brg, Tampa, FL 33606" }, car(), NOW).map((f) => f.rule)).not.toContain("outside_area");
    expect(gps.evaluateGps({ lat: 30.33, lng: -81.66 }, car(), NOW).map((f) => f.rule)).toContain("outside_area"); // Jacksonville ~170 mi
    expect(gps.evaluateGps({ lat: 29.65, lng: -82.32 }, car(), NOW).map((f) => f.rule)).toContain("outside_area"); // Gainesville ~115 mi, inside FL
    expect(gps.evaluateGps({ lat: 25.76, lng: -80.19 }, car(), NOW).map((f) => f.rule)).toContain("outside_area"); // Miami ~200 mi
    expect(gps.evaluateGps({ lat: 28.54, lng: -81.38 }, car(), NOW).map((f) => f.rule)).not.toContain("outside_area"); // Orlando ~75 mi
    expect(gps.evaluateGps({ lat: 27.34, lng: -82.53 }, car(), NOW).map((f) => f.rule)).not.toContain("outside_area"); // Sarasota ~45 mi
    const msg = gps.evaluateGps({ lat: 29.65, lng: -82.32, address: "Gainesville, FL 32601" }, car(), NOW)[0].message;
    expect(msg).toMatch(/outside the 100-mile service area around Tampa/);
  });
  test("offline: no report for 24 hours or the tracker says no power", () => {
    expect(gps.evaluateGps({ last_report_at: "2026-11-15T12:00:00Z" }, car(), NOW).map((f) => f.rule)).toContain("offline");
    expect(gps.evaluateGps({ last_report_at: "2026-11-16T12:00:00Z" }, car(), NOW).map((f) => f.rule)).not.toContain("offline");
    expect(gps.evaluateGps({ status_text: "No power 2 d 22 h" }, car(), NOW).map((f) => f.rule)).toEqual(["offline"]);
  });
  test("no movement for 48 hours, only for a car on rental", () => {
    expect(gps.evaluateGps({ stopped_since: "2026-11-14T12:00:00Z" }, car(), NOW).map((f) => f.rule)).toContain("no_movement");
    expect(gps.evaluateGps({ stopped_since: "2026-11-14T14:00:00Z" }, car(), NOW).map((f) => f.rule)).not.toContain("no_movement");
    expect(gps.evaluateGps({ stopped_since: "2026-11-05T12:00:00Z" }, car({ status: "available" }), NOW)).toEqual([]);
  });
  test("endpoint: dry run while off (no writes, no sends); live when on, once per car, rule and day", async () => {
    const seed = { vehicles: [{ id: "v9", license_plate: "CZO6DA", unit_number: "RR-009", status: "rented", year: 2014, make: "Ford", model: "Fusion", archived_at: null }] };
    const body = { readings: [{ device: "CZ06DA - SOME RENTER", stopped_since: "2026-11-13T12:00:00Z", address: "1 Davis Islands Brg, Tampa, FL 33606" }, { device: "#1", status_text: "No power" }] };
    const db = fakeDb(seed); const x = io();
    const off = await (await gpss.handleGpsReadings(req("gps-readings", body), { admin: db, env: { FLEET_API_KEY: KEY } as any, now: () => NOW, ...x, settings: ta.readTeamAlertSettings(null) })).json();
    expect(off).toMatchObject({ dry_run: true, matched: 1, unmatched: ["#1"] });
    expect(off.findings.map((f: any) => f.rule)).toEqual(["no_movement"]);
    expect(x.sms.length).toBe(0);
    expect(db.state.vehicles[0].gps_status).toBeUndefined();
    const on = await (await gpss.handleGpsReadings(req("gps-readings", body), { admin: db, env: { FLEET_API_KEY: KEY } as any, now: () => NOW, ...x, settings: ALL_ON })).json();
    expect(on.alerts.map((a: any) => a.status)).toEqual(["sent"]);
    await gpss.handleGpsReadings(req("gps-readings", body), { admin: db, env: { FLEET_API_KEY: KEY } as any, now: () => NOW, ...x, settings: ALL_ON });
    expect(x.sms.length).toBe(1);
    expect(JSON.stringify(db.state.vehicles[0])).not.toContain("SOME RENTER");
    expect(JSON.stringify(x)).not.toContain("SOME RENTER");
  });
});

describe("overnight roadside and bot hand-offs", () => {
  const night = new Date("2026-11-17T03:00:00Z"); // 10 PM ET
  const day = new Date("2026-11-16T17:00:00Z");   // noon ET
  test("a roadside request filed overnight alerts the team; daytime and non-roadside do not", async () => {
    const db = fakeDb(); const x = io();
    const issue = { issueId: "i1", title: "Breakdown on I-4", kind: "breakdown", severity: "urgent", rentalId: null, vehicleId: null };
    expect((await dia.alertOvernightRoadside(issue, day, { admin: db, ...x, settings: ALL_ON })).status).toBe("daytime");
    expect((await dia.alertOvernightRoadside({ ...issue, kind: "billing" }, night, { admin: db, ...x, settings: ALL_ON })).status).toBe("not_roadside");
    expect((await dia.alertOvernightRoadside(issue, night, { admin: db, ...x, settings: ALL_ON })).status).toBe("sent");
    expect((await dia.alertOvernightRoadside(issue, night, { admin: db, ...x, settings: ta.readTeamAlertSettings(null) })).status).toBe("off");
    expect(x.sms.map((s) => s.to)).toEqual(["+18134768508"]);
  });
  test("bot endpoint: overnight only for roadside; hand-off reasons; off by default", async () => {
    const db = fakeDb(); const x = io();
    const d = (now: Date, settings: any = ALL_ON) => ({ admin: db, env: { FLEET_API_KEY: KEY } as any, now: () => now, ...x, settings });
    expect((await fta.handleFleetTeamAlert(req("team-alert", { kind: "roadside_overnight", summary: "flat tire" }), d(day))).status).toBe(409);
    expect((await fta.handleFleetTeamAlert(req("team-alert", { kind: "roadside_overnight", summary: "flat tire", dedupe_key: "q1" }), d(night))).status).toBe(200);
    expect((await fta.handleFleetTeamAlert(req("team-alert", { kind: "bot_handoff", reason: "rude", summary: "x" }), d(day))).status).toBe(400);
    const h = await (await fta.handleFleetTeamAlert(req("team-alert", { kind: "bot_handoff", reason: "payment_dispute", summary: "says he was charged twice", dedupe_key: "q2" }), d(day))).json();
    expect(h.status).toBe("sent");
    const off = await (await fta.handleFleetTeamAlert(req("team-alert", { kind: "bot_handoff", reason: "injury", summary: "hurt", dedupe_key: "q3" }), d(day, ta.readTeamAlertSettings(null)))).json();
    expect(off.status).toBe("off");
    expect(x.sms.length).toBe(2);
  });
});

describe("proposed SQL (PGlite)", () => {
  test("team alerts table and settings: idempotent, every kind off", async () => {
    const pg = new PGlite();
    await pg.exec(`CREATE TABLE public.app_settings (key text primary key, value jsonb, updated_at timestamptz default now());`);
    const SQL = readFileSync("proposed/team-alerts-v1.sql", "utf8");
    await pg.exec(SQL); await pg.exec(SQL);
    const v = (await pg.query(`SELECT value FROM app_settings WHERE key='team_alerts'`)).rows[0] as any;
    expect(ta.readTeamAlertSettings(v.value)).toEqual({ gps: false, roadside_overnight: false, late_pickup: false, bot_handoff: false });
    await pg.query(`INSERT INTO team_alert_sends (key, kind) VALUES ('a','gps')`);
    await expect(pg.query(`INSERT INTO team_alert_sends (key, kind) VALUES ('a','gps')`)).rejects.toThrow();
    expect(SQL).toMatch(/PROPOSED, NOT APPLIED/);
  });
});
