import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY_PORTAL_MY_RENTAL,
  PORTAL_MY_RENTAL_ENABLED,
  assertPortalMyRentalEnabled,
  portalMyRental,
} from "../src/lib/portal-my-rental";

describe("portal my rental", () => {
  it("shows the active rental fields and nothing else", () => {
    const card = portalMyRental(
      { start_date: "2026-09-01", next_payment_due: "2026-10-28", weekly_rate: "350.00" },
      { year: 2022, make: "Toyota", model: "Camry" },
    );
    assert.deepEqual(card, {
      active: true,
      year: 2022,
      make: "Toyota",
      model: "Camry",
      startDate: "2026-09-01",
      nextPaymentDue: "2026-10-28",
      weeklyAmount: 350,
    });
    assert.equal("plate" in card, false);
  });

  it("shows nothing when there is no active rental", () => {
    assert.deepEqual(portalMyRental(null, { year: 2022, make: "Toyota", model: "Camry" }), EMPTY_PORTAL_MY_RENTAL);
    assert.equal(EMPTY_PORTAL_MY_RENTAL.active, false);
  });

  it("keeps an active rental when the vehicle projection or a date is missing", () => {
    const card = portalMyRental(
      { start_date: "2026-09-01", next_payment_due: null, weekly_rate: 0 },
      null,
    );
    assert.equal(card.active, true);
    assert.equal(card.year, null);
    assert.equal(card.make, null);
    assert.equal(card.model, null);
    assert.equal(card.nextPaymentDue, null);
    assert.equal(card.weeklyAmount, 0);
    assert.equal(card.startDate, "2026-09-01");
  });

  it("drops a weekly amount that is not a number", () => {
    const card = portalMyRental(
      { start_date: "2026-09-01", next_payment_due: "2026-10-28", weekly_rate: "nope" },
      { year: null, make: "Honda", model: "Civic" },
    );
    assert.equal(card.weeklyAmount, null);
    assert.equal(card.make, "Honda");
  });
});

describe("portal my rental flag", () => {
  it("is off and the guard refuses", () => {
    assert.equal(PORTAL_MY_RENTAL_ENABLED, false);
    assert.throws(() => assertPortalMyRentalEnabled(), /not enabled/);
  });

  it("refuses in the server handler before any role lookup or query", () => {
    const src = readFileSync("src/lib/portal-my-rental.functions.ts", "utf8");
    const handler = src.slice(src.indexOf("handler(async"));
    const assertAt = handler.indexOf("assertPortalMyRentalEnabled");
    const scopeAt = handler.indexOf("portalScope");
    const queryAt = handler.indexOf(".from(");
    assert.ok(assertAt >= 0, "handler asserts the flag");
    assert.ok(scopeAt > assertAt, "flag check precedes portal scope");
    assert.ok(queryAt > assertAt, "flag check precedes queries");
    assert.match(handler, /\.eq\("driver_id", userId\)/);
    assert.match(handler, /\.eq\("status", "active"\)/);
    assert.match(handler, /\.from\("vehicles_public"\)/);
    assert.match(handler, /\.select\("year,make,model"\)/);
    assert.match(handler, /\.select\("start_date,next_payment_due,weekly_rate,vehicle_id,status"\)/);
    assert.doesNotMatch(src, /supabaseAdmin|\.from\("vehicles"\)|license_plate|stripe|payRental|\.insert\(|\.update\(|\.delete\(/);
  });

  it("does not call the read while the flag is off", () => {
    const portal = readFileSync("src/routes/portal.tsx", "utf8");
    assert.match(portal, /enabled: PORTAL_MY_RENTAL_ENABLED === true/);
    assert.match(portal, /if \(PORTAL_MY_RENTAL_ENABLED !== true\) return null/);
  });

  it("renders a read-only card that uses the business phone", () => {
    const card = readFileSync("src/components/portal/MyRentalCard.tsx", "utf8");
    assert.match(card, /useBusinessPhone/);
    assert.match(card, /My Rental/);
    assert.doesNotMatch(card, /stripe|payRental|usePortalWrite|type=["']file["']|license_plate/);
  });
});
