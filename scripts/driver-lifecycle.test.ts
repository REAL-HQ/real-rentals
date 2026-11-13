import { describe, expect, it } from "vitest";
import { driverLifecycle } from "../src/lib/driver-lifecycle";

const facts = {
  contacted: true,
  documentsReceived: true,
  screening: true,
  approved: true,
  inspection: false,
  agreement: false,
  rentalActive: false,
};

describe("Driver lifecycle, presentation only", () => {
  it("removes License and Profile and places Agreement before Reserved", () => {
    expect(driverLifecycle(facts).stages.map((s) => s.key)).toEqual([
      "applied", "contacted", "documents", "screening", "approved",
      "agreement", "reserved", "inspection", "pickup", "active",
    ]);
    expect(driverLifecycle(facts).current?.key).toBe("agreement");
  });

  it("approval alone cannot complete agreement, reservation, inspection, pickup or Active", () => {
    expect(driverLifecycle(facts).stages.slice(5).every((s) => s.state !== "done")).toBe(true);
    expect(driverLifecycle(facts).percent).toBe(50);
  });

  it("agreement, reservation and inspection facts complete independently", () => {
    expect(driverLifecycle({ ...facts, agreement: true }).current?.key).toBe("reserved");
    expect(driverLifecycle({ ...facts, agreement: true, reserved: true }).current?.key).toBe("inspection");
    expect(driverLifecycle({ ...facts, agreement: true, inspection: true }).current?.key).toBe("reserved");
  });

  it("only an actual active rental completes Active", () => {
    expect(driverLifecycle({ ...facts, reserved: true, inspection: true, agreement: true }).stages.slice(8).map((s) => s.state)).toEqual(["current", "upcoming"]);
    expect(driverLifecycle({ ...facts, inspection: true, agreement: true, rentalActive: true }).percent).toBe(100);
  });
});
