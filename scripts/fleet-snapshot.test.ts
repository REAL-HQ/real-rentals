// Fleet Snapshot slices account for every working-fleet car.
// Run: bun test scripts/fleet-snapshot.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { VEHICLE_STATUSES } from "../src/lib/vehicles.functions";
import { summarizeVehicleFleetStats } from "../src/lib/vehicles-list";
import {
  FLEET_SNAPSHOT_COLORS,
  INACTIVE_VEHICLE_STATUSES,
  fleetSnapshotSlices,
  summarizeFleet,
  summarizeFleetOccupancy,
  type FleetSummary,
} from "../src/lib/fleet-summary";

const COUNTED = ["needsSetup", "available", "reserved", "rented", "maintenance", "unavailable", "forSale", "other"] as const;

function counted(summary: FleetSummary): number {
  return COUNTED.reduce((sum, key) => sum + summary[key], 0);
}

const SNAPSHOT_PALETTE = ["#4CD964", "#FFCC33", "#C7C7CC", "#FF3B30", "#007AFF"] as const;

function expectPartition(summary: FleetSummary) {
  const slices = fleetSnapshotSlices(summary);
  expect(counted(summary)).toBe(summary.total);
  expect(slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(summary.total);
  expect(new Set(slices.map((slice) => slice.key)).size).toBe(slices.length);
  for (const slice of slices) expect(SNAPSHOT_PALETTE).toContain(slice.color);
}

function car(id: string, status: string, archived_at: string | null = null) {
  return { id, status, archived_at };
}

describe("fleet snapshot categories", () => {
  it("shows the reported 11-car fleet, including 2 Unavailable, and keeps utilization", () => {
    const rentedIds = ["r1", "r2", "r3", "r4"];
    const working = [
      ...rentedIds.map((id) => car(id, "rented")),
      ...["a1", "a2", "a3", "a4"].map((id) => car(id, "available")),
      car("m1", "maintenance"),
      car("u1", "unavailable"),
      car("u2", "unavailable"),
    ];
    const beforeUnavailable = summarizeFleetOccupancy(
      working.filter((row) => row.status !== "unavailable"),
      rentedIds,
    );
    const snapshot = summarizeFleetOccupancy(working, rentedIds);

    expect(snapshot.total).toBe(11);
    expect(snapshot.rented).toBe(4);
    expect(snapshot.reserved).toBe(0);
    expect(snapshot.available).toBe(4);
    expect(snapshot.maintenance).toBe(1);
    expect(snapshot.needsSetup).toBe(0);
    expect(snapshot.unavailable).toBe(2);
    expect(snapshot.forSale).toBe(0);
    expect(snapshot.other).toBe(0);
    expectPartition(snapshot);

    // Unavailable is not rentable, so the utilization denominator stays 8.
    expect(snapshot.rentable).toBe(8);
    expect(snapshot.utilizationPct).toBe(50);
    expect(snapshot.rentable).toBe(beforeUnavailable.rentable);
    expect(snapshot.utilizationPct).toBe(beforeUnavailable.utilizationPct);
    expect(snapshot.total).toBe(beforeUnavailable.total + 2);

    const slices = Object.fromEntries(fleetSnapshotSlices(snapshot).map((slice) => [slice.key, slice]));
    expect(slices.rented).toMatchObject({ label: "Rented", color: "#4CD964" });
    expect(slices.reserved).toMatchObject({ label: "Reserved", color: "#FFCC33" });
    expect(slices.available).toMatchObject({ label: "Available", color: "#C7C7CC" });
    expect(slices.maintenance).toMatchObject({ label: "Maintenance", value: 1, color: "#FF3B30" });
    expect(slices.setup).toMatchObject({ label: "Needs Setup", color: "#FF3B30" });
    expect(slices.unavailable).toMatchObject({ label: "Unavailable", value: 2, color: "#FF3B30" });
    expect(slices.for_sale).toMatchObject({ label: "For Sale", value: 0, color: "#007AFF" });
    expect(slices.other).toMatchObject({ label: "Other", color: "#C7C7CC" });
    expect(slices.maintenance.color).toBe(slices.unavailable.color);
    expect(slices.setup.color).toBe(slices.unavailable.color);
    expect(slices.other.color).toBe(slices.available.color);
    expect(slices.maintenance.color).not.toBe(slices.reserved.color);
    expect(FLEET_SNAPSHOT_COLORS).toEqual({
      rented: "#4CD964",
      reserved: "#FFCC33",
      available: "#C7C7CC",
      maintenance: "#FF3B30",
      setup: "#FF3B30",
      unavailable: "#FF3B30",
      forSale: "#007AFF",
      other: "#C7C7CC",
    });
    expect(new Set(Object.values(FLEET_SNAPSHOT_COLORS)).size).toBe(5);
  });

  it("keeps archived, sold, and retired cars out of the snapshot total", () => {
    const rows = [
      car("ready", "available"),
      car("blocked", "unavailable"),
      car("shelf", "archived"),
      car("sold", "sold"),
      car("retired", "retired"),
      car("stamped", "available", "2026-01-01"),
      car("odd", "in_transit"),
    ];
    const snapshot = summarizeFleetOccupancy(rows, []);
    expect(snapshot.total).toBe(3);
    expect(snapshot.available).toBe(1);
    expect(snapshot.unavailable).toBe(1);
    expect(snapshot.other).toBe(1);
    expectPartition(snapshot);

    const page = summarizeVehicleFleetStats(rows, new Set());
    expect(page.total).toBe(rows.length);
    expect(page.archived).toBe(1);
    expect(page.total).toBeGreaterThan(snapshot.total);
  });

  it("puts every settable status in one slice, or outside the working fleet", () => {
    for (const { value } of VEHICLE_STATUSES) {
      const snapshot = summarizeFleet([{ status: value }]);
      expectPartition(snapshot);
      const inactive = (INACTIVE_VEHICLE_STATUSES as readonly string[]).includes(value);
      expect(snapshot.total).toBe(inactive ? 0 : 1);
      expect(snapshot.other).toBe(0);
    }
  });

  it("sends a status with no category to Other, including blank status", () => {
    const snapshot = summarizeFleet([{ status: "in_transit" }, { status: null }, { status: "" }, { status: "Unavailable" }]);
    expect(snapshot.total).toBe(4);
    expect(snapshot.unavailable).toBe(1);
    expect(snapshot.other).toBe(3);
    expectPartition(snapshot);
  });

  it("counts an Unavailable car on an active rental once, as Rented", () => {
    const snapshot = summarizeFleetOccupancy(
      [car("u1", "unavailable"), car("u2", "unavailable"), car("shop", "maintenance")],
      ["u1"],
    );
    expect(snapshot.rented).toBe(1);
    expect(snapshot.unavailable).toBe(1);
    expect(snapshot.maintenance).toBe(1);
    expect(snapshot.total).toBe(3);
    expect(snapshot.mismatches).toEqual([
      { vehicleId: "u1", status: "unavailable", kind: "active_without_rented_status" },
    ]);
    expect(snapshot.utilizationPct).toBe(100);
    expectPartition(snapshot);
  });

  it("wires the Overview donut and legend to the same slices, scaled to the total", () => {
    const overview = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
    expect(overview).toContain("const fleetSlices = fleetSnapshotSlices(fleet)");
    expect(overview).toContain("<SegmentedDonut total={total} segments={fleetSlices} />");
    expect(overview).toContain("{fleetSlices.map((s) => (");
    expect(overview).toContain("const denom = total > 0 ? total : 1");
    expect(overview).toContain("(s.value / denom)");
    expect(overview).not.toContain('label: "Maintenance", value: maintOpen, color: "#FF3B30"');
  });
});
