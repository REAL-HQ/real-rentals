import { describe, expect, it } from "vitest";
import { vehiclePickerThumbnailPath } from "../src/components/admin/vehicle-picker-thumbnail";

const car = { id: "car", vehicle_id: "vehicle-1", kind: "original", storage_path: "vehicle-1/car.jpg" };
const document = { ...car, id: "doc", storage_path: "vehicle-1/document.jpg" };
const enhanced = { ...car, id: "enhanced", kind: "ai_enhanced" };

describe("assignment thumbnails", () => {
  it("uses the selected staff-confirmed original car photo", () => {
    expect(vehiclePickerThumbnailPath("vehicle-1", { items: [document, car], listThumbnailId: "car", confirmedCarPhotoIds: ["car"] })).toBe("vehicle-1/car.jpg");
  });
  it("never automatically selects a document or unclassified original", () => {
    expect(vehiclePickerThumbnailPath("vehicle-1", { items: [document, car], listThumbnailId: "doc", confirmedCarPhotoIds: [] })).toBeNull();
  });
  it("uses only a confirmed original fallback when a selected photo is unavailable", () => {
    expect(vehiclePickerThumbnailPath("vehicle-1", { items: [document, car], listThumbnailId: "missing", confirmedCarPhotoIds: ["car"] })).toBe("vehicle-1/car.jpg");
  });
  it("refuses derivatives and photos belonging to another vehicle", () => {
    expect(vehiclePickerThumbnailPath("vehicle-1", { items: [enhanced, { ...car, vehicle_id: "vehicle-2" }], listThumbnailId: "car", confirmedCarPhotoIds: ["car", "enhanced"] })).toBeNull();
  });
});