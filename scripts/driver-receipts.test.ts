import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DRIVER_RECEIPTS_ENABLED,
  assertDriverReceiptsEnabled,
  buildDriverReceipts,
  formatReceiptDate,
  isPastPayment,
  type ReceiptContext,
  type ReceiptPayment,
} from "../src/lib/driver-receipts";

const context = (partial: Partial<ReceiptContext> = {}): ReceiptContext => ({
  driverName: "Ada Lovelace",
  vehiclesReadable: true,
  vehicles: [{ id: "veh-1", year: 2022, make: "Toyota", model: "Camry", license_plate: "ABC123" }],
  rentalsReadable: true,
  rentals: [{ id: "rent-1", start_date: "2026-10-01", end_date: "2026-10-08", vehicle_id: "veh-1" }],
  ...partial,
});

function payment(partial: Partial<ReceiptPayment> = {}): ReceiptPayment {
  return {
    id: "pay-1",
    paid_date: "2026-10-08",
    amount: 250,
    type: "rent",
    status: "paid",
    rental_id: "rent-1",
    vehicle_id: "veh-1",
    ...partial,
  };
}

describe("driver receipts flag", () => {
  it("is off and the guard refuses", () => {
    assert.equal(DRIVER_RECEIPTS_ENABLED, false);
    assert.throws(() => assertDriverReceiptsEnabled(), /Driver receipts are not enabled/);
  });

  it("throws in the handler before the portal scope and before any table read", () => {
    const source = readFileSync("src/lib/driver-receipts.functions.ts", "utf8");
    const handler = source.slice(source.indexOf(".handler("));
    const guard = handler.indexOf("assertDriverReceiptsEnabled()");
    const scoped = handler.indexOf("await scope(");
    const read = handler.indexOf('.from("');
    assert.ok(guard !== -1 && scoped !== -1 && guard < scoped && scoped < read);
    assert.match(source, /portalScope/);
    assert.doesNotMatch(source, /supabaseAdmin|stripe|\.insert\(|\.update\(|\.delete\(|app_settings/);
    const lib = readFileSync("src/lib/driver-receipts.ts", "utf8");
    assert.match(lib, /COMPANY_DEFAULTS\.company_name/);
    assert.doesNotMatch(lib, /missing\.push\("Business Name"\)/);
    const portal = readFileSync("src/routes/portal.tsx", "utf8");
    assert.match(portal, /DRIVER_RECEIPTS_ENABLED \? <DriverReceiptsGate/);
    assert.match(portal, /usePortalRead\(getDriverReceipts\)/);
    const card = readFileSync("src/components/portal/DriverReceipts.tsx", "utf8");
    assert.match(card, /window\.print\(\)/);
    assert.doesNotMatch(card, /stripe|loadStripe|payRentalBalance/);
  });
});

describe("driver receipts", () => {
  it("formats a calendar date as stored and a timestamp in Eastern Time", () => {
    assert.equal(formatReceiptDate("2026-10-21"), "Oct 21, 2026");
    assert.equal(formatReceiptDate("2026-10-21T03:30:00.000Z"), "Oct 20, 2026");
    assert.equal(formatReceiptDate(null), null);
  });

  it("lists a past payment and leaves an open balance off", () => {
    assert.equal(isPastPayment({ status: "paid", paid_date: null }), true);
    assert.equal(isPastPayment({ status: "current", paid_date: null }), false);
    const receipts = buildDriverReceipts(
      [payment(), payment({ id: "open", status: "upcoming", paid_date: null, amount: 999 })],
      context(),
    );
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]?.date, "Oct 8, 2026");
    assert.equal(receipts[0]?.amount, "$250.00");
    assert.equal(receipts[0]?.purpose, "Rent");
    assert.equal(receipts[0]?.status, "Paid");
    assert.equal(receipts[0]?.businessName, "REAL RENTALS");
    assert.equal(receipts[0]?.driverName, "Ada Lovelace");
    assert.equal(receipts[0]?.vehicle, "2022 Toyota Camry · ABC123");
    assert.equal(receipts[0]?.period, "Oct 1, 2026 – Oct 8, 2026");
    assert.deepEqual(receipts[0]?.missing, []);
  });

  it("omits a field it could not read and names it", () => {
    const receipts = buildDriverReceipts(
      [payment({ paid_date: null, vehicle_id: null, rental_id: null, type: null })],
      context({ driverName: null, vehiclesReadable: false, rentalsReadable: false }),
    );
    assert.equal(receipts[0]?.businessName, "REAL RENTALS");
    assert.equal(receipts[0]?.date, null);
    assert.equal(receipts[0]?.vehicle, null);
    assert.equal(receipts[0]?.period, null);
    assert.deepEqual(receipts[0]?.missing, [
      "Driver",
      "Date",
      "What It Was For",
      "Vehicle",
      "Period",
    ]);
  });

  it("keeps an open-ended rental period without inventing an end date", () => {
    const receipts = buildDriverReceipts(
      [payment({ vehicle_id: null })],
      context({
        rentals: [{ id: "rent-1", start_date: "2026-09-01", end_date: null, vehicle_id: "veh-1" }],
      }),
    );
    assert.equal(receipts[0]?.period, "From Sep 1, 2026");
    assert.equal(receipts[0]?.vehicle, "2022 Toyota Camry · ABC123");
    assert.equal(receipts[0]?.missing.includes("Period"), false);
  });
});
