import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DEFAULT_RESERVATION_DEPOSIT_SETTINGS,
  RESERVATION_DEPOSIT_SETTINGS_KEY,
  readReservationDepositSettings,
  resolveReservationDeposit,
  writeReservationDepositSettings,
} from "../src/lib/reservation-deposit-settings.ts";
import {
  isReservationStatus,
  normalizeReservationNote,
  reservationBlocksStart,
  reservationPickupDate,
  RESERVATION_STATUS,
} from "../src/lib/reservations.ts";
import { parseBookingsView } from "../src/lib/bookings-workspace.ts";
import { LEGACY_TABS, visibleTabs, railEntries } from "../src/components/admin/nav-config.ts";
import { AUTOMATIONS } from "../src/lib/automation-catalog.ts";
import { nextStep } from "../src/lib/next-step.ts";

describe("reservation deposit settings", () => {
  it("defaults Off with amount 0 and does not block Start Rental", () => {
    assert.deepEqual(readReservationDepositSettings(null), DEFAULT_RESERVATION_DEPOSIT_SETTINGS);
    assert.deepEqual(readReservationDepositSettings(undefined), DEFAULT_RESERVATION_DEPOSIT_SETTINGS);
    assert.equal(DEFAULT_RESERVATION_DEPOSIT_SETTINGS.enabled, false);
    assert.equal(DEFAULT_RESERVATION_DEPOSIT_SETTINGS.blockStartWhenPending, false);
    assert.equal(RESERVATION_DEPOSIT_SETTINGS_KEY, "reservation_deposit");
  });

  it("reads and writes the app_settings shape", () => {
    const s = readReservationDepositSettings({
      enabled: true,
      default_amount: 150.5,
      block_start_when_pending: true,
    });
    assert.deepEqual(s, { enabled: true, defaultAmount: 150.5, blockStartWhenPending: true });
    assert.deepEqual(writeReservationDepositSettings(s), {
      enabled: true,
      default_amount: 150.5,
      block_start_when_pending: true,
    });
  });

  it("resolves per-booking overrides against the global default", () => {
    const on = { enabled: true, defaultAmount: 200, blockStartWhenPending: false };
    assert.deepEqual(resolveReservationDeposit({ settings: on }), {
      required: true,
      amount: 200,
      status: "pending",
    });
    assert.deepEqual(resolveReservationDeposit({ settings: on, overrideRequired: false }), {
      required: false,
      amount: 0,
      status: "not_required",
    });
    assert.deepEqual(resolveReservationDeposit({ settings: on, overrideAmount: 75 }), {
      required: true,
      amount: 75,
      status: "pending",
    });
    assert.deepEqual(
      resolveReservationDeposit({ settings: DEFAULT_RESERVATION_DEPOSIT_SETTINGS, overrideRequired: true, overrideAmount: 0 }),
      { required: false, amount: 0, status: "not_required" },
    );
  });

  it("only blocks Start Rental when the setting says so and deposit is pending", () => {
    assert.equal(reservationBlocksStart({ depositStatus: "pending", blockStartWhenPending: false }), false);
    assert.equal(reservationBlocksStart({ depositStatus: "pending", blockStartWhenPending: true }), true);
    assert.equal(reservationBlocksStart({ depositStatus: "paid", blockStartWhenPending: true }), false);
  });
});

describe("reservation helpers", () => {
  it("accepts reserved status and real calendar dates", () => {
    assert.equal(RESERVATION_STATUS, "reserved");
    assert.equal(isReservationStatus("reserved"), true);
    assert.equal(isReservationStatus("active"), false);
    assert.equal(reservationPickupDate("2026-11-15"), "2026-11-15");
    assert.equal(reservationPickupDate("2026-13-01"), null);
    assert.equal(normalizeReservationNote("  hi  "), "hi");
    assert.equal(normalizeReservationNote("   "), null);
  });
});

describe("bookings workspace + nav", () => {
  it("defaults to Active for managers and Past when a rental id is open", () => {
    assert.equal(parseBookingsView(undefined, { canViewBoard: true }), "active");
    assert.equal(parseBookingsView("booked", { canViewBoard: true }), "booked");
    assert.equal(parseBookingsView("past", { canViewBoard: true }), "past");
    assert.equal(parseBookingsView(undefined, { canViewBoard: true, openId: "r1" }), "past");
    assert.equal(parseBookingsView(undefined, { canViewBoard: false }), "past");
  });

  it("shows Bookings on the rail and redirects Active Rentals", () => {
    assert.ok(visibleTabs("coordinator").some((t) => t.id === "bookings" && t.label === "Bookings"));
    assert.ok(railEntries("manager").some((t) => t.id === "bookings"));
    assert.ok(!visibleTabs("owner").some((t) => t.id === "active_rentals"));
    assert.deepEqual(LEGACY_TABS.active_rentals, { tab: "bookings" });
  });
});

describe("Booking Login Email + Reserve Car next step", () => {
  it("catalogues Booking Login Email default On", () => {
    const row = AUTOMATIONS.find((a) => a.key === "booking_login_email");
    assert.ok(row);
    assert.equal(row?.title, "Booking Login Email");
    assert.equal(row?.defaultOn, undefined);
    assert.deepEqual(row?.emailWorkflows, ["portal_invite"]);
  });

  it("offers Reserve Car after approval when ready and no reservation yet", () => {
    const readiness = {
      ok: true as const,
      requirements: [],
      canActivate: true,
      softWarnings: [],
      hardBlockers: [],
    };
    // Minimal readiness shape — nextStep only filters requirements.
    const m = nextStep({
      step: "activate",
      entry: "enabled",
      readiness: { requirements: [] } as any,
      loading: false,
      failed: false,
      canReserve: true,
      hasReservation: false,
    });
    assert.equal(m.target.kind, "reserve");
    assert.equal(m.label, "Reserve Car");
    const kept = nextStep({
      step: "activate",
      entry: "enabled",
      readiness: { requirements: [] } as any,
      loading: false,
      failed: false,
      canReserve: false,
    });
    assert.equal(kept.target.kind, "activate");
  });
});

describe("migration + server source guards", () => {
  it("keeps reservation deposit columns in the unapplied migration and never charges Stripe", () => {
    const mig = readFileSync("supabase/migrations/20261109220000_rental_reservations.sql", "utf8");
    assert.match(mig, /reservation_deposit_required/);
    assert.match(mig, /reservation_deposit_amount/);
    assert.match(mig, /reservation_deposit_status/);
    assert.match(mig, /reservation_deposit_payment_id/);
    assert.match(mig, /DO NOT apply to production/i);
    assert.match(mig, /"enabled":false/);
    const fn = readFileSync("src/lib/reservations.functions.ts", "utf8");
    assert.match(fn, /recordReservationDeposit/);
    assert.match(fn, /stripeReservationDepositHook/);
    assert.equal(fn.includes("buy.stripe.com"), false);
    assert.match(fn, /booking_login_email/);
    assert.match(fn, /maybeSendBookingLoginEmail/);
  });
});
