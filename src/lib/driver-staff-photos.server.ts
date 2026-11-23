/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase service-role rows, as elsewhere in src/lib */
/**
 * Loads staff pickup, swap, and return photos for one driver.
 *
 * The caller has already resolved that driver (their own session, or a
 * staff preview). Every query is filtered to that driver's visible rentals.
 * Originals are never signed. A renter URL is the metadata-free share copy
 * used by condition photos, created here for a swap photo that does not
 * have one yet. Creating that copy does not change the photo row's pixels,
 * the swap, or the rental.
 */
import { tableMissing } from "@/lib/fleet-api.server";
import { choosePortalVehiclePhoto, type PortalVehicleMedia } from "@/lib/portal-vehicle-photo";
import { vehicleListThumbnailKey } from "@/lib/vehicle-thumbnail";
import { SWAP_PICKUP_PHOTO_BUCKET, SWAP_PICKUP_PHOTOS_TABLE } from "@/lib/swap-pickup-photos";
import { readConditionObjectHead } from "@/lib/swap-pickup-photos.server";
import { SHARE_COPY_MAX_BYTES, backfillOne } from "@/lib/trip-media.server";
import { buildShareCopy, shareCopyPath, sniffMediaType } from "@/lib/trip-media";
import exifr from "exifr";
import {
  applySignedUrls,
  buildDriverStaffAlbum,
  openStaffPhoto,
  rentalPhotosVisible,
  signableSharePath,
  todayEt,
  type ConditionRow,
  type DriverStaffAlbum,
  type InspectionRow,
  type OpenPhoto,
  type PhotoKind,
  type RentalRow,
  type SwapPhotoRow,
  type SwapRow,
  type VehicleRow,
} from "@/lib/driver-staff-photos";

const CONDITION_COLUMNS =
  "id,vehicle_id,rental_id,inspection_id,phase,angle,media_type,mime_type,captured_by_role,created_at,taken_at,taken_at_source,share_path,storage_bucket,storage_path";

function rentalRow(row: any): RentalRow {
  return {
    id: String(row.id),
    driverId: String(row.driver_id ?? ""),
    status: (row.status as string | null) ?? null,
    startDate: (row.start_date as string | null) ?? null,
    endDate: (row.end_date as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
    vehicleId: (row.vehicle_id as string | null) ?? null,
  };
}

function conditionRow(row: any): ConditionRow {
  return {
    id: String(row.id),
    vehicleId: String(row.vehicle_id),
    rentalId: (row.rental_id as string | null) ?? null,
    inspectionId: (row.inspection_id as string | null) ?? null,
    phase: (row.phase as string | null) ?? null,
    angle: (row.angle as string | null) ?? null,
    mediaType: (row.media_type as string | null) ?? null,
    mimeType: (row.mime_type as string | null) ?? null,
    capturedByRole: (row.captured_by_role as string | null) ?? null,
    createdAt: String(row.created_at),
    takenAt: (row.taken_at as string | null) ?? null,
    takenAtSource: (row.taken_at_source as string | null) ?? null,
    sharePath: (row.share_path as string | null) ?? null,
    storageBucket: (row.storage_bucket as string | null) ?? null,
    storagePath: (row.storage_path as string | null) ?? null,
  };
}

async function shareCopyIsClean(copy: Uint8Array): Promise<boolean> {
  try {
    const left = await exifr.parse(copy, { gps: true, xmp: true, iptc: true, icc: true });
    return !left || Object.keys(left).length === 0;
  } catch {
    return false;
  }
}

async function objectExists(admin: any, bucket: string, path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  if (slash < 0) return false;
  const listed = await admin.storage.from(bucket).list(path.slice(0, slash), {
    limit: 100,
    search: path.slice(slash + 1),
  });
  return (listed.data ?? []).some((file: { name?: string }) => file.name === path.slice(slash + 1));
}

async function signShare(admin: any, bucket: string, path: string): Promise<string | null> {
  const signed = await admin.storage.from(bucket).createSignedUrl(path, 60 * 30);
  return (signed.data?.signedUrl as string | undefined) ?? null;
}

/** Metadata-free copy for one swap photo. The original row is not updated. */
export async function ensureSwapShareCopy(admin: any, photo: OpenPhoto): Promise<string | null> {
  if (photo.storageBucket !== SWAP_PICKUP_PHOTO_BUCKET || !photo.storagePath) return null;
  const share = shareCopyPath(photo.storagePath);
  if (await objectExists(admin, photo.storageBucket, share)) return share;
  const mime = String(photo.mimeType ?? "").toLowerCase();
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") return null;
  const head = await readConditionObjectHead(admin, photo.storagePath);
  if (!head?.size || head.size > SHARE_COPY_MAX_BYTES) return null;
  if (sniffMediaType(head.bytes) !== mime) return null;
  const downloaded = await admin.storage.from(photo.storageBucket).download(photo.storagePath);
  if (downloaded.error || !downloaded.data) return null;
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  if (sniffMediaType(bytes) !== mime) return null;
  const copy = buildShareCopy(mime, bytes);
  if (!copy || !(await shareCopyIsClean(copy))) return null;
  const uploaded = await admin.storage.from(photo.storageBucket).upload(share, copy, {
    contentType: mime,
    upsert: false,
  });
  if (uploaded.error && !/already exists|duplicate/i.test(String(uploaded.error.message ?? "")))
    return null;
  return share;
}

async function ensureConditionShare(admin: any, photo: OpenPhoto): Promise<string | null> {
  const known = signableSharePath(photo.storagePath, photo.sharePath);
  if (known) return known;
  if (!photo.storageBucket || !photo.storagePath) return null;
  const made = await backfillOne(admin, {
    id: photo.id,
    storage_bucket: photo.storageBucket,
    storage_path: photo.storagePath,
  });
  const share = shareCopyPath(photo.storagePath);
  if (made || (await objectExists(admin, photo.storageBucket, share))) return share;
  return null;
}

async function loadRentals(admin: any, driverId: string): Promise<RentalRow[]> {
  const result = await admin
    .from("rentals")
    .select("id,driver_id,status,start_date,end_date,updated_at,vehicle_id")
    .eq("driver_id", driverId)
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(50);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).map(rentalRow);
}

export async function loadDriverStaffAlbum(
  admin: any,
  driverId: string,
  now = new Date(),
): Promise<DriverStaffAlbum> {
  const rentals = await loadRentals(admin, driverId);
  const today = todayEt(now);
  const visibleIds = rentals
    .filter((rental) => rentalPhotosVisible(rental, today))
    .map((rental) => rental.id);
  if (!visibleIds.length) return { rentals: [] };

  const [condition, inspections, swaps] = await Promise.all([
    admin
      .from("condition_media")
      .select(CONDITION_COLUMNS)
      .in("rental_id", visibleIds)
      .eq("captured_by_role", "staff")
      .in("phase", ["checkout", "checkin"])
      .limit(500),
    admin
      .from("inspections")
      .select("id,rental_id,vehicle_id")
      .in("rental_id", visibleIds)
      .limit(200),
    admin
      .from("rental_vehicle_swaps")
      .select("id,rental_id,swap_number,to_vehicle_id,created_at")
      .in("rental_id", visibleIds)
      .order("created_at", { ascending: true })
      .limit(100),
  ]);
  if (condition.error) throw new Error(condition.error.message);
  if (inspections.error) throw new Error(inspections.error.message);

  let swapRows: any[] = [];
  if (swaps.error) {
    if (!tableMissing(swaps.error, "rental_vehicle_swaps")) throw new Error(swaps.error.message);
  } else {
    swapRows = swaps.data ?? [];
  }

  const inspectionIds = (inspections.data ?? []).map((row: any) => String(row.id));
  let orphanCondition: any[] = [];
  if (inspectionIds.length) {
    const extra = await admin
      .from("condition_media")
      .select(CONDITION_COLUMNS)
      .in("inspection_id", inspectionIds)
      .is("rental_id", null)
      .eq("captured_by_role", "staff")
      .in("phase", ["checkout", "checkin"])
      .limit(500);
    if (extra.error) throw new Error(extra.error.message);
    orphanCondition = extra.data ?? [];
  }

  const swapIds = swapRows.map((row) => String(row.id));
  let swapPhotoRows: any[] = [];
  if (swapIds.length) {
    const photos = await admin
      .from(SWAP_PICKUP_PHOTOS_TABLE)
      .select("id,swap_id,vehicle_id,mime_type,created_at,storage_bucket,storage_path")
      .in("swap_id", swapIds)
      .order("created_at", { ascending: true })
      .limit(500);
    if (photos.error) {
      if (!tableMissing(photos.error, SWAP_PICKUP_PHOTOS_TABLE))
        throw new Error(photos.error.message);
    } else {
      swapPhotoRows = photos.data ?? [];
    }
  }

  const vehicleIds = new Set<string>();
  for (const row of [...(condition.data ?? []), ...orphanCondition]) {
    if (row.vehicle_id) vehicleIds.add(String(row.vehicle_id));
  }
  for (const row of swapRows) if (row.to_vehicle_id) vehicleIds.add(String(row.to_vehicle_id));
  for (const row of swapPhotoRows) if (row.vehicle_id) vehicleIds.add(String(row.vehicle_id));

  let vehicleRows: any[] = [];
  const thumbnailByVehicle = new Map<string, string>();
  if (vehicleIds.size) {
    const ids = [...vehicleIds];
    const [vehicles, media, settings] = await Promise.all([
      admin.from("vehicles").select("id,year,make,model,license_plate,vin,photos").in("id", ids),
      admin
        .from("vehicle_media")
        .select(
          "id,vehicle_id,kind,storage_bucket,storage_path,review_status,is_primary,sort_order,created_at",
        )
        .in("vehicle_id", ids),
      admin
        .from("app_settings")
        .select("key,value")
        .in(
          "key",
          ids.map((id) => vehicleListThumbnailKey(id)),
        ),
    ]);
    if (vehicles.error) throw new Error(vehicles.error.message);
    if (media.error) throw new Error(media.error.message);
    if (settings.error) throw new Error(settings.error.message);
    vehicleRows = vehicles.data ?? [];
    const settingByKey = new Map(
      ((settings.data ?? []) as Array<{ key: string; value: unknown }>).map((row) => [
        row.key,
        row.value,
      ]),
    );
    const mediaRows = (media.data ?? []) as PortalVehicleMedia[];
    await Promise.all(
      ids.map(async (id) => {
        const selected = choosePortalVehiclePhoto(
          id,
          mediaRows,
          settingByKey.get(vehicleListThumbnailKey(id)),
        );
        if (!selected) return;
        const signed = await admin.storage
          .from(selected.storage_bucket)
          .createSignedUrl(selected.storage_path, 60 * 30);
        if (signed.data?.signedUrl) thumbnailByVehicle.set(id, signed.data.signedUrl as string);
      }),
    );
  }

  const built = buildDriverStaffAlbum({
    driverId,
    todayEt: today,
    rentals,
    condition: [...(condition.data ?? []), ...orphanCondition].map(conditionRow),
    inspections: (inspections.data ?? []).map(
      (row: any): InspectionRow => ({
        id: String(row.id),
        rentalId: (row.rental_id as string | null) ?? null,
        vehicleId: (row.vehicle_id as string | null) ?? null,
      }),
    ),
    swaps: swapRows.map(
      (row: any): SwapRow => ({
        id: String(row.id),
        rentalId: String(row.rental_id),
        swapNumber: row.swap_number == null ? null : Number(row.swap_number),
        toVehicleId: String(row.to_vehicle_id),
        createdAt: String(row.created_at),
      }),
    ),
    swapPhotos: swapPhotoRows.map(
      (row: any): SwapPhotoRow => ({
        id: String(row.id),
        swapId: String(row.swap_id),
        vehicleId: String(row.vehicle_id),
        mimeType: (row.mime_type as string | null) ?? null,
        createdAt: String(row.created_at),
        storageBucket: (row.storage_bucket as string | null) ?? null,
        storagePath: (row.storage_path as string | null) ?? null,
      }),
    ),
    vehicles: vehicleRows.map(
      (row: any): VehicleRow => ({
        id: String(row.id),
        year: (row.year as number | null) ?? null,
        make: (row.make as string | null) ?? null,
        model: (row.model as string | null) ?? null,
        licensePlate: (row.license_plate as string | null) ?? null,
        vin: (row.vin as string | null) ?? null,
        photo:
          thumbnailByVehicle.get(String(row.id)) ??
          (Array.isArray(row.photos) ? ((row.photos[0] as string | null) ?? null) : null),
      }),
    ),
  });

  const urls = new Map<string, string | null>();
  await Promise.all(
    built.shares.map(async (share) => {
      urls.set(share.key, await signShare(admin, share.bucket, share.path));
    }),
  );
  return applySignedUrls(built.album, urls);
}

async function loadOpenPhoto(admin: any, kind: PhotoKind, id: string): Promise<OpenPhoto | null> {
  if (kind === "swap") {
    const result = await admin
      .from(SWAP_PICKUP_PHOTOS_TABLE)
      .select("id,swap_id,vehicle_id,mime_type,storage_bucket,storage_path")
      .eq("id", id)
      .maybeSingle();
    if (result.error) {
      if (tableMissing(result.error, SWAP_PICKUP_PHOTOS_TABLE)) return null;
      throw new Error(result.error.message);
    }
    if (!result.data) return null;
    const swap = await admin
      .from("rental_vehicle_swaps")
      .select("id,rental_id")
      .eq("id", result.data.swap_id)
      .maybeSingle();
    if (swap.error || !swap.data?.rental_id) return null;
    return {
      kind: "swap",
      id: String(result.data.id),
      rentalId: String(swap.data.rental_id),
      phase: null,
      capturedByRole: "staff",
      mimeType: (result.data.mime_type as string | null) ?? null,
      storageBucket: (result.data.storage_bucket as string | null) ?? null,
      storagePath: (result.data.storage_path as string | null) ?? null,
      sharePath: null,
    };
  }

  const result = await admin
    .from("condition_media")
    .select(CONDITION_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) return null;
  const row = conditionRow(result.data);
  let rentalId = row.rentalId;
  if (!rentalId && row.inspectionId) {
    const inspection = await admin
      .from("inspections")
      .select("id,rental_id")
      .eq("id", row.inspectionId)
      .maybeSingle();
    rentalId = (inspection.data?.rental_id as string | null) ?? null;
  }
  return {
    kind: "condition",
    id: row.id,
    rentalId,
    phase: row.phase,
    capturedByRole: row.capturedByRole,
    mimeType: row.mimeType,
    storageBucket: row.storageBucket,
    storagePath: row.storagePath,
    sharePath: row.sharePath,
  };
}

export async function openDriverStaffPhoto(
  admin: any,
  driverId: string,
  kind: PhotoKind,
  id: string,
  now = new Date(),
): Promise<{ url: string | null }> {
  return openStaffPhoto(
    {
      loadPhoto: (photoKind, photoId) => loadOpenPhoto(admin, photoKind, photoId),
      loadRental: async (rentalId) => {
        const result = await admin
          .from("rentals")
          .select("id,driver_id,status,start_date,end_date,updated_at,vehicle_id")
          .eq("id", rentalId)
          .maybeSingle();
        if (result.error || !result.data) return null;
        const rental = rentalRow(result.data);
        if (rental.driverId !== driverId) return null;
        return rental;
      },
      sign: (bucket, path) => signShare(admin, bucket, path),
      ensureShare: (photo) =>
        photo.kind === "swap"
          ? ensureSwapShareCopy(admin, photo)
          : ensureConditionShare(admin, photo),
    },
    { driverId, kind, id, now },
  );
}
