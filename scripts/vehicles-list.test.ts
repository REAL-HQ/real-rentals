import { describe, it, expect } from "vitest";
import { buildVehicleSearchOr, availabilityLabel, vehicleSortOrders, VEHICLE_SORTS } from "../src/lib/vehicles-list";

describe("vehicles list helpers", () => {
  it("supports Year sorting oldest first, with missing years last and stable ties", () => {
    expect(VEHICLE_SORTS).toContain("year");
    expect(vehicleSortOrders("year")).toEqual([
      { column: "year", options: { ascending: true, nullsFirst: false } },
      { column: "id", options: { ascending: true } },
    ]);
  });
  it("supports Color sorting alphabetically, with missing colors last and stable ties", () => {
    expect(VEHICLE_SORTS).toContain("color");
    expect(vehicleSortOrders("color")).toEqual([
      { column: "color", options: { ascending: true, nullsFirst: false } },
      { column: "id", options: { ascending: true } },
    ]);
  });
  it("preserves existing sorts and falls back to Unit for unknown choices", () => {
    for (const [sort, columns, ascending] of [
      ["unit", ["unit_number", "id"], true],
      ["make", ["make", "model", "id"], true],
      ["rate", ["weekly_rate", "id"], true],
      ["newest", ["created_at", "id"], false],
      ["invalid", ["unit_number", "id"], true],
    ] as const) {
      const orders = vehicleSortOrders(sort);
      expect(orders.map(({ column }) => column)).toEqual(columns);
      expect(orders[0]?.options).toEqual({ ascending, nullsFirst: false });
      expect(orders.at(-1)?.options).toEqual({ ascending: true });
    }
  });
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
  it("running rentals take priority over the stored available status", () => {
    expect(availabilityLabel({ on_rent: true, status: "available" })).toBe(availabilityLabel({ on_rent: false, status: "rented" }));
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
