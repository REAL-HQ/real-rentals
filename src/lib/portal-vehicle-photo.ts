import {
  chooseVehicleThumbnailPaths,
  vehicleListThumbnailKey,
  type VehicleThumbnailMedia,
} from "@/lib/vehicle-thumbnail";

export type PortalVehicleMedia = VehicleThumbnailMedia & {
  kind: "original" | "ai_enhanced";
  storage_bucket: string;
  review_status?: "pending" | "approved" | "rejected" | null;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
};

function displayOrder(a: PortalVehicleMedia, b: PortalVehicleMedia): number {
  return Number(b.is_primary) - Number(a.is_primary)
    || a.sort_order - b.sort_order
    || Date.parse(a.created_at) - Date.parse(b.created_at);
}

/**
 * The renter-facing representation of the car: an approved enhancement when
 * one exists, otherwise the same staff-confirmed original used by Vehicles.
 * Pickup/return condition media is deliberately not part of this selection.
 */
export function choosePortalVehiclePhoto(
  vehicleId: string,
  media: PortalVehicleMedia[],
  thumbnailSetting: unknown,
): { storage_bucket: string; storage_path: string } | null {
  const enhanced = media
    .filter((photo) => photo.vehicle_id === vehicleId && photo.kind === "ai_enhanced" && photo.review_status === "approved")
    .sort(displayOrder)[0];
  if (enhanced) return { storage_bucket: enhanced.storage_bucket, storage_path: enhanced.storage_path };

  const originals = media
    .filter((photo) => photo.vehicle_id === vehicleId && photo.kind === "original")
    .sort(displayOrder);
  const path = chooseVehicleThumbnailPaths(originals, [
    { key: vehicleListThumbnailKey(vehicleId), value: thumbnailSetting },
  ]).get(vehicleId);
  const original = originals.find((photo) => photo.storage_path === path);
  return original ? { storage_bucket: original.storage_bucket, storage_path: original.storage_path } : null;
}
