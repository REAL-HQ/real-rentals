// Confirm Terms saves what it collects (Rosa, Jonathon Boykins, Nov 18 2026).
// The dialog used to compare the typed weekly rate, start date, deposit and
// vehicle against an applicant record nobody had filled in, so it refused with
// "Fix First: Driver licence number, Vehicle assignment, Weekly rate, Vehicle
// license plate, Payment schedule, Balance due at pickup" for values that were
// on screen. Network refused; fake database.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const st = await import("@/lib/staff-terms");
const sts = await import("@/lib/staff-terms.server");

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false; let lim = Infinity;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q,
      insert: (r: Row) => { op = "insert"; payload = r; return q; },
      upsert: (r: Row) => { op = "insert"; payload = r; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      order: () => q, limit: (k: number) => { lim = k; return q; },
      maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = state[table];
      if (op === "insert") {
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
const V = "44444444-4444-4444-8444-444444444444";
const V2 = "55555555-5555-4555-8555-555555555555";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ROSA = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-11-18T18:05:00Z");
const actor = { userId: ROSA, email: "rosa@drivereal.com", role: "team", tier: "manager" };
const terms = (x: Row = {}) => ({ weekly_rate: "350.00", reservation_fee: "50", deposit: "0", start_date: "2026-11-18", vehicle_id: V, ...x });

// What Jonathon's record looked like: approved, licence state/expiry read by
// FLEET from the photo, but no licence number, vehicle, rate, deposit or dates.
const jonathon = (extra: Row = {}) => ({
  applications: [{ id: A, status: "approved", full_name: "Synthetic Applicant", email: "s@example.com", deleted_at: null, contacted_at: "2026-11-17T15:00:00Z",
    vehicle_id: null, weekly_rent: null, deposit_amount: null, contract_start_date: null, contract_end_date: null, license_number: null, license_state: "FL", license_expiration: "2027-07-06", ...extra }],
  vehicles: [{ id: V, archived_at: null, license_plate: "SYN001", weekly_rate: 350 }, { id: V2, archived_at: "2026-11-01T00:00:00Z" }],
  rentals: [] as Row[], staff_terms_confirmations: [] as Row[], fleet_webhook_deliveries: [] as Row[],
});

/** A stand-in for agreementSendCheck that reads the record the way the real one does. */
const recordCheck = async (admin: any, id: string) => {
  const { data: app } = await admin.from("applications").select("*").eq("id", id).maybeSingle();
  const { data: v } = app?.vehicle_id ? await admin.from("vehicles").select("*").eq("id", app.vehicle_id).maybeSingle() : { data: null };
  const blockers: { field: string; label: string; why: string }[] = [];
  if (!String(app.license_number ?? "").trim()) blockers.push({ field: "license_number", label: "Driver licence number", why: "" });
  if (!v) blockers.push({ field: "vehicle", label: "Vehicle assignment", why: "" });
  const weekly = app.weekly_rent ?? v?.weekly_rate ?? null;
  if (!(Number(weekly) > 0)) blockers.push({ field: "weekly_rate", label: "Weekly rate", why: "" });
  if (!v?.license_plate) blockers.push({ field: "license_plate", label: "Vehicle license plate", why: "" });
  if (!(Number(weekly) > 0)) {
    blockers.push({ field: "payment_amount", label: "Payment schedule (Weekly or Every 4 Weeks)", why: "" });
    blockers.push({ field: "balance_due", label: "Balance due at pickup", why: "" });
  }
  return { blockers, weeklyRate: weekly == null ? null : Number(weekly), reservationFee: 50, deposit: app.deposit_amount == null ? null : Number(app.deposit_amount), startDate: app.contract_start_date ?? null, vehicleId: app.vehicle_id ?? null, vehicleLabel: v ? "2013 Ford Fusion" : null };
};

function deps(extra: Row = {}) {
  const audits: any[] = []; const enq: any[] = [];
  return {
    audits, enq,
    deps: {
      now: () => NOW, check: recordCheck, hasOpenOrSigned: async () => false, resolveName: async () => "Rosa DeJesus",
      enqueue: async (admin: any, row: any) => { enq.push(row); const r = await admin.from("fleet_webhook_deliveries").insert({ ...row, status: "pending" }).select("id"); return r.data?.[0]?.id ?? null; },
      dispatch: async (admin: any, ids: string[]) => { for (const id of ids) await admin.from("fleet_webhook_deliveries").update({ status: "delivered", delivered_at: NOW.toISOString() }).eq("id", id); },
      audit: async (a: any, e: any) => { audits.push({ actor: a, ...e }); },
      ...extra,
    } as any,
  };
}

describe("Confirm Terms saves the terms it collects, then checks", () => {
  test("Jonathon's case: the typed rate, start, deposit, vehicle and licence land on the record and Move Forward goes through", async () => {
    const db = fakeDb(jonathon()); const h = deps();
    const r = await sts.confirmStaffTerms(db, { applicationId: A, terms: terms(), actor, licenseNumber: "b252-431-75-246-0" }, h.deps);
    expect(r.ok).toBe(true);
    const app = db.state.applications[0];
    expect(app).toMatchObject({ vehicle_id: V, weekly_rent: 350, deposit_amount: 0, contract_start_date: "2026-11-18", contract_end_date: "2026-12-16", license_number: "B252-431-75-246-0" });
    expect(db.state.staff_terms_confirmations).toHaveLength(1);
    expect(h.enq).toHaveLength(1);
    expect(r.ok && r.saved).toMatchObject({ vehicle_id: V, weekly_rent: 350 });
    const saveAudit = h.audits.find((a) => a.action === "application.terms_saved_by_staff");
    expect(saveAudit.metadata.fields).toContain("license_number");
    expect(JSON.stringify(h.audits)).not.toContain("B252"); // never the number itself
  });
  test("without a licence number it saves the rest and says only the licence is still needed; nothing goes to FLEET", async () => {
    const db = fakeDb(jonathon()); const h = deps();
    const r = await sts.confirmStaffTerms(db, { applicationId: A, terms: terms(), actor }, h.deps);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("Saved. Still Needed Before The Agreement Can Send: Driver licence number.");
      expect(r.blockers?.map((b) => b.field)).toEqual(["license_number"]);
      expect(r.saved).toMatchObject({ vehicle_id: V, weekly_rent: 350, contract_start_date: "2026-11-18" });
    }
    expect(db.state.applications[0].vehicle_id).toBe(V);
    expect(db.state.staff_terms_confirmations).toHaveLength(0);
    expect(h.enq).toHaveLength(0);
  });
  test("a licence number on file is never overwritten from the dialog", async () => {
    const db = fakeDb(jonathon({ license_number: "ONFILE123" })); const h = deps();
    const r = await sts.confirmStaffTerms(db, { applicationId: A, terms: terms(), actor, licenseNumber: "DIFFERENT99" }, h.deps);
    expect(r.ok).toBe(true);
    expect(db.state.applications[0].license_number).toBe("ONFILE123");
  });
  test("a valid scheduled end is kept; one that no longer fits the new start becomes start + 4 weeks", async () => {
    let db = fakeDb(jonathon({ license_number: "X1234", contract_end_date: "2027-01-31" }));
    await sts.confirmStaffTerms(db, { applicationId: A, terms: terms(), actor }, deps().deps);
    expect(db.state.applications[0].contract_end_date).toBe("2027-01-31");
    db = fakeDb(jonathon({ license_number: "X1234", contract_end_date: "2026-11-25" }));
    await sts.confirmStaffTerms(db, { applicationId: A, terms: terms(), actor }, deps().deps);
    expect(db.state.applications[0].contract_end_date).toBe("2026-12-16");
  });
  test("an archived car, or one on another driver's active rental, is refused and nothing is saved", async () => {
    let db = fakeDb(jonathon()); let h = deps();
    let r = await sts.confirmStaffTerms(db, { applicationId: A, terms: terms({ vehicle_id: V2 }), actor }, h.deps);
    expect(r.ok).toBe(false);
    expect((r as any).error).toContain("Not In The Fleet");
    expect(db.state.applications[0].vehicle_id).toBeNull();
    const seed = jonathon(); seed.rentals.push({ id: "r1", vehicle_id: V, status: "active", application_id: OTHER });
    db = fakeDb(seed); h = deps();
    r = await sts.confirmStaffTerms(db, { applicationId: A, terms: terms(), actor, licenseNumber: "X1234" }, h.deps);
    expect(r.ok).toBe(false);
    expect((r as any).error).toContain("Another Driver's Active Rental");
    expect(db.state.applications[0]).toMatchObject({ vehicle_id: null, weekly_rent: null, license_number: null });
    expect(h.audits).toHaveLength(0);
  });
  test("unchanged values write nothing and log nothing", async () => {
    const db = fakeDb(jonathon({ license_number: "X1234", vehicle_id: V, weekly_rent: "350", deposit_amount: "0", contract_start_date: "2026-11-18", contract_end_date: "2026-12-16" }));
    const h = deps();
    const r = await sts.confirmStaffTerms(db, { applicationId: A, terms: terms(), actor }, h.deps);
    expect(r.ok).toBe(true);
    expect(r.ok && r.saved).toEqual({});
    expect(h.audits.some((a) => a.action === "application.terms_saved_by_staff")).toBe(false);
  });
  test("an open or signed agreement still refuses before anything is saved", async () => {
    const db = fakeDb(jonathon()); const h = deps({ hasOpenOrSigned: async () => true });
    const r = await sts.confirmStaffTerms(db, { applicationId: A, terms: terms(), actor }, h.deps);
    expect(r.ok).toBe(false);
    expect(db.state.applications[0].vehicle_id).toBeNull();
  });
});

describe("Confirm Terms dialog: Fix First lists only what it does not collect", () => {
  const rosas = [
    { field: "license_number", label: "Driver licence number" },
    { field: "vehicle", label: "Vehicle assignment" },
    { field: "weekly_rate", label: "Weekly rate" },
    { field: "license_plate", label: "Vehicle license plate" },
    { field: "payment_amount", label: "Payment schedule (Weekly or Every 4 Weeks)" },
    { field: "balance_due", label: "Balance due at pickup" },
  ];
  const filled = { weekly: "350.00", start: "2026-11-18", deposit: "0", vehicleId: V, vehiclePlate: "XLK331", recordVehicleId: null };
  test("Rosa's exact dialog: with the fields filled only the licence number is left, and typing it clears that too", () => {
    expect(st.dialogOutstandingBlockers(rosas, filled).map((b) => b.field)).toEqual(["license_number"]);
    expect(st.dialogOutstandingBlockers(rosas, { ...filled, licenseNumber: "B252" })).toEqual([]);
  });
  test("empty dialog fields still list their blockers; a car with no plate still lists the plate", () => {
    expect(st.dialogOutstandingBlockers(rosas, { weekly: "", start: "", deposit: "", vehicleId: "" }).map((b) => b.field)).toEqual(rosas.map((b) => b.field));
    expect(st.dialogOutstandingBlockers(rosas, { ...filled, vehiclePlate: "" }).map((b) => b.field)).toEqual(["license_number", "license_plate"]);
  });
  test("things the dialog does not collect stay listed", () => {
    const other = [{ field: "driver_address", label: "Driver address" }, { field: "license_expiration", label: "Licence expiry date" }, { field: "template", label: "Approved agreement template" }];
    expect(st.dialogOutstandingBlockers(other, { ...filled, licenseNumber: "X" })).toEqual(other);
  });
  test("payment rows the agreement FLEET sends prints: Weekly, Card Autopay, Declined, balance = first week less the Reservation Fee", () => {
    expect(st.confirmTermsPaymentSummary("350.00", "50")).toEqual({ schedule: "Weekly", method: "Card Autopay", damageWaiver: "Declined", balanceDue: "$300.00" });
    expect(st.confirmTermsPaymentSummary("", "50").balanceDue).toBeNull();
    expect(st.confirmTermsPaymentSummary("350", "0").balanceDue).toBe("$350.00");
  });
  test("licence number parsing", () => {
    expect(st.parseLicenseNumber(" b252-431-75-246-0 ")).toBe("B252-431-75-246-0");
    expect(st.parseLicenseNumber("")).toBeNull();
    expect(st.parseLicenseNumber("<script>")).toBeNull();
  });
  test("wiring: the dialog shows the filtered list and the licence field; the profile takes the saved values; Prepare Agreement defaults Weekly + Card Autopay", () => {
    const dlg = readFileSync("src/components/admin/TermsConfirmedControl.tsx", "utf8");
    expect(dlg).toContain("dialogOutstandingBlockers(");
    expect(dlg).not.toContain("state.blockers.map((b) => b.label)");
    expect(dlg).toContain('htmlFor="mf-licence"');
    expect(dlg).toContain("Balance Due At Pickup");
    const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
    expect(panel).toMatch(/if \(saved && Object\.keys\(saved\)\.length\) onSaved\(saved\)/);
    const prep = readFileSync("src/components/admin/PrepareAgreementDialog.tsx", "utf8");
    expect(prep).toContain('payment: { schedule: "weekly", method: "Card Autopay" }');
    expect(prep).not.toMatch(/useState<AgreementPrep>\([^)]*damageWaiver/);
  });
});
