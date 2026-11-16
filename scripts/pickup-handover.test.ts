import { describe, expect, test } from "bun:test";
import { decideAutoActivation, handoverGates, licenseHoldCaption, readAutoActivateSetting } from "../src/lib/pickup-handover";
import { submitHandover } from "../src/lib/pickup-handover.server";
import { readFileSync } from "node:fs";

const APP = "11111111-1111-4111-8111-111111111111";
const VEH = "22222222-2222-4222-8222-222222222222";
const RES = "33333333-3333-4333-8333-333333333333";

function fakeDb(tables: Record<string, any[]>) {
  const db: any = { tables, inserted: [] as any[], updated: [] as any[] };
  db.from = (name: string) => {
    const filters: ((r: any) => boolean)[] = [];
    const q: any = {
      select: () => q,
      eq: (k: string, v: any) => (filters.push((r) => r[k] === v), q),
      limit: () => q,
      rows: () => (tables[name] ?? []).filter((r) => filters.every((f) => f(r))),
      maybeSingle: async () => {
        if (!(name in tables)) return { data: null, error: { code: "42P01", message: `relation "${name}" does not exist` } };
        return { data: q.rows()[0] ?? null, error: null };
      },
      then: (res: any, rej: any) => Promise.resolve({ data: q.rows(), error: null }).then(res, rej),
      insert: async (row: any) => {
        tables[name] = tables[name] ?? [];
        if (name === "pickup_handovers" && tables[name].some((r) => r.rental_id === row.rental_id)) return { error: { code: "23505", message: "duplicate key" } };
        tables[name].push({ ...row });
        db.inserted.push({ name, row });
        return { error: null };
      },
      update: (patch: any) => ({
        eq: async (k: string, v: any) => {
          for (const r of tables[name] ?? []) if (r[k] === v) Object.assign(r, patch);
          db.updated.push({ name, patch });
          return { error: null };
        },
      }),
    };
    return q;
  };
  return db;
}

function world(over: { setting?: any; card?: boolean; fee?: string; photo?: boolean } = {}) {
  return {
    rentals: [{ id: RES, status: "reserved", application_id: APP, vehicle_id: VEH, start_date: "2026-11-18", reservation_note: null, weekly_rate: 350, deposit_amount: 0, reservation_deposit_required: true, reservation_deposit_status: over.fee ?? "paid", card_last4: null, card_on_file_at: null }],
    applications: [{ id: APP, full_name: "Sam Lee", email: "sam@example.com", weekly_rent: 350, deposit_amount: 0, card_last4: over.card === false ? null : "4242", stripe_payment_method_id: null, card_on_file_at: null }],
    vehicles: [{ id: VEH, year: 2017, make: "Ford", model: "Fusion", license_plate: "ABC123", weekly_rate: 350, deposit: null }],
    condition_media: over.photo === false ? [] : [{ id: "m1", rental_id: RES, phase: "checkout", caption: licenseHoldCaption(APP) }],
    pickup_handovers: [] as any[],
    app_settings: over.setting === undefined ? [] : [{ key: "pickup_auto_activate", value: over.setting }],
    audit_log: [] as any[],
  };
}

const manager = { userId: "u1", email: "rep@drivereal.com", role: "team", tier: "manager" as const };
const coordinator = { ...manager, role: "coordinator", tier: "coordinator" as const };
const input = { rentalId: RES, odometer: 84210, fuelLevel: "3/4", renterSignatureName: "Sam Lee", renterAgreed: true };
const ON = { enabled: true, override_no_interview: true, override_no_passed_inspection: true };

function deps(blockers: { code: string; message?: string }[] = []) {
  const calls: any[] = [];
  return {
    calls,
    readiness: async () => ({ blockers }),
    activate: async (actor: any, i: any) => (calls.push({ actor, i }), { ok: true, rentalId: "new-rental" }),
    now: () => new Date("2026-11-18T14:40:00Z"),
  };
}

describe("rules", () => {
  test("setting is off unless enabled is exactly true", () => {
    expect(readAutoActivateSetting(null).enabled).toBe(false);
    expect(readAutoActivateSetting({ enabled: "true" }).enabled).toBe(false);
    expect(readAutoActivateSetting(ON)).toEqual(ON);
  });
  test("fee: required and unpaid blocks; not required passes", () => {
    const base = { licensePhoto: true, odometer: 1, fuelLevel: "F", renterSignatureName: "Sam Lee", renterSignedAt: "x", agreementSigned: true, cardOnFile: true };
    expect(handoverGates({ ...base, reservationFeeRequired: true, reservationFeeStatus: "pending" }).find((g) => g.key === "fee_paid")!.met).toBe(false);
    expect(handoverGates({ ...base, reservationFeeRequired: false, reservationFeeStatus: "pending" }).find((g) => g.key === "fee_paid")!.met).toBe(true);
  });
  test("hard blockers and uncovered soft blockers stop auto-activation", () => {
    const gates = handoverGates({ licensePhoto: true, odometer: 1, fuelLevel: "F", renterSignatureName: "Sam Lee", renterSignedAt: "x", agreementSigned: true, cardOnFile: true, reservationFeeRequired: false, reservationFeeStatus: null });
    expect(decideAutoActivation({ setting: ON, actorIsManager: true, gates, blockers: [{ code: "vehicle_not_ready" }] }).activate).toBe(false);
    expect(decideAutoActivation({ setting: { ...ON, override_no_passed_inspection: false }, actorIsManager: true, gates, blockers: [{ code: "no_passed_inspection" }] }).activate).toBe(false);
    expect(decideAutoActivation({ setting: ON, actorIsManager: true, gates, blockers: [{ code: "no_interview" }, { code: "no_passed_inspection" }] })).toEqual({ activate: true, overrides: ["no_interview", "no_passed_inspection"] });
    expect(decideAutoActivation({ setting: ON, actorIsManager: true, gates, blockers: [{ code: "license_not_collected" }] }).activate).toBe(false);
  });
});

describe("submitHandover", () => {
  test("setting off: checklist saved, nothing activated", async () => {
    const db = fakeDb(world());
    const d = deps();
    const r = await submitHandover(db, manager, input, d);
    expect(r).toMatchObject({ ok: true, activation: "not_activated", decision: { reason: "auto_activate_off" } });
    expect(d.calls).toEqual([]);
    expect(db.tables.pickup_handovers[0]).toMatchObject({ odometer: 84210, fuel_level: "3/4", renter_signature_name: "Sam Lee", activation_status: "not_activated" });
    expect(db.tables.audit_log[0].action).toBe("rental.pickup_checklist_completed");
  });
  test("on + all gates: activates through the normal path with the checklist odometer, listed rate, ET date, audited override", async () => {
    const db = fakeDb(world({ setting: ON }));
    const d = deps([{ code: "no_interview", message: "x" }]);
    const r = await submitHandover(db, manager, input, d);
    expect(r).toMatchObject({ ok: true, activation: "activated", rentalId: "new-rental" });
    expect(d.calls[0].i).toMatchObject({ applicationId: APP, vehicleId: VEH, weeklyRate: 350, depositAmount: 0, startDate: "2026-11-18", pickupMileage: 84210, overrideBlockers: true });
    expect(d.calls[0].i.overrideReason).toContain("Pickup checklist completed by rep@drivereal.com");
    expect(JSON.stringify(d.calls[0].i)).not.toMatch(/insurance_verified|verified/);
    expect(db.tables.pickup_handovers[0].activation_status).toBe("activated");
  });
  test("no card, unpaid fee, or a coordinator: saved but not activated", async () => {
    for (const [w, actor, reason] of [
      [world({ setting: ON, card: false }), manager, "gates_not_met"],
      [world({ setting: ON, fee: "pending" }), manager, "gates_not_met"],
      [world({ setting: ON }), coordinator, "needs_manager"],
    ] as const) {
      const d = deps();
      const r = await submitHandover(fakeDb(w as any), actor as any, input, d);
      expect(r).toMatchObject({ ok: true, activation: "not_activated", decision: { reason } });
      expect(d.calls).toEqual([]);
    }
  });
  test("unsigned agreement stops activation", async () => {
    const d = deps([{ code: "no_signed_agreement", message: "x" }]);
    const r = await submitHandover(fakeDb(world({ setting: ON })), manager, input, d);
    expect(r).toMatchObject({ activation: "not_activated", decision: { reason: "gates_not_met", missing: ["agreement_signed"] } });
  });
  test("refuses without the license photo, without renter confirmation, and twice", async () => {
    expect(await submitHandover(fakeDb(world({ photo: false })), manager, input, deps())).toMatchObject({ ok: false });
    expect(await submitHandover(fakeDb(world()), manager, { ...input, renterAgreed: false }, deps())).toMatchObject({ ok: false });
    const db = fakeDb(world());
    await submitHandover(db, manager, input, deps());
    expect(await submitHandover(db, manager, input, deps())).toMatchObject({ ok: false, error: "This pickup checklist was already completed." });
  });
  test("no table: nothing saved", async () => {
    const w: any = world();
    delete w.pickup_handovers;
    const r = await submitHandover(fakeDb(w), manager, input, deps());
    expect(r).toMatchObject({ ok: false });
  });
  test("activation refused: recorded as failed, blockers returned", async () => {
    const db = fakeDb(world({ setting: ON }));
    const d = { ...deps(), activate: async () => ({ ok: false, blockers: [{ code: "vehicle_busy", message: "busy" }] }) };
    const r = await submitHandover(db, manager, input, d);
    expect(r).toMatchObject({ ok: true, activation: "not_activated", blockers: [{ code: "vehicle_busy" }] });
    expect(db.tables.pickup_handovers[0].activation_status).toBe("failed");
  });
});

describe("wiring", () => {
  test("one activation path; SQL files are marked proposed", () => {
    const fns = readFileSync("src/lib/pickup-handover.functions.ts", "utf8");
    expect(fns).toContain("activateRentalCore");
    expect(fns).not.toContain("activate_rental");
    const rentals = readFileSync("src/lib/rentals.functions.ts", "utf8");
    expect(rentals).toContain("activateRentalCore(await assertStaff(context.supabase, context.userId), data)");
    for (const f of ["proposed/pickup-handovers-v1.sql", "proposed/pickup-auto-activate-on.sql"]) expect(readFileSync(f, "utf8").startsWith("-- PROPOSED, NOT APPLIED")).toBe(true);
  });
});
