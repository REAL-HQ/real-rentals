import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyAgreementsForSwitch, oldVehicleReleaseStatus, SwitchReservationVehicleInput } from "../src/lib/reservation-switch.ts";
import { switchReservationVehicleCore } from "../src/lib/reservation-switch.server.ts";

const R = "11111111-1111-4111-8111-111111111111";
const OLD = "22222222-2222-4222-8222-222222222222";
const NEW = "33333333-3333-4333-8333-333333333333";
const APP = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, any>;
/** Tiny in-memory stand-in for the supabase query builder (eq / in / is / limit / update / select). */
function fakeAdmin(seed: Record<string, Row[]>, opts: { failVehicleUpdateFor?: string; uniqueOnRentalMove?: boolean } = {}) {
  const db: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const calls: Array<{ table: string; patch: Row; filters: any[] }> = [];
  const builder = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const raw: any[] = [];
    let patch: Row | null = null;
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), raw.push([c, v]), q),
      in: (c: string, vs: any[]) => (filters.push((r) => vs.includes(r[c])), q),
      is: (c: string, v: any) => (filters.push((r) => (r[c] ?? null) === v), q),
      limit: () => q,
      update: (p: Row) => ((patch = p), q),
      then: (resolve: any, reject: any) => run().then(resolve, reject),
      maybeSingle: async () => {
        const r = await run();
        return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
      },
    };
    const run = async (): Promise<{ data: Row[] | null; error: { message: string } | null }> => {
      const rows = (db[table] ??= []).filter((r) => filters.every((f) => f(r)));
      if (patch) {
        calls.push({ table, patch, filters: raw });
        if (table === "rentals" && opts.uniqueOnRentalMove && patch.vehicle_id) return { data: null, error: { message: "duplicate key rentals_one_reserved_per_vehicle_idx" } };
        if (table === "vehicles" && opts.failVehicleUpdateFor && raw.some(([c, v]) => c === "id" && v === opts.failVehicleUpdateFor)) return { data: [], error: null };
        for (const r of rows) Object.assign(r, patch);
      }
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    return q;
  };
  return { db, calls, from: builder };
}

const base = () => ({
  rentals: [{ id: R, status: "reserved", vehicle_id: OLD, application_id: APP, weekly_rate: 350, reservation_note: '{"pickup_time":"12:00"}', start_date: "2026-11-19", reservation_deposit_status: "paid" }],
  vehicles: [
    { id: OLD, status: "reserved", archived_at: null, year: 2013, make: "Ford", model: "Fusion", unit_number: "RR-004" },
    { id: NEW, status: "available", archived_at: null, year: 2015, make: "Toyota", model: "Camry", unit_number: "RR-009" },
  ],
  applications: [{ id: APP, vehicle_id: OLD }],
  agreements: [] as Row[],
});
const noAudit = async () => {};

describe("switchReservationVehicleCore", () => {
  it("moves the reservation, holds the new car, frees the old one, keeps pickup/fee/rate", async () => {
    const a = fakeAdmin(base());
    const audits: any[] = [];
    const res = await switchReservationVehicleCore(a, { rentalId: R, newVehicleId: NEW }, async (e) => void audits.push(e));
    const rental = a.db.rentals[0];
    assert.equal(rental.vehicle_id, NEW);
    assert.equal(rental.weekly_rate, 350);
    assert.equal(rental.reservation_note, '{"pickup_time":"12:00"}');
    assert.equal(rental.reservation_deposit_status, "paid");
    assert.equal(rental.start_date, "2026-11-19");
    assert.equal(a.db.vehicles.find((v) => v.id === NEW)!.status, "reserved");
    assert.equal(a.db.vehicles.find((v) => v.id === OLD)!.status, "available");
    assert.equal(a.db.applications[0].vehicle_id, NEW);
    assert.equal(res.oldVehicleStatus, "available");
    assert.equal(res.rateChanged, false);
    // the rental write touched only vehicle_id
    assert.deepEqual(a.calls.find((c) => c.table === "rentals")!.patch, { vehicle_id: NEW });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "reservation.vehicle_switched");
    assert.equal(audits[0].metadata.renter_notified, false);
  });

  it("old car has an issue sends it to Service (maintenance) and logs the reason", async () => {
    const a = fakeAdmin(base());
    const audits: any[] = [];
    const res = await switchReservationVehicleCore(a, { rentalId: R, newVehicleId: NEW, oldCarHasIssue: true, reason: "Check engine light" }, async (e) => void audits.push(e));
    assert.equal(a.db.vehicles.find((v) => v.id === OLD)!.status, "maintenance");
    assert.equal(res.oldVehicleStatus, "maintenance");
    assert.match(audits[0].summary, /Check engine light/);
    assert.equal(audits[0].metadata.old_car_has_issue, true);
  });

  it("rate edit is applied only when it differs", async () => {
    const a = fakeAdmin(base());
    const res = await switchReservationVehicleCore(a, { rentalId: R, newVehicleId: NEW, weeklyRate: 375 }, noAudit);
    assert.equal(a.db.rentals[0].weekly_rate, 375);
    assert.equal(res.rateChanged, true);
    assert.equal(res.weeklyRate, 375);
  });

  it("refuses a car that is not available, archived, reserved by someone else, or the same car", async () => {
    for (const mutate of [
      (d: any) => (d.vehicles[1].status = "maintenance"),
      (d: any) => (d.vehicles[1].status = "rented"),
      (d: any) => (d.vehicles[1].archived_at = "2026-01-01"),
      (d: any) => d.rentals.push({ id: "x", status: "reserved", vehicle_id: NEW, application_id: null }),
      (d: any) => d.rentals.push({ id: "y", status: "active", vehicle_id: NEW, application_id: null }),
    ]) {
      const seed = base();
      mutate(seed);
      const a = fakeAdmin(seed);
      await assert.rejects(() => switchReservationVehicleCore(a, { rentalId: R, newVehicleId: NEW }, noAudit));
      assert.equal(a.db.rentals[0].vehicle_id, OLD);
      assert.equal(a.db.vehicles.find((v) => v.id === OLD)!.status, "reserved");
    }
    const a = fakeAdmin(base());
    await assert.rejects(() => switchReservationVehicleCore(a, { rentalId: R, newVehicleId: OLD }, noAudit), /Different Vehicle/);
  });

  it("refuses a rental that is not Reserved (active swap is a different tool)", async () => {
    const seed = base();
    seed.rentals[0].status = "active";
    await assert.rejects(() => switchReservationVehicleCore(fakeAdmin(seed), { rentalId: R, newVehicleId: NEW }, noAudit), /Only A Reserved Car/);
  });

  it("a double-reserve lost to the unique index is a clear error and changes nothing", async () => {
    const a = fakeAdmin(base(), { uniqueOnRentalMove: true });
    await assert.rejects(() => switchReservationVehicleCore(a, { rentalId: R, newVehicleId: NEW }, noAudit), /Already Reserved/);
    assert.equal(a.db.vehicles.find((v) => v.id === OLD)!.status, "reserved");
  });

  it("if the new car cannot be held, the rental move is reversed", async () => {
    const a = fakeAdmin(base(), { failVehicleUpdateFor: NEW });
    await assert.rejects(() => switchReservationVehicleCore(a, { rentalId: R, newVehicleId: NEW }, noAudit), /No Longer Available/);
    assert.equal(a.db.rentals[0].vehicle_id, OLD);
    assert.equal(a.db.vehicles.find((v) => v.id === OLD)!.status, "reserved");
  });

  it("flags agreements naming the old car and never edits them", async () => {
    const seed = base();
    seed.agreements = [{ id: "a1", application_id: APP, vehicle_id: OLD, status: "signed" }];
    const a = fakeAdmin(seed);
    const audits: any[] = [];
    const res = await switchReservationVehicleCore(a, { rentalId: R, newVehicleId: NEW }, async (e) => void audits.push(e));
    assert.equal(res.agreement.needsAttention, true);
    assert.equal(res.agreement.signed, 1);
    assert.match(res.agreement.message, /re-signed/);
    assert.deepEqual(a.db.agreements[0], { id: "a1", application_id: APP, vehicle_id: OLD, status: "signed" });
    assert.equal(a.calls.some((c) => c.table === "agreements"), false);
    assert.equal(audits[0].metadata.agreement_needs_attention, true);
  });
});

describe("switch helpers", () => {
  it("agreement classification ignores voided and counts the rest", () => {
    assert.equal(classifyAgreementsForSwitch([{ status: "voided" }]).needsAttention, false);
    const f = classifyAgreementsForSwitch([{ status: "signed" }, { status: "sent" }, { status: "draft" }, { status: "voided" }]);
    assert.deepEqual([f.signed, f.outstanding, f.draft], [1, 1, 1]);
  });
  it("release status", () => {
    assert.equal(oldVehicleReleaseStatus(true), "maintenance");
    assert.equal(oldVehicleReleaseStatus(false), "available");
  });
  it("input rejects bad ids and non-positive rate", () => {
    assert.equal(SwitchReservationVehicleInput.safeParse({ rentalId: "x", newVehicleId: NEW }).success, false);
    assert.equal(SwitchReservationVehicleInput.safeParse({ rentalId: R, newVehicleId: NEW, weeklyRate: 0 }).success, false);
    assert.equal(SwitchReservationVehicleInput.safeParse({ rentalId: R, newVehicleId: NEW }).success, true);
  });
});

describe("wiring", () => {
  const fn = readFileSync("src/lib/reservations.functions.ts", "utf8");
  const panel = readFileSync("src/components/admin/ReservationsPanel.tsx", "utf8");
  const actions = readFileSync("src/components/admin/BookingActions.tsx", "utf8");
  const dialog = readFileSync("src/components/admin/SwitchReservationVehicleDialog.tsx", "utf8");
  it("server fn is Manager-only and audited", () => {
    assert.match(fn, /switchReservationVehicle = createServerFn[\s\S]*?requireManager\(context\.userId\)[\s\S]*?logAudit/);
  });
  it("menu item (managers only) and booking action (reserved only) are present", () => {
    assert.match(panel, /Switch Vehicle<\/DropdownMenuItem>/);
    assert.match(panel, /canManage \? \(\s*<DropdownMenu>/);
    assert.match(actions, /d\.canManage && reserved/);
    assert.match(actions, /label="Switch Vehicle"/);
  });
  it("dialog reuses the searchable picker, available cars, no renter message, Title Case", () => {
    assert.match(dialog, /VehicleCombobox/);
    assert.match(dialog, /listVehiclesForReservation/);
    assert.match(dialog, /The renter is not messaged/);
    assert.equal(/text-transform|uppercase/.test(dialog), false);
  });
});
