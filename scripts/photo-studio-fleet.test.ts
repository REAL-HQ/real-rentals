import { describe, expect, test } from "bun:test";
import {
  carReadyToPublish, describeStudioRun, fleetProgress, isStudioFleetCar, shotPassedIdentity, studioRunToast,
  type FleetCarInput, type FleetShot,
} from "../src/lib/photo-studio-fleet";

const ok = { read: { ok: true, plates: [], vins: [] } };
const shot = (slot: string, status = "pending", published = false, check: unknown = ok): FleetShot => ({ slot, status, published, check });
const exterior = (status = "pending", published = false): FleetShot[] =>
  ["front", "driver_side", "passenger_side", "rear"].map((slot) => shot(slot, status, published));

function car(over: Partial<FleetCarInput> = {}): FleetCarInput {
  return {
    id: "c1", unitNumber: "RR-01", year: 2015, make: "Ford", model: "Fusion",
    status: "available", archivedAt: null,
    originals: [{ photoClass: "exterior_front" }, { photoClass: "unknown" }],
    shots: [],
    ...over,
  };
}

describe("fleet eligibility", () => {
  test("skips for sale, archived, retired, sold, and archived_at", () => {
    expect(isStudioFleetCar({ status: "available", archivedAt: null })).toBe(true);
    expect(isStudioFleetCar({ status: "rented", archivedAt: null })).toBe(true);
    for (const status of ["for_sale", "For Sale", "archived", "retired", "sold"]) {
      expect(isStudioFleetCar({ status, archivedAt: null })).toBe(false);
    }
    expect(isStudioFleetCar({ status: "available", archivedAt: "2026-01-01" })).toBe(false);
  });
});

describe("publish readiness", () => {
  test("a complete set that passed identity is ready, and a failed re-read is not", () => {
    expect(shotPassedIdentity(ok)).toBe(true);
    expect(shotPassedIdentity({ read: { ok: false } })).toBe(false);
    expect(shotPassedIdentity(null)).toBe(false);
    expect(carReadyToPublish(exterior())).toBe(true);
    expect(carReadyToPublish([...exterior(), shot("interior_1")])).toBe(true);
    expect(carReadyToPublish(exterior().slice(0, 3))).toBe(false);
    const bad = exterior();
    bad[0] = shot("front", "pending", false, { read: { ok: false } });
    expect(carReadyToPublish(bad)).toBe(false);
    expect(carReadyToPublish(exterior().map((s) => s.slot === "rear" ? { ...s, status: "rejected" } : s))).toBe(false);
  });
});

describe("fleet progress", () => {
  test("counts labels and shows Continues Tomorrow only when the daily cap blocks unfinished cars", () => {
    const rows = fleetProgress([
      car({ id: "open" }),
      car({
        id: "ready", unitNumber: "RR-02",
        originals: [{ photoClass: "exterior_front" }, { photoClass: "exterior_rear" }],
        shots: exterior("approved", false),
      }),
      car({ id: "sold", status: "sold", originals: [{ photoClass: null }], shots: [] }),
      car({ id: "empty", originals: [], shots: [] }),
    ], true);
    const open = rows.find((r) => r.vehicleId === "open")!;
    expect(open.labeled).toBe(1);
    expect(open.unknown).toBe(1);
    expect(open.generated).toBe(0);
    expect(open.state).toBe("Continues Tomorrow");
    expect(open.needsWork).toBe(true);
    const ready = rows.find((r) => r.vehicleId === "ready")!;
    expect(ready.state).toBe("Ready");
    expect(ready.approved).toBe(4);
    expect(ready.needsWork).toBe(false);
    expect(rows.some((r) => r.vehicleId === "sold")).toBe(false);
    expect(rows.find((r) => r.vehicleId === "empty")!.state).toBe("No Photos");
    const unblocked = fleetProgress([car({ id: "open" })], false);
    expect(unblocked[0].state).toBe("Needs Shots");
  });

  test("a published identity-checked set is Published", () => {
    const rows = fleetProgress([car({
      originals: [{ photoClass: "exterior_front" }],
      shots: exterior("approved", true),
    })], false);
    expect(rows[0].state).toBe("Published");
    expect(rows[0].published).toBe(4);
    expect(rows[0].ready).toBe(true);
  });
});

describe("run all cars summary", () => {
  const none = { labeled: 0, lowConfidence: 0, failed: 0 };
  test("a clean fleet still says it finished", () => {
    expect(describeStudioRun(0, none)).toBe("Every car in the fleet already has its shots.");
    expect(describeStudioRun(10, none)).toBe("Photo Studio finished 10 cars.");
    expect(describeStudioRun(1, none)).toBe("Photo Studio finished 1 car.");
    expect(studioRunToast(10, none).level).toBe("success");
  });
  test("labeling failures lead, with the other counts", () => {
    const labels = { labeled: 4, lowConfidence: 2, failed: 121 };
    expect(describeStudioRun(10, labels)).toBe(
      "121 photos could not be labeled. Photo Studio finished 10 cars. 4 labeled. 2 low confidence.",
    );
    expect(describeStudioRun(2, { labeled: 0, lowConfidence: 0, failed: 1 })).toBe(
      "1 photo could not be labeled. Photo Studio finished 2 cars.",
    );
    expect(studioRunToast(10, labels).level).toBe("error");
  });
  test("a cap still explains itself, and a failure is not hidden behind it", () => {
    expect(describeStudioRun(3, none, "continues_tomorrow")).toBe(
      "Continues Tomorrow. The daily limit was reached. Run this again tomorrow.",
    );
    expect(describeStudioRun(3, none, "monthly_cap")).toBe("The monthly cap was reached.");
    expect(studioRunToast(3, none, "monthly_cap").level).toBe("message");
    expect(describeStudioRun(3, { labeled: 1, lowConfidence: 0, failed: 5 }, "continues_tomorrow")).toBe(
      "5 photos could not be labeled. Continues Tomorrow. The daily limit was reached. Run this again tomorrow. 1 labeled.",
    );
  });
  test("labeled and low confidence are reported when nothing failed", () => {
    expect(describeStudioRun(3, { labeled: 8, lowConfidence: 1, failed: 0 })).toBe(
      "Photo Studio finished 3 cars. 8 labeled. 1 low confidence.",
    );
  });
});
