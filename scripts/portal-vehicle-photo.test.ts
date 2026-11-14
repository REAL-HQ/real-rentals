import { describe, expect, test } from "bun:test";
import { choosePortalVehiclePhoto, type PortalVehicleMedia } from "../src/lib/portal-vehicle-photo";

const vehicleId = "vehicle-1";
function photo(id: string, kind: "original" | "ai_enhanced", overrides: Partial<PortalVehicleMedia> = {}): PortalVehicleMedia {
  return {
    id,
    vehicle_id: vehicleId,
    kind,
    storage_bucket: "vehicle-photos",
    storage_path: `${id}.jpg`,
    review_status: kind === "original" ? null : "pending",
    is_primary: false,
    sort_order: 0,
    created_at: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

const confirmedOriginal = photo("confirmed", "original", { sort_order: 2 });
const setting = { mediaId: "confirmed", carMediaIds: ["confirmed"] };

describe("portal vehicle photo", () => {
  test("uses the same confirmed original as staff when no approved enhancement exists", () => {
    const unconfirmed = photo("document", "original", { sort_order: 1 });
    const pending = photo("pending-enhancement", "ai_enhanced");
    expect(choosePortalVehiclePhoto(vehicleId, [unconfirmed, pending, confirmedOriginal], setting)).toEqual({
      storage_bucket: "vehicle-photos",
      storage_path: "confirmed.jpg",
    });
  });

  test("prefers an approved AI-enhanced photo over the staff original", () => {
    const approved = photo("approved-enhancement", "ai_enhanced", { review_status: "approved" });
    expect(choosePortalVehiclePhoto(vehicleId, [confirmedOriginal, approved], setting)).toEqual({
      storage_bucket: "vehicle-photos",
      storage_path: "approved-enhancement.jpg",
    });
  });

  test("does not use pending or rejected enhancements", () => {
    const pending = photo("pending", "ai_enhanced");
    const rejected = photo("rejected", "ai_enhanced", { review_status: "rejected" });
    expect(choosePortalVehiclePhoto(vehicleId, [pending, rejected, confirmedOriginal], setting)?.storage_path).toBe("confirmed.jpg");
  });

  test("returns no photo when no enhancement is approved and no original is confirmed", () => {
    expect(choosePortalVehiclePhoto(vehicleId, [confirmedOriginal], { mediaId: null, carMediaIds: [] })).toBeNull();
  });
});
