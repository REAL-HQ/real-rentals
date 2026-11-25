/**
 * Pending Reservation: the $50 Reservation Fee holds the assigned car before
 * a pickup is booked. The insurance card promotes it to Reserved. Pickup
 * booking reuses the row. Void, decline, and refund release it.
 * Run: bun test scripts/pending-reservation.test.ts
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;

const { holdReservationForFee } = await import("../src/lib/reservation-fee.server");
const { promotePendingReservationOnInsuranceCard, releasePendingReservation } = await import("../src/lib/pending-reservation.server");
const { createReservationCore } = await import("../src/lib/reservations.functions");
const { summarizeFleet } = await import("../src/lib/fleet-summary");
const { isIssuedRenterInsuranceCard, pendingHoldHidesBookPickup, PENDING_RESERVATION_LABEL, WAITING_ON_INSURANCE_CARD } = await import("../src/lib/pending-reservation");
const { readReservationDetails, writeReservationDetails } = await import("../src/lib/reservations");

type Row = Record<string, any>;
let seq = 0;
function fakeDb(seed: Record<string, Row[]> = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  function from(table: string) {
    state[table] ??= [];
    let op = "select";
    let payload: any = null;
    let single = false;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q,
      insert: (r: Row) => { op = "insert"; payload = r; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      neq: (c: string, v: any) => { f.push((r) => r[c] !== v); return q; },
      is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      limit: () => q,
      order: () => q,
      maybeSingle: () => { single = true; return q; },
      single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = state[table];
      if (op === "insert") {
        const row = { id: payload.id ?? `${table}-${++seq}`, ...payload };
        rows.push(row);
        return { data: single ? row : [row], error: null };
      }
      const m = rows.filter((r) => f.every((x) => x(r)));
      if (op === "update") {
        for (const r of m) Object.assign(r, payload);
        return { data: m.map((r) => ({ ...r })), error: null };
      }
      return { data: single ? m[0] ?? null : m, error: null };
    }
    return q;
  }
  return { from, state };
}

const APP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PAY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function world(extra: { rentals?: Row[]; documents?: Row[]; vehicleStatus?: string } = {}) {
  return {
    applications: [{ id: APP, status: "approved", user_id: USER, full_name: "Fabio Da Silva", email: "fabio@example.com", vehicle_id: CAR, deleted_at: null }],
    vehicles: [{ id: CAR, status: extra.vehicleStatus ?? "available", archived_at: null, weekly_rate: 250, year: 2019, make: "Nissan", model: "Sentra", license_plate: "ABC123", vin: "1N4AL3AP4JC123456" }],
    payments: [{ id: PAY, driver_id: APP, reason: "reservation_fee", status: "paid", amount: 50, notes: "reservation_fee:ag1", rental_id: null }],
    rentals: extra.rentals ?? [],
    documents: extra.documents ?? [],
    agreements: [{ id: "ag1", application_id: APP, status: "signed", voided_at: null, rental_id: null, vehicle_id: CAR }],
    app_settings: [
      { key: "reservation_fee_auto", value: { enabled: true, amount: 50 } },
      { key: "automation_controls", value: { off: { booking_login_email: true } } },
    ],
    audit_log: [],
  };
}

const fee = { id: PAY, amount: 50 };
const pickup = {
  applicationId: APP,
  vehicleId: CAR,
  pickupDate: "2026-11-21",
  pickupTime: "10:30",
  pickupLocation: "3500 E Hillsborough Ave, Tampa, FL",
};

describe("fee paid opens a Pending Reservation", () => {
  test("no rental row yet holds the assigned car, and a second call does not add another", async () => {
    const db = fakeDb(world());
    const id = await holdReservationForFee(db, APP, fee);
    expect(id).toBeTruthy();
    const holds = db.state.rentals.filter((r) => r.status === "pending_reservation");
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({
      application_id: APP,
      vehicle_id: CAR,
      driver_id: USER,
      reservation_deposit_status: "applied",
      reservation_deposit_payment_id: PAY,
      reservation_deposit_amount: 50,
    });
    expect(readReservationDetails(holds[0].reservation_note).pickupTime).toBeNull();
    expect(db.state.vehicles[0].status).toBe("pending_reservation");
    expect(await holdReservationForFee(db, APP, fee)).toBe(id);
    expect(db.state.rentals.filter((r) => r.status === "pending_reservation")).toHaveLength(1);
    expect(db.state.vehicles[0].status).toBe("pending_reservation");
  });

  test("an existing reserved row is only marked fee-applied", async () => {
    const db = fakeDb(world({ rentals: [{ id: "r-res", application_id: APP, vehicle_id: CAR, driver_id: USER, status: "reserved", reservation_deposit_status: "pending" }], vehicleStatus: "reserved" }));
    expect(await holdReservationForFee(db, APP, fee)).toBe("r-res");
    expect(db.state.rentals).toHaveLength(1);
    expect(db.state.rentals[0].reservation_deposit_status).toBe("applied");
    expect(db.state.rentals[0].status).toBe("reserved");
  });
});

describe("insurance card promotes to Reserved", () => {
  test("an issued card promotes; the application-wizard file does not", async () => {
    expect(isIssuedRenterInsuranceCard({ category: "insurance", label: "Insurance (from application)", is_current: true })).toBe(false);
    expect(isIssuedRenterInsuranceCard({ category: "insurance", label: "Insurance ID Card", is_current: true, review_status: "uploaded" })).toBe(true);
    expect(isIssuedRenterInsuranceCard({ category: "insurance_quote", label: "Quote", is_current: true })).toBe(false);

    const db = fakeDb(world());
    const id = await holdReservationForFee(db, APP, fee);
    db.state.documents.push({ id: "doc-app", driver_id: APP, category: "insurance", label: "Insurance (from application)", is_current: true, review_status: "uploaded" });
    expect(await promotePendingReservationOnInsuranceCard(db, APP)).toBeNull();
    expect(db.state.rentals[0].status).toBe("pending_reservation");

    db.state.documents.push({ id: "doc-card", driver_id: APP, category: "insurance", label: "Insurance ID Card", is_current: true, review_status: "uploaded" });
    expect(await promotePendingReservationOnInsuranceCard(db, APP)).toBe(id);
    expect(db.state.rentals[0].status).toBe("reserved");
    expect(db.state.vehicles[0].status).toBe("reserved");
    expect(await promotePendingReservationOnInsuranceCard(db, APP)).toBeNull();
  });
});

describe("pickup booking reuses the pending row", () => {
  test("createReservationCore updates the pending hold and does not insert a second rental", async () => {
    const db = fakeDb(world());
    const id = await holdReservationForFee(db, APP, fee);
    const booked = await createReservationCore(db as any, pickup);
    expect(booked.id).toBe(id);
    expect(db.state.rentals).toHaveLength(1);
    expect(db.state.rentals[0].status).toBe("pending_reservation");
    expect(db.state.rentals[0].start_date).toBe("2026-11-21");
    expect(readReservationDetails(db.state.rentals[0].reservation_note).pickupTime).toBe("10:30");
    expect(db.state.vehicles[0].status).toBe("pending_reservation");
    const again = await createReservationCore(db as any, pickup);
    expect(again.id).toBe(id);
    expect(db.state.rentals).toHaveLength(1);
  });

  test("an on-hold row is reused instead of a second insert", async () => {
    const db = fakeDb(world({
      rentals: [{ id: "r-hold", application_id: APP, vehicle_id: CAR, driver_id: USER, status: "on_hold", reservation_note: null, start_date: "2026-11-01" }],
      vehicleStatus: "reserved",
    }));
    const booked = await createReservationCore(db as any, pickup);
    expect(booked.id).toBe("r-hold");
    expect(db.state.rentals).toHaveLength(1);
    expect(db.state.rentals[0].status).toBe("on_hold");
    expect(readReservationDetails(db.state.rentals[0].reservation_note).pickupTime).toBe("10:30");
  });

  test("a reserved row that already has a pickup still refuses", async () => {
    const note = writeReservationDetails({ pickupTime: "10:30", pickupLocation: "3500 E Hillsborough Ave, Tampa, FL" });
    const db = fakeDb(world({
      rentals: [{ id: "r-booked", application_id: APP, vehicle_id: CAR, driver_id: USER, status: "reserved", reservation_note: note, start_date: "2026-11-21" }],
      vehicleStatus: "reserved",
    }));
    await expect(createReservationCore(db as any, pickup)).rejects.toThrow(/Already Has A Reserved Car/);
    expect(db.state.rentals).toHaveLength(1);
  });

  test("someone else's pending hold cannot be booked", async () => {
    const db = fakeDb(world({
      rentals: [{ id: "r-other", application_id: OTHER, vehicle_id: CAR, driver_id: "uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuuu", status: "pending_reservation" }],
      vehicleStatus: "pending_reservation",
    }));
    await expect(createReservationCore(db as any, pickup)).rejects.toThrow(/Already Reserved/);
  });
});

describe("release", () => {
  test("staff release, and the same helper covers void, decline, and refund", async () => {
    const db = fakeDb(world());
    await holdReservationForFee(db, APP, fee);
    expect((await releasePendingReservation(db, { applicationId: APP, reason: "agreement_voided" })).released).toBe(1);
    expect(db.state.rentals[0].status).toBe("cancelled");
    expect(db.state.vehicles[0].status).toBe("available");
    expect((await releasePendingReservation(db, { applicationId: APP, reason: "fee_refunded" })).released).toBe(0);

    const again = fakeDb(world());
    await holdReservationForFee(again, APP, fee);
    expect((await releasePendingReservation(again, { applicationId: APP, reason: "application_declined" })).released).toBe(1);
    expect(again.state.vehicles[0].status).toBe("available");

    for (const file of ["esign.server.ts", "application-lifecycle.functions.ts", "fleet-review.server.ts", "reservation-fee-refund.server.ts", "missing-items-outreach.server.ts"]) {
      expect(readFileSync(`src/lib/${file}`, "utf8")).toContain("releasePendingReservation");
    }
    expect(readFileSync("src/routes/api/public/payments/webhook.ts", "utf8")).toContain("releasePendingReservation");
    expect(readFileSync("src/lib/reservations.functions.ts", "utf8")).toContain("Release Hold");
  });
});

describe("fleet counts and Book Pickup", () => {
  test("pending is not Available and stays in the rentable denominator", () => {
    const summary = summarizeFleet([
      { status: "available" },
      { status: "pending_reservation" },
      { status: "reserved" },
      { status: "rented" },
    ]);
    expect(summary.available).toBe(1);
    expect(summary.pendingReservation).toBe(1);
    expect(summary.reserved).toBe(1);
    expect(summary.rented).toBe(1);
    expect(summary.rentable).toBe(4);
    expect(summary.utilizationPct).toBe(25);
    const pendingOnly = summarizeFleet([{ status: "pending_reservation" }]);
    expect(pendingOnly.available).toBe(0);
    expect(pendingOnly.rentable).toBe(1);
    expect(pendingOnly.utilizationPct).toBe(0);
  });

  test("a pending hold without a pickup still shows Book Pickup", () => {
    expect(pendingHoldHidesBookPickup("pending_reservation", null)).toBe(false);
    expect(pendingHoldHidesBookPickup("pending_reservation", writeReservationDetails({ pickupTime: "10:30", pickupLocation: "3500 E Hillsborough Ave" }))).toBe(true);
    expect(pendingHoldHidesBookPickup("reserved", null)).toBe(true);
    expect(pendingHoldHidesBookPickup("on_hold", null)).toBe(true);
    expect(pendingHoldHidesBookPickup("active", null)).toBe(true);
  });

  test("Bookings badge and vehicle status are Title Case and yellow", () => {
    const panel = readFileSync("src/components/admin/ReservationsPanel.tsx", "utf8");
    expect(panel).toContain(PENDING_RESERVATION_LABEL);
    expect(panel).toContain("WAITING_ON_INSURANCE_CARD");
    expect(WAITING_ON_INSURANCE_CARD).toBe("Waiting On Insurance Card");
    expect(panel).toContain("Release Hold");
    expect(panel).toContain("data-reservation-status=\"pending_reservation\"");
    expect(panel).toContain("bg-[#FFF4CC]");
    expect(panel.toLowerCase()).not.toContain(">deposit<");
    const badge = readFileSync("src/components/VehicleStatusBadge.tsx", "utf8");
    expect(badge).toContain("pending_reservation");
    expect(readFileSync("src/lib/vehicles.functions.ts", "utf8")).toContain('label: "Pending Reservation"');
    expect(readFileSync("src/components/admin/ReservationsPanel.tsx", "utf8")).toContain("vinLast6");
  });
});
