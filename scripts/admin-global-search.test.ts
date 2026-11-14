import { describe, it, expect } from "vitest";
import { searchDestination, searchResults } from "../src/components/admin/admin-search";

describe("staff global search", () => {
  it("finds another person by partial name independently of the current profile", () => {
    const rows = [{ id: "schrita", full_name: "Schrita Thomas" }, { id: "regina", full_name: "Regina Brown", email: "regina@example.test", phone: "8135550100" }];
    const matches = searchResults("drivers", rows, " ReGiNa ");
    expect(matches.map((row) => row.id)).toEqual(["regina"]);
    expect(searchDestination(matches[0])).toEqual({ tab: "drivers", id: "regina" });
  });
  it("accepts name words, email, phone and location without searching private identity fields", () => {
    const rows = [{ id: "regina", full_name: "Regina Brown", email: "regina@example.test", phone: "8135550100", city: "Tampa", license_number: "PRIVATE-123" }];
    for (const query of ["brown reg", "regina@example", "5550100", "tampa"]) expect(searchResults("drivers", rows, query)).toHaveLength(1);
    expect(searchResults("drivers", rows, "PRIVATE-123")).toEqual([]);
  });
  it("never returns deleted or duplicate drivers", () => {
    expect(searchResults("drivers", [{ id: "a", full_name: "Regina", deleted_at: "2026-11-09" }, { id: "b", full_name: "Regina", status: "duplicate" }], "regina")).toEqual([]);
  });
  it("finds vehicles by year, color, plate and VIN using operational fields only", () => {
    const rows = [{ id: "car", year: 2015, make: "Ford", model: "Fusion", color: "Red", license_plate: "ABC123", vin: "1TESTVIN123", acquisition_cost: "SECRET" }];
    for (const query of ["2015 ford", "red", "abc123", "1testvin"]) expect(searchResults("vehicles", rows, query).map((row) => row.id)).toEqual(["car"]);
    expect(searchResults("vehicles", rows, "SECRET")).toEqual([]);
    expect(searchDestination(searchResults("vehicles", rows, "fusion")[0])).toEqual({ tab: "vehicles", id: "car" });
  });
  it("finds partners without copying finance fields into a result", () => {
    const matches = searchResults("partners", [{ id: "partner", name: "Example Partner", email: "partner@example.test", capital_committed: 1000 }], "example");
    expect(matches).toEqual([{ id: "partner", kind: "partners", label: "Example Partner", detail: "partner@example.test" }]);
    expect(searchDestination(matches[0])).toEqual({ tab: "partners" });
  });
  it("returns no matches for empty queries or missing ids", () => {
    expect(searchResults("drivers", [{ id: "a", full_name: "Regina" }], " ")).toEqual([]);
    expect(searchResults("drivers", [{ full_name: "Regina" }], "regina")).toEqual([]);
  });
});