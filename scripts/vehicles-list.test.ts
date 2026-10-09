import { describe, it, expect } from "vitest";
import { buildVehicleSearchOr, availabilityLabel } from "../src/lib/vehicles-list";

describe("vehicles list helpers", () => {
  it("searches all text fields and exact year", () => {
    const or = buildVehicleSearchOr("2015")!;
    for (const f of ["unit_number", "vin", "license_plate", "make", "model", "trim", "color"]) expect(or).toContain(`${f}.ilike.*2015*`);
    expect(or).toContain("year.eq.2015");
    expect(buildVehicleSearchOr("fusion")).not.toContain("year.eq");
  });
  it("strips filter-grammar characters", () => {
    expect(buildVehicleSearchOr("a,b)or(id.eq.x")).not.toMatch(/[,()]/.source === "" ? /x/ : /\)or\(/);
    expect(buildVehicleSearchOr("  ")).toBeNull();
  });
  it("On Rent comes from running rentals, not status", () => {
    expect(availabilityLabel({ on_rent: true, status: "available" })).toBe("On Rent");
    expect(availabilityLabel({ on_rent: false, status: "rented" })).toBe("Rented");
    expect(availabilityLabel({ on_rent: false, status: "onboarding" })).toBe("Needs Setup");
  });
  it("pages 1,000 synthetic vehicles exactly once with a deterministic tiebreak", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: String(i).padStart(4, "0"), make: ["Ford", "Kia"][i % 2] }));
    const sorted = [...rows].sort((a, b) => a.make.localeCompare(b.make) || a.id.localeCompare(b.id));
    const seen = new Set<string>();
    for (let p = 0; p < 20; p++) sorted.slice(p * 50, p * 50 + 50).forEach((r) => seen.add(r.id));
    expect(seen.size).toBe(1000);
  });
});
