import { describe, expect, it } from "vitest";
import { driverLifecycle } from "../src/lib/driver-lifecycle";
const facts = { contacted: true, documentsReceived: true, screening: true, documents: true, profile: true, insuranceOnFile: true, approved: true, inspection: false, agreement: false, rentalActive: false };
describe("Driver lifecycle, presentation only", () => {
  it("places Reserved immediately after Approved and before Inspection", () => {
    expect(driverLifecycle(facts).stages.map((s) => s.key)).toEqual(["applied", "contacted", "documents", "screening", "docs", "profile", "approved", "reserved", "inspection", "agreement", "pickup", "active"]);
    expect(driverLifecycle(facts).current?.key).toBe("reserved");
  });
  it("approval alone cannot complete inspection, agreement, pickup or Active", () => {
    expect(driverLifecycle(facts).stages.slice(7).every((s) => s.state !== "done")).toBe(true);
    expect(driverLifecycle(facts).percent).toBe(58);
  });
  it("inspection and agreement facts complete independently", () => {
    expect(driverLifecycle({ ...facts, reserved: true, inspection: true }).current?.key).toBe("agreement");
    expect(driverLifecycle({ ...facts, reserved: true, agreement: true }).current?.key).toBe("inspection");
  });
  it("only an actual active rental completes Pickup and Active", () => {
    expect(driverLifecycle({ ...facts, reserved: true, inspection: true, agreement: true }).stages.slice(10).map((s) => s.state)).toEqual(["current", "upcoming"]);
    expect(driverLifecycle({ ...facts, inspection: true, agreement: true, rentalActive: true }).percent).toBe(100);
  });
});