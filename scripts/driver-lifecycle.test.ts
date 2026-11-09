import { describe, expect, it } from "vitest";
import { driverLifecycle } from "../src/lib/driver-lifecycle";
const facts = { contacted: true, screening: true, documents: true, profile: true, insuranceOnFile: true, approved: true, inspection: false, agreement: false, rentalActive: false };
describe("Requested ten-stage lifecycle, presentation only", () => {
  it("places Inspection and Agreement immediately after Approved", () => {
    expect(driverLifecycle(facts).stages.map((s) => s.key)).toEqual(["applied", "contacted", "screening", "docs", "profile", "insurance", "approved", "inspection", "agreement", "pickup", "active"]);
    expect(driverLifecycle(facts).current?.key).toBe("inspection");
  });
  it("marks insurance file collection independently of verification", () => expect(driverLifecycle(facts).stages.find((s) => s.key === "insurance")?.state).toBe("done"));
  it("approval alone cannot complete inspection, agreement, pickup or Active", () => {
    expect(driverLifecycle(facts).stages.slice(7).every((s) => s.state !== "done")).toBe(true);
    expect(driverLifecycle(facts).percent).toBe(64);
  });
  it("inspection and agreement facts complete independently", () => {
    expect(driverLifecycle({ ...facts, inspection: true }).current?.key).toBe("agreement");
    expect(driverLifecycle({ ...facts, agreement: true }).current?.key).toBe("inspection");
  });
  it("only an actual active rental completes Pickup and Active", () => {
    expect(driverLifecycle({ ...facts, inspection: true, agreement: true }).stages.slice(9).map((s) => s.state)).toEqual(["current", "upcoming"]);
    expect(driverLifecycle({ ...facts, inspection: true, agreement: true, rentalActive: true }).percent).toBe(100);
  });
});