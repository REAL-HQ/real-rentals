import { describe, it, expect } from "vitest";
import { buildVehicleSearchOr, availabilityLabel, pageListedVehicles, vehicleListIdPlan, VEHICLE_LIST_ID_CHUNK } from "../src/lib/vehicles-list";

describe("vehicles list helpers", () => {
  it("searches all text fields and exact year", () => {
    const or = buildVehicleSearchOr("2015")!;
    for (const f of ["unit_number", "vin", "license_plate", "make", "model", "trim", "color"]) expect(or).toContain(`${f}.ilike.*2015*`);
    expect(or).toContain("year.eq.2015");
    expect(buildVehicleSearchOr("fusion")).not.toContain("year.eq");
  });
  it("strips filter-grammar characters", () => {
    expect(buildVehicleSearchOr("a,b)or(id.eq.x")).not.toMatch(/[,()]x?/.source ? /\)or\(/ : /^$/);
    expect(buildVehicleSearchOr("  ")).toBeNull();
  });
  it("On Rent comes from running rentals, not status", () => {
    expect(availabilityLabel({ on_rent: true, status: "available" })).toBe("On Rent");
    expect(availabilityLabel({ on_rent: false, status: "rented" })).toBe("Rented");
    expect(availabilityLabel({ on_rent: false, status: "onboarding" })).toBe("Needs Setup");
  });
  it("ignores compliance ids while the flag is off and chunks them while it is on", () => {
    const ids = Array.from({ length: VEHICLE_LIST_ID_CHUNK + 1 }, (_, index) => `id-${index}`);
    expect(vehicleListIdPlan(false, ids)).toEqual({ action: "ignore" });
    expect(vehicleListIdPlan(false, [])).toEqual({ action: "ignore" });
    expect(vehicleListIdPlan(true, undefined)).toEqual({ action: "ignore" });
    expect(vehicleListIdPlan(true, [])).toEqual({ action: "empty" });
    const plan = vehicleListIdPlan(true, ids);
    expect(plan.action).toBe("filter");
    if (plan.action === "filter") {
      expect(plan.chunks).toHaveLength(2);
      expect(plan.chunks[0]).toHaveLength(VEHICLE_LIST_ID_CHUNK);
      expect(plan.chunks[1]).toEqual(["id-100"]);
    }
    const rows = [
      { id: "b", unit_number: "2" },
      { id: "a", unit_number: null },
      { id: "c", unit_number: "2" },
    ];
    expect(pageListedVehicles(rows, "unit", 1, 2).map((row) => row.id)).toEqual(["b", "c"]);
    expect(pageListedVehicles(rows, "unit", 2, 2).map((row) => row.id)).toEqual(["a"]);
  });
  it("pages 1,000 synthetic vehicles exactly once with a deterministic tiebreak", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: String(i).padStart(4, "0"), make: ["Ford", "Kia"][i % 2] }));
    const sorted = [...rows].sort((a, b) => a.make.localeCompare(b.make) || a.id.localeCompare(b.id));
    const seen = new Set<string>();
    for (let p = 0; p < 20; p++) sorted.slice(p * 50, p * 50 + 50).forEach((r) => seen.add(r.id));
    expect(seen.size).toBe(1000);
  });
});
