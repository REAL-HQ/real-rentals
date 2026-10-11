import { describe, it, expect } from "vitest";
import { requiredDocCounts } from "../src/lib/required-docs";
import { buildReadinessIndex } from "../src/lib/readiness-index";
import { computeReadiness } from "../src/lib/readiness";
import { summarizeFleet } from "../src/lib/fleet-summary";
import { isRentalReady } from "../src/lib/vehicle-readiness";

describe("waitlist readiness parity (synthetic)", () => {
  it("doc counts: aliases, rejected and superseded excluded", () => {
    expect(
      requiredDocCounts([
        { lead_id: "a", category: "license_front" },
        { lead_id: "a", category: "insurance" },
        { lead_id: "a", category: "insurance_card" },
        { lead_id: "a", category: "license_back", review_status: "rejected" },
        { lead_id: "a", category: "gig_profile", is_current: false },
      ]),
    ).toEqual({ a: 2 });
  });
  it("index matches direct computation (same as Drivers)", () => {
    const app = { id: "a", platforms: ["uber"], license_valid: true };
    const idx = buildReadinessIndex([app], [], []);
    expect(idx.get("a")).toEqual(computeReadiness(app, null, []));
  });
  it("fleet available vs rental ready stay distinct", () => {
    const v = [
      { status: "available", year: 2020, make: "Toyota", model: "Camry", vin: "4T1B11HK5LU000001", weekly_rate: 350 },
      { status: "available", year: 2020, make: "Toyota", model: "Camry", vin: "", weekly_rate: null },
      { status: "onboarding", year: 2020, make: "Toyota", model: "Camry", vin: "4T1B11HK5LU000001", weekly_rate: 350 },
    ];
    expect(summarizeFleet(v).available).toBe(2);
    expect(v.filter((x) => isRentalReady(x)).length).toBe(2);
  });
});
