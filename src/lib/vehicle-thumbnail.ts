// Staff-only Vehicles-list thumbnail choices. These are deliberately separate
// from vehicle_media.is_primary/published, which control the public listing.

const KEY_PREFIX = "vehicle_list_thumbnail:";

export function vehicleListThumbnailKey(vehicleId: string): string {
  return `${KEY_PREFIX}${vehicleId}`;
}

export function readVehicleListThumbnailMediaId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const mediaId = (value as { mediaId?: unknown }).mediaId;
  return typeof mediaId === "string" && mediaId.trim() ? mediaId : null;
}

export type VehicleThumbnailMedia = {
  id: string;
  vehicle_id: string;
  storage_path: string;
};

/**
 * Choose the explicit staff thumbnail when it still names an original photo
 * on that vehicle; otherwise keep the existing lead/first-photo fallback.
 * `media` must already be restricted to originals and sorted in fallback order.
 */
export function chooseVehicleThumbnailPaths(
  media: VehicleThumbnailMedia[],
  settings: Array<{ key: string; value: unknown }>,
): Map<string, string> {
  const selected = new Map<string, string>();
  for (const setting of settings) {
    if (!setting.key.startsWith(KEY_PREFIX)) continue;
    const mediaId = readVehicleListThumbnailMediaId(setting.value);
    if (mediaId) selected.set(setting.key.slice(KEY_PREFIX.length), mediaId);
  }

  const paths = new Map<string, string>();
  for (const photo of media) {
    if (!paths.has(photo.vehicle_id)) paths.set(photo.vehicle_id, photo.storage_path);
    if (selected.get(photo.vehicle_id) === photo.id) {
      paths.set(photo.vehicle_id, photo.storage_path);
    }
  }
  return paths;
}
