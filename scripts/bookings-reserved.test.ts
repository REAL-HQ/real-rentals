import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BOOKINGS_VIEWS, parseBookingsView } from "../src/lib/bookings-workspace.ts";
import { attachUnpaidReservationFees, reservationFeeLabel, unpaidReservationFeeDetail, vinLast6 } from "../src/lib/reservations.ts";

const panel = readFileSync("src/components/admin/ReservationsPanel.tsx", "utf8");
const workspace = readFileSync("src/components/admin/BookingsWorkspace.tsx", "utf8");
const fn = readFileSync("src/lib/reservations.functions.ts", "utf8");

describe("Bookings Reserved tab", () => {
  it("tabs read Reserved / Active / Past (Booked is gone)", () => {
    assert.deepEqual(BOOKINGS_VIEWS.map((v) => v.label), ["Reserved", "Active", "Past"]);
    assert.equal(workspace.includes('"booked"'), false);
  });

  it("old booked and reserved links both land on Reserved", () => {
    assert.equal(parseBookingsView("reserved", { canViewBoard: true }), "reserved");
    assert.equal(parseBookingsView("booked", { canViewBoard: true }), "reserved");
    assert.equal(parseBookingsView("active", { canViewBoard: true }), "active");
    assert.equal(parseBookingsView(undefined, { canViewBoard: true }), "active");
  });

  it("Reservation Fee reads Paid / Unpaid / Waived", () => {
    assert.equal(reservationFeeLabel("paid", true), "Paid");
    assert.equal(reservationFeeLabel("applied", true), "Paid");
    assert.equal(reservationFeeLabel("waived", true), "Waived");
    assert.equal(reservationFeeLabel("pending", true), "Unpaid");
    assert.equal(reservationFeeLabel("not_required", true), "Unpaid");
    assert.equal(reservationFeeLabel("not_required", false), "Not Required");
    assert.equal(reservationFeeLabel("refunded", true), "Refunded");
  });

  it("VIN last 6", () => {
    assert.equal(vinLast6("3FAHP0HA1CR123456"), "123456");
    assert.equal(vinLast6(null), null);
  });

  it("panel has Active-style columns, count, Open button, Title Case, no deposit wording", () => {
    for (const h of ["Driver", "Vehicle", "Reserved", "Pickup", "Rate", "Open"]) assert.match(panel, new RegExp(`>${h}</th>|>\\{chargeLabel\\}</th>`));
    assert.match(panel, /Reserved Vehicle\{rows\.length === 1/);
    assert.match(panel, /<VehicleCell/);
    assert.match(panel, /vinLast6: row\.vinLast6/);
    assert.match(panel, /view: "past", id: row\.id/);
    assert.match(panel, /Reserve A Car/);
    assert.match(panel, /No Reserved Vehicles/);
    assert.equal(/"Deposit"|Record Deposit|Deposit Off|>Booked</.test(panel), false);
  });

  it("lists a fee with no rental as not held, and stamps amount and due date onto a hold", () => {
    const held = { id: "rental-1", applicationId: "app-held" };
    const split = attachUnpaidReservationFees([held], [
      { id: "pay-held", applicationId: "app-held", rentalId: null, amount: 50, dueDate: "2026-11-20" },
      { id: "pay-waiting", applicationId: "app-waiting", rentalId: null, amount: 50, dueDate: "2026-11-24" },
      { id: "pay-dup", applicationId: "app-waiting", rentalId: null, amount: 50, dueDate: "2026-11-25" },
    ]);
    assert.equal(split.reservations[0].feeAmount, 50);
    assert.equal(split.reservations[0].feeDueDate, "2026-11-20");
    assert.equal(split.awaiting.length, 1);
    assert.equal(split.awaiting[0].applicationId, "app-waiting");
    assert.equal(unpaidReservationFeeDetail(50, "2026-11-24"), "Unpaid · $50 · Due Nov 24, 2026");
    assert.match(panel, /Fee Unpaid/);
    assert.match(panel, /awaiting-fee-row/);
    assert.match(panel, /Not Held/);
    assert.match(fn, /attachUnpaidReservationFees/);
    assert.match(fn, /loadUnpaidReservationFeePayments/);
  });

  it("server sends plate/VIN/thumbnail and only sends rate to managers", () => {
    assert.match(fn, /license_plate,vin/);
    assert.match(fn, /chooseVehicleThumbnailPaths/);
    assert.match(fn, /canSeeMoney \? \{ weeklyRate/);
    assert.match(fn, /\.eq\("status", RESERVATION_STATUS\)/);
  });
});
