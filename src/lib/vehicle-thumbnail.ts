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

/** Photos a staff member explicitly confirmed show the car, never paperwork. */
export function readConfirmedCarMediaIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as { carMediaIds?: unknown }).carMediaIds;
  const ids = Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === "string" && !!id.trim())
    : [];
  return [...new Set(ids)];
}

export type VehicleThumbnailMedia = {
  id: string;
  vehicle_id: string;
  storage_path: string;
};

/**
 * Choose only originals staff explicitly confirmed as car photos. Unclassified
 * images, paperwork, VIN plates, odometers and stickers have no automatic
 * fallback: when no car photo is confirmed, the vehicle gets no thumbnail.
 * `media` must already be restricted to originals and sorted in display order.
 */
export function chooseVehicleThumbnailPaths(
  media: VehicleThumbnailMedia[],
  settings: Array<{ key: string; value: unknown }>,
): Map<string, string> {
  const selected = new Map<string, string>();
  const confirmed = new Map<string, Set<string>>();
  for (const setting of settings) {
    if (!setting.key.startsWith(KEY_PREFIX)) continue;
    const vehicleId = setting.key.slice(KEY_PREFIX.length);
    const mediaId = readVehicleListThumbnailMediaId(setting.value);
    if (mediaId) selected.set(vehicleId, mediaId);
    confirmed.set(vehicleId, new Set(readConfirmedCarMediaIds(setting.value)));
  }

  const paths = new Map<string, string>();
  for (const photo of media) {
    if (!confirmed.get(photo.vehicle_id)?.has(photo.id)) continue;
    if (!paths.has(photo.vehicle_id) || selected.get(photo.vehicle_id) === photo.id) {
      paths.set(photo.vehicle_id, photo.storage_path);
    }
  }
  return paths;
}
