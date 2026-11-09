import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PAST_STATUS_VALUES,
  PHASE_STATUSES,
  bookingPhase,
  isPastPhase,
  statusesForBookingList,
} from "../src/lib/bookings-list.ts";

describe("Past tab status filter", () => {
  it("maps rental statuses into past vs active vs reserved", () => {
    assert.equal(bookingPhase("active"), "active");
    assert.equal(bookingPhase("ended"), "completed");
    assert.equal(bookingPhase("cancelled"), "cancelled");
    assert.equal(bookingPhase("reserved"), "reserved");
    assert.equal(isPastPhase("completed"), true);
    assert.equal(isPastPhase("cancelled"), true);
    assert.equal(isPastPhase("active"), false);
    assert.equal(isPastPhase("reserved"), false);
  });

  it("Past scope never includes active or reserved statuses", () => {
    const allPast = statusesForBookingList({ scope: "past", phase: "all" });
    assert.ok(allPast);
    assert.deepEqual([...allPast!].sort(), [...PAST_STATUS_VALUES].sort());
    assert.ok(!allPast!.includes("active"));
    assert.ok(!allPast!.includes("reserved"));
    assert.ok(allPast!.includes("ended"));
    assert.ok(allPast!.includes("cancelled"));

    const completed = statusesForBookingList({ scope: "past", phase: "completed" });
    assert.deepEqual(completed, PHASE_STATUSES.completed);

    const cancelled = statusesForBookingList({ scope: "past", phase: "cancelled" });
    assert.deepEqual(cancelled, PHASE_STATUSES.cancelled);

    // A leftover ?phase=active under Past still stays ended/cancelled only.
    const mistyped = statusesForBookingList({ scope: "past", phase: "active" });
    assert.deepEqual([...mistyped!].sort(), [...PAST_STATUS_VALUES].sort());
  });

  it("legacy all/active scopes still work for other callers", () => {
    assert.equal(statusesForBookingList({ scope: "all", phase: "all" }), null);
    assert.deepEqual(statusesForBookingList({ scope: "all", phase: "active" }), ["active"]);
  });

  it("Past tab passes scope=past and Active table drops the 1020px min-width", () => {
    const workspace = readFileSync("src/components/admin/BookingsWorkspace.tsx", "utf8");
    assert.match(workspace, /scope="past"/);
    assert.match(workspace, /ReservationsPanel/);
    assert.match(workspace, /ActiveRentalsPanel/);

    const panel = readFileSync("src/components/admin/BookingsPanel.tsx", "utf8");
    assert.match(panel, /scope === "past"/);
    assert.match(panel, /No Past Rentals/);
    assert.match(panel, /scope,/);

    const fn = readFileSync("src/lib/bookings.functions.ts", "utf8");
    assert.match(fn, /statusesForBookingList/);
    assert.match(fn, /scope === "past"/);

    const active = readFileSync("src/components/admin/ActiveRentalsPanel.tsx", "utf8");
    assert.doesNotMatch(active, /min-w-\[1020px\]/);
    assert.match(active, /table-fixed/);
    assert.match(active, /isAbortError/);
  });
});
