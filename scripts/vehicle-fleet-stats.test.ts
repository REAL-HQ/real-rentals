// Vehicles page inventory cards: totals, occupancy, utilization.
// Run: bun test scripts/vehicle-fleet-stats.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { summarizeVehicleFleetStats, ON_RENT_STATUS_FILTER } from "../src/lib/vehicles-list";

function row(id: string, status: string) {
  return { id, status };
}

describe("summarizeVehicleFleetStats", () => {
  it("matches today's 11-car fleet: 5 rented, 5 available, 1 maintenance, 45% utilization", () => {
    const vehicles = [
      row("1", "rented"),
      row("2", "available"),
      row("3", "available"),
      row("4", "available"),
      row("5", "available"),
      row("6", "rented"),
      row("7", "available"),
      row("8", "available"),
      row("9", "rented"),
      row("10", "maintenance"),
      row("11", "rented"),
    ];
    // Two of the "available" status rows are actually on a rental in the
    // screenshot case all five rented cars are on_rent; use the five ids
    // that display as Rented.
    const onRent = new Set(["1", "3", "6", "9", "11"]);
    // Adjust fixture: ids 1,6,9,11 plus one available-status car (3) on rent
    // would make available=5 only if the remaining available-status cars are 2,4,5,7,8.
    const stats = summarizeVehicleFleetStats(vehicles, onRent);
    expect(stats).toEqual({
      total: 11,
      archived: 0,
      rented: 5,
      available: 5,
      maintenance: 1,
      other: 0,
      utilizationPct: 45,
    });
  });

  it("counts an on-rent car as Rented even when status is still available", () => {
    const stats = summarizeVehicleFleetStats(
      [row("a", "available"), row("b", "available")],
      new Set(["a"]),
    );
    expect(stats.rented).toBe(1);
    expect(stats.available).toBe(1);
    expect(stats.utilizationPct).toBe(50);
  });

  it("includes archived vehicles in Total and excludes them from Utilization", () => {
    const stats = summarizeVehicleFleetStats(
      [row("a", "rented"), row("b", "available"), row("c", "archived")],
      new Set(["a"]),
      3,
    );
    expect(stats.total).toBe(3);
    expect(stats.archived).toBe(1);
    expect(stats.rented).toBe(1);
    expect(stats.available).toBe(1);
    // 1 rented / 2 unarchived = 50%, not 1/3.
    expect(stats.utilizationPct).toBe(50);
  });

  it("reports no utilization when every vehicle is archived", () => {
    const stats = summarizeVehicleFleetStats([row("a", "archived")], new Set());
    expect(stats.total).toBe(1);
    expect(stats.archived).toBe(1);
    expect(stats.rented).toBe(0);
    expect(stats.utilizationPct).toBeNull();
  });

  it("uses the exact table count when it is passed in", () => {
    const stats = summarizeVehicleFleetStats([row("a", "available")], new Set(), 11);
    expect(stats.total).toBe(11);
    expect(stats.available).toBe(1);
  });
});

describe("Vehicles and Drivers wiring", () => {
  const vehiclesPanel = readFileSync("src/components/admin/VehiclesPanel.tsx", "utf8");
  const vehiclesFn = readFileSync("src/lib/vehicles-list.functions.ts", "utf8");
  const drivers = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
  const overview = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");

  it("puts the stat cards above the Vehicles toolbar and keeps Add Vehicle", () => {
    const cards = vehiclesPanel.indexOf('data-testid="vehicle-stat-cards"');
    const toolbar = vehiclesPanel.indexOf("<AdminToolbar");
    const add = vehiclesPanel.indexOf("> Add Vehicle");
    expect(cards).toBeGreaterThanOrEqual(0);
    expect(toolbar).toBeGreaterThan(cards);
    expect(add).toBeGreaterThan(toolbar);
    expect(vehiclesPanel).toContain('label="Total"');
    expect(vehiclesPanel).toContain('label="Rented"');
    expect(vehiclesPanel).toContain('label="Available"');
    expect(vehiclesPanel).toContain('label="Maintenance"');
    expect(vehiclesPanel).toContain('label="Utilization"');
    expect(vehiclesPanel).toContain("Including archived");
    expect(vehiclesPanel).toContain("Of unarchived");
    expect(vehiclesPanel).toContain('onClick={() => setList({ status: "all" })}');
    expect(vehiclesPanel).toContain("setList({ status: ON_RENT_STATUS_FILTER })");
    expect(vehiclesPanel).toContain('setList({ status: "available" })');
    expect(vehiclesPanel).toContain('setList({ status: "maintenance" })');
    // Utilization is a readout, not a status filter.
    const util = vehiclesPanel.slice(vehiclesPanel.indexOf('label="Utilization"'), vehiclesPanel.indexOf("<AdminToolbar"));
    expect(util).not.toContain("onClick");
  });

  it("filters Rented by live occupancy and returns fleet-wide stats", () => {
    expect(vehiclesFn).toContain("ON_RENT_STATUS_FILTER");
    expect(vehiclesFn).toContain("summarizeVehicleFleetStats");
    expect(vehiclesFn).toContain("fleetStats");
    expect(ON_RENT_STATUS_FILTER).toBe("on_rent");
  });

  it("sends Active Renters to Drivers with filter=active, which the list honors from the URL", () => {
    expect(overview).toContain('search={{ tab: "drivers", filter: "active" }}');
    expect(drivers).toContain('urlFilter === "active"');
    expect(drivers).toContain('filter: "active"');
    expect(drivers).toContain("to: \"/admin\", search: { tab: \"drivers\", filter: \"active\" }");
  });
});
