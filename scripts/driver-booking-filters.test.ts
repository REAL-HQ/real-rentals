/**
 * Drivers Completed Booking / Cancelled Booking matching.
 * Run: bun test scripts/driver-booking-filters.test.ts
 */
import { describe, expect, test } from "bun:test";
import { PHASE_STATUSES, bookingOutcomeApplicationIds } from "../src/lib/bookings-list";

const DONE = "11111111-0000-4000-8000-0000000000aa";
const STOPPED = "22222222-0000-4000-8000-0000000000bb";
const BOTH = "33333333-0000-4000-8000-0000000000cc";

describe("booking outcome application ids", () => {
  test("uses the Bookings Completed and Cancelled status lists, and a driver can be in both", () => {
    const found = bookingOutcomeApplicationIds([
      { application_id: DONE, status: "ended" },
      { application_id: DONE, status: "completed" },
      { application_id: STOPPED, status: "cancelled" },
      { application_id: STOPPED, status: "canceled" },
      { application_id: BOTH, status: "returned" },
      { application_id: BOTH, status: "void" },
      { application_id: BOTH, status: "voided" },
      { application_id: "44444444-0000-4000-8000-0000000000dd", status: "closed" },
      { application_id: "55555555-0000-4000-8000-0000000000ee", status: "finished" },
      { application_id: "66666666-0000-4000-8000-0000000000ff", status: "active" },
      { application_id: "77777777-0000-4000-8000-000000000011", status: "reserved" },
      { application_id: "88888888-0000-4000-8000-000000000022", status: "pending" },
      { application_id: "99999999-0000-4000-8000-000000000033", status: "mystery" },
      { application_id: null, status: "ended" },
      { application_id: "   ", status: "cancelled" },
    ]);
    expect(new Set(found.completed)).toEqual(new Set([DONE, BOTH, "44444444-0000-4000-8000-0000000000dd", "55555555-0000-4000-8000-0000000000ee"]));
    expect(new Set(found.cancelled)).toEqual(new Set([STOPPED, BOTH]));
    expect(PHASE_STATUSES.completed).toEqual(["ended", "completed", "closed", "returned", "finished"]);
    expect(PHASE_STATUSES.cancelled).toEqual(["cancelled", "canceled", "void", "voided"]);
  });
});
