/**
 * Unpaid Reservation Fee hold: staff can release at any time inside 24 hours,
 * the cron releases only after the window, and a released car can be booked.
 * Run: bun test scripts/reservation-fee-hold.test.ts
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  assignmentStillBlocks,
  holdWindowOpen,
  releaseConfirmMessage,
  reservationFeeHoldHours,
  reservationFeeHoldSentence,
} from "../src/lib/reservation-fee-hold";
import {
  flagReservationFeePaidWithoutHold,
  releaseExpiredReservationHolds,
  releaseUnpaidReservationHold,
  reservationFeeHoldConflict,
} from "../src/lib/reservation-fee-hold.server";
import { createReservationCore } from "../src/lib/reservations.functions";
import { assignableVehicles } from "../src/lib/fleet-assign.server";

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

const HOLDER = "11111111-1111-4111-8111-111111111111";
const NEXT = "22222222-2222-4222-8222-222222222222";
const CAR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_H = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_N = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PAY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SIGNED = "2026-11-25T12:00:00.000Z";
const INSIDE = new Date("2026-11-25T18:00:00.000Z");
const AFTER = new Date("2026-11-26T12:00:00.000Z");

function world(extra: { feeStatus?: string; session?: string; rental?: boolean; vehicleStatus?: string } = {}) {
  return {
    applications: [
      { id: HOLDER, status: "approved", user_id: USER_H, full_name: "Jordan Hale", email: "jordan@example.com", vehicle_id: CAR, deleted_at: null },
      { id: NEXT, status: "approved", user_id: USER_N, full_name: "Alex Rivera", email: "alex@example.com", vehicle_id: null, deleted_at: null },
    ],
    vehicles: [{ id: CAR, status: extra.vehicleStatus ?? "reserved", archived_at: null, weekly_rate: 350, year: 2019, make: "Ford", model: "Fusion", license_plate: "ABC123", vin: "1FAHP3F29CL000000", created_at: "2026-10-01T00:00:00Z" }],
    payments: [{
      id: PAY, driver_id: HOLDER, reason: "reservation_fee", type: "reservation", status: extra.feeStatus ?? "current",
      amount: 50, balance_due: 50, notes: "reservation_fee:ag1", created_at: SIGNED, refunded_amount: 0,
    }],
    agreements: [{
      id: "ag1", application_id: HOLDER, status: "signed", signed_at: SIGNED, rental_id: null, voided_at: null, vehicle_id: CAR,
      metadata: { reservation_fee_checkout: { session_id: extra.session ?? "cs_open", payment_id: PAY } },
    }],
    rentals: extra.rental === false ? [] : [{ id: "rent-1", application_id: HOLDER, driver_id: USER_H, vehicle_id: CAR, status: "reserved", start_date: "2026-11-26", reservation_note: null }],
    app_settings: [] as Row[],
    audit_log: [] as Row[],
    notifications: [] as Row[],
  };
}

const stripe = (status: "open" | "complete") => {
  const calls: string[] = [];
  return {
    calls,
    checkout: {
      sessions: {
        retrieve: async () => ({ status }),
        expire: async (id: string) => { calls.push(id); return { id, status: "expired" }; },
      },
    },
  };
};

const quiet = async () => {};

describe("reservation fee hold rules", () => {
  test("hours fall back to 24 and the confirm dialog turns the payment link off", () => {
    expect(reservationFeeHoldHours(null)).toBe(24);
    expect(reservationFeeHoldHours({ hours: 12 })).toBe(12);
    expect(reservationFeeHoldHours("nope")).toBe(24);
    expect(holdWindowOpen(SIGNED, INSIDE, 24)).toBe(true);
    expect(holdWindowOpen(SIGNED, AFTER, 24)).toBe(false);
    expect(releaseConfirmMessage("Jordan Hale")).toContain("payment link will be turned off");
    expect(reservationFeeHoldSentence(24)).toBe("If the Reservation Fee is not paid within 24 hours, the car is released.");
    expect(assignmentStillBlocks([{ status: "current", reason: "reservation_fee" }])).toBe(true);
    expect(assignmentStillBlocks([{ status: "expired", reason: "reservation_fee" }])).toBe(false);
    expect(assignmentStillBlocks([])).toBe(true);
  });
});

describe("staff release inside the window", () => {
  test("frees the car immediately and turns off the open payment link", async () => {
    const db = fakeDb(world());
    const pay = stripe("open");
    const notes: any[] = [];
    const result = await releaseUnpaidReservationHold(db, {
      applicationId: HOLDER, by: "staff", now: INSIDE, stripe: pay as any,
      notify: async (_a, n) => { notes.push(n); },
    });
    expect(result.released).toBe(true);
    expect(result.paymentLinkExpired).toBe(true);
    expect(pay.calls).toEqual(["cs_open"]);
    expect(db.state.applications[0].status).toBe("approved");
    expect(db.state.applications[0].vehicle_id).toBeNull();
    expect(db.state.payments[0].status).toBe("expired");
    expect(db.state.payments[0].amount).toBe(50);
    expect(db.state.rentals[0].status).toBe("cancelled");
    expect(db.state.vehicles[0].status).toBe("available");
    expect(db.state.app_settings).toEqual([]);
    expect(db.state.audit_log.some((r) => r.action === "reservation_fee.hold_released")).toBe(true);
    expect(notes[0].title).toBe("Reservation Fee Hold Released");
    expect(await reservationFeeHoldConflict(db, { vehicleId: CAR, requesterApplicationId: NEXT })).toBeNull();
    const cars = await assignableVehicles(db, { exceptApplicationId: NEXT });
    expect(cars.map((c) => c.vehicle_id)).toContain(CAR);

    db.state.app_settings.push({ key: "automation_controls", value: { off: { booking_login_email: true } } });
    const booked = await createReservationCore(db as any, {
      applicationId: NEXT, vehicleId: CAR, pickupDate: "2026-11-27", pickupTime: "10:00",
      pickupLocation: "3500 E Hillsborough Ave, Tampa, FL",
    });
    expect(booked.id).toBeTruthy();
    expect(db.state.rentals.some((r) => r.application_id === NEXT && r.status === "reserved")).toBe(true);
  });

  test("the cron leaves a hold that is still inside the window", async () => {
    const db = fakeDb(world({ rental: false, vehicleStatus: "available" }));
    const result = await releaseUnpaidReservationHold(db, {
      applicationId: HOLDER, by: "cron", now: INSIDE, stripe: stripe("open") as any, notify: quiet,
    });
    expect(result).toMatchObject({ released: false, reason: "still_open" });
    expect(db.state.applications[0].vehicle_id).toBe(CAR);
    expect(db.state.payments[0].status).toBe("current");
    await expect(createReservationCore(db as any, {
      applicationId: NEXT, vehicleId: CAR, pickupDate: "2026-11-27", pickupTime: "10:00",
      pickupLocation: "3500 E Hillsborough Ave, Tampa, FL",
    })).rejects.toThrow(/unpaid Reservation Fee/);
  });

  test("the cron releases once 24 hours have passed", async () => {
    const db = fakeDb(world());
    const sweep = await releaseExpiredReservationHolds(db, { now: AFTER, stripe: stripe("open") as any, notify: quiet });
    expect(sweep.released).toBe(1);
    expect(db.state.applications[0].vehicle_id).toBeNull();
    expect(db.state.payments[0].status).toBe("expired");
    expect(db.state.rentals[0].status).toBe("cancelled");
  });

  test("a completed Checkout or a paid fee is not released", async () => {
    const open = fakeDb(world());
    const done = await releaseUnpaidReservationHold(open, {
      applicationId: HOLDER, by: "staff", now: INSIDE, stripe: stripe("complete") as any, notify: quiet,
    });
    expect(done).toMatchObject({ released: false, reason: "already_paid" });
    expect(open.state.applications[0].vehicle_id).toBe(CAR);
    expect(open.state.payments[0].status).toBe("current");

    const paid = fakeDb(world({ feeStatus: "paid" }));
    const skip = await releaseUnpaidReservationHold(paid, {
      applicationId: HOLDER, by: "staff", now: INSIDE, stripe: stripe("open") as any, notify: quiet,
    });
    expect(skip).toMatchObject({ released: false, reason: "not_unpaid" });
    expect(paid.state.payments[0].status).toBe("paid");
  });

  test("a fee paid with no car stays paid and is flagged, never refunded", async () => {
    const db = fakeDb(world({ feeStatus: "paid", rental: false, vehicleStatus: "available" }));
    db.state.applications[0].vehicle_id = null;
    const notes: any[] = [];
    const flagged = await flagReservationFeePaidWithoutHold(db, HOLDER, { id: PAY, amount: 50 }, async (_a, n) => { notes.push(n); });
    expect(flagged.flagged).toBe(true);
    expect(db.state.payments[0].status).toBe("paid");
    expect(db.state.payments[0].refunded_amount).toBe(0);
    expect(db.state.payments[0].notes).toContain("reservation_fee_no_hold");
    expect(notes[0].title).toBe("Reservation Fee Paid With No Car");
    const again = await flagReservationFeePaidWithoutHold(db, HOLDER, { id: PAY, amount: 50 }, async () => { throw new Error("twice"); });
    expect(again.flagged).toBe(false);
  });
});

describe("hold wiring", () => {
  test("cron, booking, fleet, checklist and the signed email use the shared release", () => {
    const read = (p: string) => readFileSync(p, "utf8");
    expect(read("src/routes/api/public/cron/automations.ts")).toContain("releaseExpiredReservationHolds");
    expect(read("src/lib/reservations.functions.ts")).toContain("reservationFeeHoldConflict");
    expect(read("src/lib/fleet-assign.server.ts")).toContain("assignmentStillBlocks");
    expect(read("src/components/admin/ReservationsPanel.tsx")).toContain("release-reservation-fee");
    expect(read("src/components/admin/ReleaseReservationFeeDialog.tsx")).toContain("releaseConfirmMessage");
    expect(read("src/components/admin/checklist-actions.ts")).toContain("release_reservation_fee");
    expect(read("src/lib/email.server.ts")).toContain("reservationFeeHoldSentence");
    expect(read("supabase/migrations/20261125190000_payments_status_expired.sql")).toContain("'expired'");
    expect(read("src/lib/payments-summary.ts")).toContain('"expired"');
  });
});
