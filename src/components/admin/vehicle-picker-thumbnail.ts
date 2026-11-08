import { chooseVehicleThumbnailPaths, vehicleListThumbnailKey } from "@/lib/vehicle-thumbnail";

type MediaResult = {
  items: { id: string; vehicle_id: string; kind: string; storage_path: string }[];
  listThumbnailId: string | null;
  confirmedCarPhotoIds: string[];
};

/** Only the existing staff-confirmed original-photo selection can supply picker thumbnails. */
export function vehiclePickerThumbnailPath(vehicleId: string, result: MediaResult): string | null {
  return chooseVehicleThumbnailPaths(
    result.items.filter((item) => item.vehicle_id === vehicleId && item.kind === "original"),
    [{ key: vehicleListThumbnailKey(vehicleId), value: { mediaId: result.listThumbnailId, carMediaIds: result.confirmedCarPhotoIds } }],
  ).get(vehicleId) ?? null;
}