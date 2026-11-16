// Pickup schedule, reservation_confirmed, staff alerts and FLEET booking.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const ps = await import("@/lib/pickup-schedule");
const rc = await import("@/lib/reservation-confirmation.server");
const fp = await import("@/lib/fleet-pickup.server");
const { writeReservationDetails } = await import("@/lib/reservations");

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>, opts: { missing?: string[] } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q, limit: () => q, order: () => q,
      insert: (r: Row) => { op = "insert"; payload = r; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      upsert: (r: Row) => { op = "upsert"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      gte: (c: string, v: any) => { f.push((r) => String(r[c]) >= String(v)); return q; },
      maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (opts.missing?.includes(table)) return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
      const rows = state[table];
      if (op === "insert") {
        if (table === "reservation_confirmations" && rows.some((r) => r.rental_id === payload.rental_id)) return { data: null, error: { code: "23505", message: "dup" } };
        rows.push({ ...payload }); return { data: [payload], error: null };
      }
      const hit = rows.filter((r) => f.every((x) => x(r)));
      if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
      return { data: single ? hit[0] ?? null : hit, error: null };
    }
    return q;
  }
  return { from, state };
}

const A = "11111111-1111-4111-8111-111111111111";
const R = "22222222-2222-4222-8222-222222222222";
const V = "44444444-4444-4444-8444-444444444444";
const NOTE = (t = "09:30") => writeReservationDetails({ pickupTime: t, pickupLocation: "123 Main St, Tampa, FL" });
const S = ps.DEFAULT_PICKUP_SCHEDULE;

describe("schedule defaults and settings", () => {
  test("Mon-Fri 9:30/10:30/11:30 ET, 60 min, field rep Dolmar Cross, alerts Off, field-rep text only to his cell", () => {
    expect(S.days).toEqual([1, 2, 3, 4, 5]);
    expect(S.startTimes).toEqual(["09:30", "10:30", "11:30"]);
    // Last pickup ends at 12:30.
    expect(ps.toMinutes(S.startTimes[S.startTimes.length - 1]) + S.slotMinutes).toBe(12 * 60 + 30);
    expect(S.blockedDates).toEqual([]);
    expect(S.slotMinutes).toBe(60);
    expect(S.timezone).toBe("America/New_York");
    expect(S.fieldRep.name).toBe("Dolmar Cross");
    expect(S.defaultLocation).toBe("3500 E Hillsborough Ave, Tampa, FL 33610");
    expect(S.notify.enabled).toBe(false);
    expect(S.notify.sms).toEqual(["+18134768508"]);
    expect(S.notify.emails).toEqual(["DolmarCross@gmail.com", "Team@DriveReal.com"]);
    expect(ps.readPickupSchedule(null)).toEqual(S);
    expect(ps.readPickupSchedule({ days: "bad" })).toEqual(S);
  });
  test("validation", () => {
    expect(ps.validatePickupSchedule({ ...S, startTimes: ["09:00", "09:30"] }).ok).toBe(false);
    expect(ps.validatePickupSchedule({ ...S, days: [] }).ok).toBe(false);
    expect(ps.validatePickupSchedule({ ...S, notify: { ...S.notify, sms: ["12"] } }).ok).toBe(false);
    expect(ps.validatePickupSchedule({ ...S, notify: { ...S.notify, enabled: true, sms: [], emails: [] } }).ok).toBe(false);
    const ok = ps.validatePickupSchedule({ ...S, startTimes: ["13:00", "09:00"], slotMinutes: 90, notify: { ...S.notify, sms: ["(813) 476-8508"] } });
    expect(ok.ok && ok.value.startTimes).toEqual(["09:00", "13:00"]);
    expect(ok.ok && ok.value.notify.sms).toEqual(["+18134768508"]);
  });
});

describe("holidays and blocked dates", () => {
  const dayHasSlots = (date: string, s = S) => {
    // Midnight Eastern the day before, so notice never hides the day.
    const now = new Date(`${date}T05:00:00Z`);
    now.setUTCDate(now.getUTCDate() - 1);
    return ps.openPickupSlots(s, now, new Set(), { days: 3, limit: 50 }).some((x) => x.date === date);
  };
  test("Thanksgiving, Christmas Eve, Christmas, New Year's Eve and New Year's Day have no slots; the day after Thanksgiving does", () => {
    for (const d of ["2026-11-26", "2026-12-24", "2026-12-25", "2026-12-31", "2027-01-01"]) expect([d, dayHasSlots(d)]).toEqual([d, false]);
    expect(dayHasSlots("2026-11-27")).toBe(true);
    expect(dayHasSlots("2026-11-25")).toBe(true);
    expect(ps.blockedDateReason(S, "2026-11-27")).toBeNull();
    expect(ps.blockedDateReason(S, "2026-11-26")).toBe("Thanksgiving");
    expect(ps.blockedDateReason(S, "2026-12-24")).toBe("Christmas Eve");
    expect(ps.blockedDateReason(S, "2026-12-31")).toBe("New Year's Eve");
  });
  test("all federal holidays, with weekend ones observed on the nearest weekday", () => {
    const h = ps.builtInHolidays(2027);
    expect([...h.keys()].sort()).toEqual([
      "2027-01-01", "2027-01-18", "2027-02-15", "2027-05-31", "2027-06-18", "2027-06-19", "2027-07-04", "2027-07-05",
      "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-24", "2027-12-25", "2027-12-31",
    ]);
    const h26 = ps.builtInHolidays(2026);
    expect(h26.get("2026-01-19")).toBe("Martin Luther King Jr. Day");
    expect(h26.get("2026-02-16")).toBe("Presidents Day");
    expect(h26.get("2026-05-25")).toBe("Memorial Day");
    expect(h26.get("2026-06-19")).toBe("Juneteenth");
    expect(h26.get("2026-07-03")).toBe("Independence Day (Observed)");
    expect(h26.get("2026-09-07")).toBe("Labor Day");
    expect(h26.get("2026-10-12")).toBe("Columbus Day / Indigenous Peoples' Day");
    expect(h26.get("2026-11-11")).toBe("Veterans Day");
    expect(h26.has("2026-11-27")).toBe(false);
  });
  test("blockedDates setting: validated, sorted, and closes those days", () => {
    const r = ps.validatePickupSchedule({ ...S, blockedDates: ["2026-12-01", "2026-11-30", "2026-11-30"] });
    expect(r.ok && r.value.blockedDates).toEqual(["2026-11-30", "2026-12-01"]);
    expect(ps.validatePickupSchedule({ ...S, blockedDates: ["2026-02-30"] }).ok).toBe(false);
    expect(ps.validatePickupSchedule({ ...S, blockedDates: "2026-12-01" }).ok).toBe(false);
    const s = r.ok ? r.value : S;
    expect(dayHasSlots("2026-11-30", s)).toBe(false);
    expect(dayHasSlots("2026-11-30")).toBe(true);
    expect(ps.blockedDateReason(s, "2026-12-01")).toBe("Blocked");
    expect(ps.readPickupSchedule({ ...S, blockedDates: undefined }).blockedDates).toEqual([]);
    expect(ps.upcomingBlockedDates(S, "2026-11-20", 15)).toEqual([{ date: "2026-11-26", reason: "Thanksgiving" }]);
  });
});

describe("open slots", () => {
  test("earliest first, weekdays only, booked and too-soon slots skipped, Eastern offsets", () => {
    // Sun 2026-11-15 10:00 ET
    const slots = ps.openPickupSlots(S, new Date("2026-11-15T15:00:00Z"), new Set(["2026-11-16 09:30"]), { limit: 6 });
    expect(slots.map((s) => `${s.date} ${s.time}`)).toEqual(["2026-11-16 10:30", "2026-11-16 11:30", "2026-11-17 09:30", "2026-11-17 10:30", "2026-11-17 11:30", "2026-11-18 09:30"]);
    expect(slots[0]).toMatchObject({ start_at: "2026-11-16T10:30:00-05:00", end_at: "2026-11-16T11:30:00-05:00", label: "Mon 11/16 10:30 AM ET" });
    // Mon 08:00 ET with 120 min notice: 9:00 is too soon.
    const mon = ps.openPickupSlots(S, new Date("2026-11-16T13:00:00Z"), new Set(), { limit: 1 });
    expect(mon[0].time).toBe("10:30");
    expect(ps.slotIso("2026-07-01", "09:00")).toBe("2026-07-01T09:00:00-04:00");
    expect(ps.parseSlotStart("2026-11-18T14:00:00Z")).toEqual({ date: "2026-11-18", time: "09:00" });
    expect(ps.isScheduledSlot(S, "2026-11-21", "09:30")).toBe(false);
  });
});

describe("fully confirmed", () => {
  const base = { rentalStatus: "reserved", applicationStatus: "approved", pickupDate: "2026-11-18", pickupTime: "09:30", pickupLocation: "x", depositStatus: "not_required", signedAgreement: true, requireSignedAgreement: true };
  test("rule", () => {
    expect(ps.confirmationGaps(base)).toEqual([]);
    expect(ps.confirmationGaps({ ...base, signedAgreement: false })).toEqual(["agreement_not_signed"]);
    expect(ps.confirmationGaps({ ...base, signedAgreement: false, requireSignedAgreement: false })).toEqual([]);
    expect(ps.confirmationGaps({ ...base, depositStatus: "pending" })).toEqual(["deposit_not_paid"]);
    expect(ps.confirmationGaps({ ...base, applicationStatus: "reviewing", rentalStatus: "cancelled", pickupTime: null })).toEqual(["not_reserved", "not_approved", "no_pickup_time"]);
  });

  const seed = (signed = true) => ({
    rentals: [{ id: R, status: "reserved", application_id: A, vehicle_id: V, start_date: "2026-11-18", reservation_note: NOTE(), reservation_deposit_required: false, reservation_deposit_status: "not_required" }],
    applications: [{ id: A, full_name: "Test Renter", status: "approved" }],
    vehicles: [{ id: V, year: 2021, make: "Toyota", model: "Camry", license_plate: "ABC123", unit_number: "7" }],
    agreements: signed ? [{ id: "ag1", application_id: A, status: "signed", signed_at: "2026-11-16T15:00:00Z", voided_at: null, rental_id: null }] : [],
    reservation_confirmations: [],
  });
  function io(settings = S) {
    const sms: any[] = []; const emails: any[] = []; const queued: any[] = [];
    return { sms, emails, queued, deps: { settings, sendSms: async (a: any) => { sms.push(a); return { ok: true }; }, sendEmail: async (a: any) => { emails.push(a); return { ok: true }; }, enqueue: async (_: any, row: any) => { queued.push(row); return "wh1"; }, dispatch: async () => {} } };
  }

  test("not confirmed until the agreement is signed: no event, no alert", async () => {
    const t = io();
    const r = await rc.maybeConfirmReservation(fakeDb(seed(false)), { applicationId: A }, t.deps);
    expect(r).toMatchObject({ confirmed: false, gaps: ["agreement_not_signed"] });
    expect(t.queued).toHaveLength(0);
  });
  test("confirmed with alerts Off: event queued, recorded as off, nothing sent", async () => {
    const t = io();
    const db = fakeDb(seed());
    const r: any = await rc.maybeConfirmReservation(db, { rentalId: R }, t.deps);
    expect(r).toMatchObject({ confirmed: true, notice: "off" });
    expect(t.queued[0]).toMatchObject({ event_type: "reservation_confirmed", dedupe_key: `reservation_confirmed:${R}`, application_id: A });
    expect(t.queued[0].payload).toMatchObject({ renter_name: "Test Renter", vehicle: { label: "2021 Toyota Camry" }, pickup: { start_at: "2026-11-18T09:30:00-05:00", location: "123 Main St, Tampa, FL" }, field_rep: { name: "Dolmar Cross" } });
    expect(t.queued[0].payload.admin_url).toContain(`/admin?tab=drivers&id=${A}`);
    expect(t.sms).toHaveLength(0);
    expect(t.emails).toHaveLength(0);
    expect(db.state.reservation_confirmations[0].notice_status).toBe("off");
  });
  test("alerts On: one text to +18134768508 from the main line, one email to both inboxes, once", async () => {
    const t = io({ ...S, notify: { ...S.notify, enabled: true } });
    const db = fakeDb(seed());
    const r: any = await rc.maybeConfirmReservation(db, { rentalId: R }, t.deps);
    expect(r.notice).toBe("sent");
    expect(t.sms.map((s) => s.to)).toEqual(["+18134768508"]);
    expect(t.sms[0]).toMatchObject({ requireConsent: false, kind: "reservation_confirmed_staff" });
    expect(t.sms[0].fromId).toBeUndefined();
    expect(t.sms[0].body).toContain("Test Renter");
    expect(t.sms[0].body).toContain("2021 Toyota Camry");
    expect(t.sms[0].body).toContain("Wed 11/18 9:30 AM ET");
    expect(t.emails[0].to).toEqual(["DolmarCross@gmail.com", "Team@DriveReal.com"]);
    expect(t.emails[0].html).toContain("Open In Admin");
    const again: any = await rc.maybeConfirmReservation(db, { rentalId: R }, t.deps);
    expect(again.notice).toBe("already");
    expect(t.sms).toHaveLength(1);
    expect(t.emails).toHaveLength(1);
  });
  test("no reservation_confirmations table: no alert", async () => {
    const t = io({ ...S, notify: { ...S.notify, enabled: true } });
    const r: any = await rc.maybeConfirmReservation(fakeDb(seed(), { missing: ["reservation_confirmations"] }), { rentalId: R }, t.deps);
    expect(r.notice).toBe("no_table");
    expect(t.sms).toHaveLength(0);
  });
});

describe("FLEET pickup-slots endpoint", () => {
  const KEY = "k".repeat(40);
  const NOW = new Date("2026-11-15T15:00:00Z");
  const settings = { ...S, defaultLocation: "123 Main St, Tampa, FL" };
  async function call(db: any, body: Row, reserve?: any) {
    const calls: any[] = []; const audits: any[] = [];
    const res = await fp.handleFleetPickupSlots(new Request("https://drivereal.com/api/public/fleet/pickup-slots", { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) }), {
      admin: db, env: { FLEET_API_KEY: KEY }, now: () => NOW, settings, audit: async (e) => { audits.push(e); },
      reserve: reserve ?? (async (_a: any, d: any) => { calls.push(d); return { id: "new-rental", loginEmail: "off" }; }),
    });
    return { status: res.status, body: await res.json(), calls, audits };
  }
  const seed = (status = "approved") => ({ applications: [{ id: A, status, full_name: "T", vehicle_id: V, deleted_at: null }], rentals: [{ id: "x", status: "reserved", application_id: "other", vehicle_id: "v2", start_date: "2026-11-16", reservation_note: NOTE("09:30") }] });

  test("list: earliest open slots with the schedule", async () => {
    const r = await call(fakeDb(seed()), { action: "list", limit: 2 });
    expect(r.status).toBe(200);
    expect(r.body.slots.map((s: any) => s.start_at)).toEqual(["2026-11-16T10:30:00-05:00", "2026-11-16T11:30:00-05:00"]);
    expect(r.body.schedule).toMatchObject({ timezone: "America/New_York", field_rep: { name: "Dolmar Cross" }, start_times: ["09:30", "10:30", "11:30"], holidays_blocked: true });
  });
  test("list skips Thanksgiving", async () => {
    const r = await call(fakeDb(seed()), { action: "list", days: 14, limit: 200 });
    const dates = new Set(r.body.slots.map((s: any) => s.date));
    expect(dates.has("2026-11-26")).toBe(false);
    expect(dates.has("2026-11-27")).toBe(true);
  });
  test("book: through the staff Reserved core with the default location; audited", async () => {
    const r = await call(fakeDb(seed()), { action: "book", lead_id: A, start_at: "2026-11-17T09:30:00-05:00" });
    expect(r.status).toBe(201);
    expect(r.calls[0]).toEqual({ applicationId: A, vehicleId: V, pickupDate: "2026-11-17", pickupTime: "09:30", pickupLocation: "123 Main St, Tampa, FL", note: undefined, requireReservationFee: true });
    expect(r.audits[0]).toMatchObject({ action: "reservation.fleet_booked", entityId: "new-rental" });
  });
  test("book refusals: not approved, off schedule, taken, missing auth", async () => {
    expect((await call(fakeDb(seed("reviewing")), { action: "book", lead_id: A, start_at: "2026-11-17T09:30:00-05:00" })).status).toBe(409);
    expect((await call(fakeDb(seed()), { action: "book", lead_id: A, start_at: "2026-11-17T14:00:00-05:00" })).body.error).toContain("not a pickup slot");
    const taken = await call(fakeDb(seed()), { action: "book", lead_id: A, start_at: "2026-11-16T09:30:00-05:00" });
    expect(taken.status).toBe(409);
    expect(taken.body.next_open[0].time).toBe("10:30");
    expect(taken.calls).toHaveLength(0);
    // Thanksgiving (built-in holiday): 409 with the next open slots, nothing booked.
    const holiday = await call(fakeDb(seed()), { action: "book", lead_id: A, start_at: "2026-11-26T09:30:00-05:00" });
    expect(holiday.status).toBe(409);
    expect(holiday.body.error).toContain("Thanksgiving");
    expect(holiday.body.next_open.length).toBeGreaterThan(0);
    expect(holiday.calls).toHaveLength(0);
    const res = await fp.handleFleetPickupSlots(new Request("https://x/api/public/fleet/pickup-slots", { method: "POST", body: "{}" }), { env: { FLEET_API_KEY: KEY } });
    expect(res.status).toBe(401);
  });
  test("book repeat is a duplicate, not a second booking", async () => {
    const db = fakeDb({ ...seed(), rentals: [{ id: "mine", status: "reserved", application_id: A, vehicle_id: V, start_date: "2026-11-17", reservation_note: NOTE("09:30") }] });
    const r = await call(db, { action: "book", lead_id: A, start_at: "2026-11-17T09:30:00-05:00" });
    expect(r.body).toMatchObject({ ok: true, duplicate: true, rental_id: "mine" });
    expect(r.calls).toHaveLength(0);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  test("routes, hooks, settings and dialog", () => {
    expect(read("src/routeTree.gen.ts")).toContain("/api/public/fleet/pickup-slots");
    expect(read("src/routes/api/public/fleet/pickup-slots.ts")).not.toMatch(/GET:/);
    const res = read("src/lib/reservations.functions.ts");
    expect(res).toContain("export async function createReservationCore");
    expect(res).toContain("That Pickup Slot Is Already Booked.");
    expect(res.match(/maybeConfirmReservation/g)?.length).toBeGreaterThanOrEqual(2);
    expect(read("src/lib/esign.server.ts")).toContain("maybeConfirmReservation");
    expect(read("src/routes/api/public/cron/fleet-webhooks.ts")).toContain("sweepReservationConfirmations");
    expect(read("src/lib/fleet-webhook.server.ts")).toContain('"reservation_confirmed"');
    expect(read("src/components/admin/SettingsWorkspace.tsx")).toContain("<PickupScheduleSettingsPanel />");
    expect(read("src/components/admin/ReserveCarDialog.tsx")).toContain("listPickupSlots");
  });
  test("the only phone number in the pickup/notification code is the field rep's", () => {
    for (const f of ["src/lib/pickup-schedule.ts", "src/lib/reservation-confirmation.server.ts", "src/lib/fleet-pickup.server.ts", "src/lib/pickup-schedule.functions.ts", "src/components/admin/PickupScheduleSettingsPanel.tsx", "docs/fleet-pickup-schedule.md", "proposed/pickup-schedule-v1.sql", "proposed/pickup-schedule-alerts-on.sql"]) {
      const phones = (read(f).match(/\+?1?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}/g) ?? []).map((p) => p.replace(/\D/g, "").slice(-10));
      for (const p of phones) expect(p).toBe("8134768508");
    }
  });
});

describe("proposed migration (PGlite)", () => {
  const SQL = readFileSync("proposed/pickup-schedule-v1.sql", "utf8");
  test("one reserved booking per slot; cancelled and plain notes unaffected; event allowed; re-runnable", async () => {
    const pg = new PGlite();
    await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA private;
      CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE TABLE public.rentals (id uuid primary key default gen_random_uuid(), status text, start_date date, reservation_note text);
      CREATE TABLE public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
      CREATE TABLE public.fleet_webhook_deliveries (id uuid primary key default gen_random_uuid(), event_type text,
        CONSTRAINT fleet_webhook_deliveries_event_type_check CHECK (event_type IN ('lead_created')));`);
    await pg.exec(SQL);
    const ins = (status: string, note: string, date = "2026-11-18") => pg.query(`INSERT INTO rentals (status, start_date, reservation_note) VALUES ($1, $2, $3) RETURNING id`, [status, date, note]);
    const first = await ins("reserved", NOTE("09:30"));
    await expect(ins("reserved", NOTE("09:30"))).rejects.toThrow(/rentals_one_reserved_per_pickup_slot/);
    await ins("reserved", NOTE("10:30"));
    await ins("reserved", NOTE("09:30"), "2026-11-19");
    await ins("cancelled", NOTE("09:30"));
    await ins("reserved", "plain staff note");
    await ins("reserved", "plain staff note");
    await pg.query(`UPDATE rentals SET status = 'cancelled' WHERE id = $1`, [(first.rows[0] as any).id]);
    await ins("reserved", NOTE("09:30"));
    await pg.query(`INSERT INTO fleet_webhook_deliveries (event_type) VALUES ('reservation_confirmed')`);
    await pg.query(`INSERT INTO reservation_confirmations (rental_id, notice_status) VALUES ($1, 'off')`, [(first.rows[0] as any).id]);
    await expect(pg.query(`INSERT INTO reservation_confirmations (rental_id, notice_status) VALUES ($1, 'off')`, [(first.rows[0] as any).id])).rejects.toThrow();
    await pg.exec(SQL);
    expect(SQL).toMatch(/PROPOSED, NOT APPLIED/);
    // Seeded value reads back as exactly the code defaults (alerts Off).
    const seeded = (await pg.query<any>(`SELECT value FROM app_settings WHERE key = 'pickup_schedule'`)).rows[0].value;
    expect(ps.readPickupSchedule(seeded)).toEqual(S);
    expect(seeded).toEqual(S);
    // Alerts-on file flips only notify.enabled, keeps edits, and is re-runnable.
    await pg.query(`UPDATE app_settings SET value = jsonb_set(value, '{fieldRep,name}', '"Someone Else"') WHERE key = 'pickup_schedule'`);
    const ON = readFileSync("proposed/pickup-schedule-alerts-on.sql", "utf8");
    await pg.exec(ON);
    await pg.exec(ON);
    const on = ps.readPickupSchedule((await pg.query<any>(`SELECT value FROM app_settings WHERE key = 'pickup_schedule'`)).rows[0].value);
    expect(on.notify).toEqual({ ...S.notify, enabled: true });
    expect(on.fieldRep.name).toBe("Someone Else");
    // With no saved row, the alerts-on file inserts the full defaults with alerts On.
    await pg.query(`DELETE FROM app_settings`);
    await pg.exec(ON);
    expect(ps.readPickupSchedule((await pg.query<any>(`SELECT value FROM app_settings`)).rows[0].value)).toEqual({ ...S, notify: { ...S.notify, enabled: true } });
  });
  test("fleet tweaks SQL: start times to 09:30/10:30/11:30, blockedDates added, every other field kept", async () => {
    const pg = new PGlite();
    await pg.exec(`CREATE TABLE app_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz)`);
    const live = { ...S, startTimes: ["09:00", "10:00", "11:00"], fieldRep: { name: "Someone Else" }, notify: { ...S.notify, enabled: true } } as Record<string, unknown>;
    delete live.blockedDates;
    await pg.query(`INSERT INTO app_settings (key, value) VALUES ('pickup_schedule', $1::jsonb)`, [JSON.stringify(live)]);
    const TWEAK = readFileSync("proposed/fleet-tweaks-2026-11-15.sql", "utf8");
    await pg.exec(TWEAK);
    await pg.exec(TWEAK);
    const raw = (await pg.query<any>(`SELECT value FROM app_settings WHERE key = 'pickup_schedule'`)).rows[0].value;
    expect(raw).toEqual({ ...live, startTimes: ["09:30", "10:30", "11:30"], blockedDates: [] });
    expect(ps.readPickupSchedule(raw).notify.enabled).toBe(true);
  });
});
