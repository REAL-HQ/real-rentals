import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PUBLIC_AVAILABILITY_DATE_COLUMN,
  PUBLIC_AVAILABILITY_ENABLED,
  formatAvailabilityDate,
  isAvailableNow,
  publicAvailability,
} from "../src/lib/public-availability";

function fromCalls(source: string): string[] {
  return [...source.matchAll(/\.from\("vehicles_public"\)/g)].map((match) => match[0]);
}

describe("public availability flag", () => {
  it("is off", () => {
    assert.equal(PUBLIC_AVAILABILITY_ENABLED, false);
  });

  it("does not add a vehicles_public query, and the new UI is gated", () => {
    const fleet = readFileSync("src/routes/fleet.index.tsx", "utf8");
    const detail = readFileSync("src/routes/fleet.$id.tsx", "utf8");
    const home = readFileSync("src/routes/index.tsx", "utf8");
    assert.equal(fromCalls(fleet).length, 1);
    assert.equal(fromCalls(detail).length, 2);
    assert.equal(fromCalls(home).length, 1);
    for (const source of [fleet, detail, home]) {
      const queryAt = source.indexOf('.from("vehicles_public")');
      const flagAt = source.indexOf("PUBLIC_AVAILABILITY_ENABLED");
      assert.ok(queryAt !== -1);
      if (flagAt !== -1) assert.ok(queryAt < flagAt || !source.slice(queryAt, queryAt + 400).includes("PUBLIC_AVAILABILITY"));
    }
    assert.match(fleet, /PUBLIC_AVAILABILITY_ENABLED \? <FleetAvailabilityCar/);
    assert.match(fleet, /PUBLIC_AVAILABILITY_ENABLED && availableOnly/);
    assert.match(fleet, /: <InventoryVehicleCard vehicle=\{v\} \/>/);
    assert.match(detail, /PUBLIC_AVAILABILITY_ENABLED \? \(/);
    assert.doesNotMatch(`${fleet}\n${detail}`, /supabaseAdmin|stripe|\.insert\(|\.update\(|\.delete\(|from\("vehicles"\)|from\("rentals"\)/);
    const badge = readFileSync("src/components/site/PublicAvailability.tsx", "utf8");
    assert.match(badge, /min-h-11/);
    assert.match(badge, /Show Available Only/);
    assert.doesNotMatch(badge, /supabase|\.from\(/);
  });
});

describe("public availability badges", () => {
  it("reads available and rented from status, and soon has no date without available_on", () => {
    assert.deepEqual(publicAvailability({ status: "available" }), {
      kind: "now",
      label: "Available Now",
      date: null,
      missing: [],
    });
    assert.deepEqual(publicAvailability({ status: "rented" }), {
      kind: "rented",
      label: "Currently Rented",
      date: null,
      missing: [],
    });
    const soon = publicAvailability({ status: "maintenance" });
    assert.equal(soon.kind, "soon");
    assert.equal(soon.label, "Available Soon");
    assert.equal(soon.date, null);
    assert.deepEqual(soon.missing, [PUBLIC_AVAILABILITY_DATE_COLUMN]);
    assert.equal(PUBLIC_AVAILABILITY_DATE_COLUMN, "available_on");
    assert.equal(isAvailableNow({ status: "reserved" }), false);
    assert.equal(isAvailableNow({ status: "available" }), true);
  });

  it("shows a date only when the row already carries available_on", () => {
    assert.equal(formatAvailabilityDate("2026-11-02"), "Nov 2, 2026");
    assert.equal(formatAvailabilityDate("2026-10-21T03:30:00.000Z"), "Oct 20, 2026");
    const dated = publicAvailability({ status: "reserved", available_on: "2026-11-02" });
    assert.equal(dated.label, "Available Soon");
    assert.equal(dated.date, "Nov 2, 2026");
    assert.deepEqual(dated.missing, []);
    const rented = publicAvailability({ status: "rented", available_on: "2026-11-02" });
    assert.equal(rented.label, "Currently Rented");
    assert.equal(rented.date, null);
  });
});
