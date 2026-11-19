import { chooseVehicleThumbnailPaths, vehicleListThumbnailKey, type VehicleThumbnailMedia } from "@/lib/vehicle-thumbnail";

/**
 * Staff-confirmed thumbnail path per vehicle id. Cosmetic: any read failure
 * returns an empty map so a list never fails because of a photo.
 */
export async function loadVehicleThumbnailPaths(sb: any, vehicleIds: Array<string | null | undefined>): Promise<Map<string, string>> {
  const ids = [...new Set(vehicleIds.filter((v): v is string => !!v))];
  if (!ids.length) return new Map();
  try {
    const [media, settings] = await Promise.all([
      sb
        .from("vehicle_media")
        .select("id,vehicle_id,storage_path")
        .in("vehicle_id", ids)
        .eq("kind", "original")
        .order("is_primary", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      sb.from("app_settings").select("key,value").in("key", ids.map((id) => vehicleListThumbnailKey(id))),
    ]);
    return chooseVehicleThumbnailPaths((media.data ?? []) as VehicleThumbnailMedia[], settings.data ?? []);
  } catch {
    return new Map();
  }
}
