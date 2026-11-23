/**
 * Read-only staff condition photos for the driver portal.
 *
 * Pickup and return come from condition_media (check-out and check-in).
 * Swap comes from rental_vehicle_swap_photos. Nothing here writes, and a
 * photo is included only when the rental is one this driver may see.
 */
import { formatVehicleIdentityLine } from "@/lib/vehicle-label";
import { shareCopyPath } from "@/lib/trip-media";

export type StaffEvent = "pickup" | "swap" | "return";
export type PhotoKind = "condition" | "swap";
export type PhotoPreview = "ready" | "prepare" | "unavailable";

export type RentalRow = {
  id: string;
  driverId: string;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  updatedAt: string | null;
  vehicleId: string | null;
};

export type ConditionRow = {
  id: string;
  vehicleId: string;
  rentalId: string | null;
  inspectionId: string | null;
  phase: string | null;
  angle: string | null;
  mediaType: string | null;
  mimeType: string | null;
  capturedByRole: string | null;
  createdAt: string;
  takenAt: string | null;
  takenAtSource: string | null;
  sharePath: string | null;
  storageBucket: string | null;
  storagePath: string | null;
};

export type InspectionRow = {
  id: string;
  rentalId: string | null;
  vehicleId: string | null;
};

export type SwapRow = {
  id: string;
  rentalId: string;
  swapNumber: number | null;
  toVehicleId: string;
  createdAt: string;
};

export type SwapPhotoRow = {
  id: string;
  swapId: string;
  vehicleId: string;
  mimeType: string | null;
  createdAt: string;
  storageBucket: string | null;
  storagePath: string | null;
};

export type VehicleRow = {
  id: string;
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  licensePlate?: string | null;
  vin?: string | null;
  photo?: string | null;
};

export type DriverStaffPhoto = {
  id: string;
  kind: PhotoKind;
  event: StaffEvent;
  rentalId: string;
  vehicleId: string;
  angle: string | null;
  mimeType: string | null;
  at: string;
  timeLabel: "Taken" | "Uploaded";
  preview: PhotoPreview;
  url: string | null;
};

/** Thumbnail, plate, and VIN last 6. Unit number is never a field. */
export type DriverVehicleLabel = {
  id: string;
  name: string;
  identity: string;
  photo: string | null;
};

export type DriverStaffBlock = {
  vehicle: DriverVehicleLabel;
  photos: DriverStaffPhoto[];
};

export type DriverStaffSwap = {
  swapId: string;
  swapNumber: number | null;
  at: string;
  vehicle: DriverVehicleLabel;
  photos: DriverStaffPhoto[];
};

export type DriverStaffRental = {
  rentalId: string;
  stage: "active" | "returned";
  startDate: string | null;
  endDate: string | null;
  pickup: DriverStaffBlock[];
  swaps: DriverStaffSwap[];
  returnPhotos: DriverStaffBlock[];
};

export type DriverStaffAlbum = {
  rentals: DriverStaffRental[];
};

export type ShareRef = {
  key: string;
  bucket: string;
  path: string;
};

const STRIPPABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Calendar date in America/New_York, YYYY-MM-DD. Matches renter_portal_stage. */
export function todayEt(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : null;
}

/** Same stages as private.renter_portal_stage. */
export function rentalPortalStage(
  status: string | null | undefined,
  endDate: string | null | undefined,
  today: string,
): "none" | "returned" | "active" | "assigned" {
  const s = String(status ?? "").toLowerCase();
  if (s === "cancelled" || s === "canceled") return "none";
  if (s === "returned" || s === "completed" || s === "ended" || s === "closed") return "returned";
  if (s === "active") return "active";
  const end = dateOnly(endDate);
  if (end && end < today) return "returned";
  return "assigned";
}

function plusOneYear(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const next = year + 1;
  const leap = next % 4 === 0 && (next % 100 !== 0 || next % 400 === 0);
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const clamped = Math.min(day, dim[month - 1] ?? 28);
  return `${next}-${String(month).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

/**
 * Active rentals, and returned ones for a year. Same window as
 * private.renter_visible_rental_ids. Assigned and cancelled stay out.
 */
export function rentalPhotosVisible(rental: RentalRow, today: string): boolean {
  const stage = rentalPortalStage(rental.status, rental.endDate, today);
  if (stage === "active") return true;
  if (stage !== "returned") return false;
  const anchor = dateOnly(rental.endDate) ?? dateOnly(rental.updatedAt);
  if (!anchor) return false;
  return plusOneYear(anchor) >= today;
}

export function vehicleLabel(
  vehicle: VehicleRow | undefined,
  vehicleId: string,
): DriverVehicleLabel {
  const name = [vehicle?.year, vehicle?.make, vehicle?.model]
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter(Boolean)
    .join(" ");
  return {
    id: vehicleId,
    name,
    identity: formatVehicleIdentityLine({
      license_plate: vehicle?.licensePlate,
      vin: vehicle?.vin,
    }),
    photo: vehicle?.photo ? String(vehicle.photo) : null,
  };
}

/** Plate and VIN last 6 only, even when a unit number was passed in by mistake. */
export function vehicleIdentityLine(vehicle: {
  licensePlate?: string | null;
  vin?: string | null;
  unitNumber?: string | null;
}): string {
  return formatVehicleIdentityLine({
    license_plate: vehicle.licensePlate,
    vin: vehicle.vin,
  });
}

function isStaffPhoto(role: string | null | undefined): boolean {
  return String(role ?? "").toLowerCase() === "staff";
}

function eventForPhase(phase: string | null | undefined): StaffEvent | null {
  const p = String(phase ?? "").toLowerCase();
  if (p === "checkout") return "pickup";
  if (p === "checkin") return "return";
  return null;
}

function isStillImage(
  mediaType: string | null | undefined,
  mimeType: string | null | undefined,
): boolean {
  if (String(mediaType ?? "").toLowerCase() === "video") return false;
  if (String(mediaType ?? "").toLowerCase() === "photo") return true;
  return String(mimeType ?? "")
    .toLowerCase()
    .startsWith("image/");
}

function photoClock(
  takenAt: string | null | undefined,
  takenAtSource: string | null | undefined,
  createdAt: string,
): { at: string; timeLabel: "Taken" | "Uploaded" } {
  if (takenAt && String(takenAtSource ?? "").toLowerCase() === "exif") {
    return { at: takenAt, timeLabel: "Taken" };
  }
  return { at: createdAt, timeLabel: "Uploaded" };
}

function previewFor(
  mimeType: string | null | undefined,
  sharePath: string | null | undefined,
): PhotoPreview {
  if (sharePath) return "ready";
  const mime = String(mimeType ?? "").toLowerCase();
  if (STRIPPABLE.has(mime)) return "prepare";
  return "unavailable";
}

function byTime(a: DriverStaffPhoto, b: DriverStaffPhoto): number {
  return a.at.localeCompare(b.at) || a.id.localeCompare(b.id);
}

function blocksFor(
  photos: DriverStaffPhoto[],
  vehicles: Map<string, VehicleRow>,
): DriverStaffBlock[] {
  const order: string[] = [];
  const groups = new Map<string, DriverStaffPhoto[]>();
  for (const photo of [...photos].sort(byTime)) {
    if (!groups.has(photo.vehicleId)) {
      groups.set(photo.vehicleId, []);
      order.push(photo.vehicleId);
    }
    groups.get(photo.vehicleId)!.push(photo);
  }
  return order.map((vehicleId) => ({
    vehicle: vehicleLabel(vehicles.get(vehicleId), vehicleId),
    photos: groups.get(vehicleId) ?? [],
  }));
}

/**
 * The only path a renter may be signed. It is the metadata-free copy, never
 * the original object.
 */
export function signableSharePath(
  original: string | null | undefined,
  share: string | null | undefined,
): string | null {
  const path = String(share ?? "");
  const source = String(original ?? "");
  if (!path || !source) return null;
  if (path === source) return null;
  if (path !== shareCopyPath(source)) return null;
  return path;
}

export type OpenPhoto = {
  kind: PhotoKind;
  id: string;
  rentalId: string | null;
  phase: string | null;
  capturedByRole: string | null;
  mimeType: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  sharePath: string | null;
};

export type OpenDeps = {
  loadPhoto: (kind: PhotoKind, id: string) => Promise<OpenPhoto | null>;
  loadRental: (rentalId: string) => Promise<RentalRow | null>;
  sign: (bucket: string, path: string) => Promise<string | null>;
  ensureShare: (photo: OpenPhoto) => Promise<string | null>;
};

/**
 * One photo URL for this driver, or null. A rental that is not theirs never
 * reaches the share-copy or signing steps.
 */
export async function openStaffPhoto(
  deps: OpenDeps,
  args: { driverId: string; kind: PhotoKind; id: string; now: Date },
): Promise<{ url: string | null }> {
  const photo = await deps.loadPhoto(args.kind, args.id);
  if (!photo || photo.kind !== args.kind || !photo.rentalId) return { url: null };
  if (args.kind === "condition") {
    if (!isStaffPhoto(photo.capturedByRole)) return { url: null };
    if (!eventForPhase(photo.phase)) return { url: null };
  }
  const rental = await deps.loadRental(photo.rentalId);
  const today = todayEt(args.now);
  if (!rental || rental.id !== photo.rentalId || rental.driverId !== args.driverId)
    return { url: null };
  if (!rentalPhotosVisible(rental, today)) return { url: null };

  const known = signableSharePath(photo.storagePath, photo.sharePath);
  const share = known ?? (await deps.ensureShare(photo));
  const path = signableSharePath(photo.storagePath, share);
  if (!path || !photo.storageBucket) return { url: null };
  const url = await deps.sign(photo.storageBucket, path);
  return { url: url || null };
}

export function buildDriverStaffAlbum(input: {
  driverId: string;
  todayEt: string;
  rentals: RentalRow[];
  condition: ConditionRow[];
  inspections: InspectionRow[];
  swaps: SwapRow[];
  swapPhotos: SwapPhotoRow[];
  vehicles: VehicleRow[];
}): { album: DriverStaffAlbum; shares: ShareRef[] } {
  const visible = new Map<string, RentalRow>();
  for (const rental of input.rentals) {
    if (rental.driverId !== input.driverId) continue;
    if (!rentalPhotosVisible(rental, input.todayEt)) continue;
    visible.set(rental.id, rental);
  }
  const inspections = new Map(input.inspections.map((row) => [row.id, row]));
  const vehicles = new Map(input.vehicles.map((row) => [row.id, row]));
  const shares: ShareRef[] = [];

  const pickup = new Map<string, DriverStaffPhoto[]>();
  const returned = new Map<string, DriverStaffPhoto[]>();
  const seen = new Set<string>();

  for (const row of input.condition) {
    if (!isStaffPhoto(row.capturedByRole)) continue;
    if (!isStillImage(row.mediaType, row.mimeType)) continue;
    const event = eventForPhase(row.phase);
    if (!event) continue;
    let rentalId = row.rentalId;
    if (rentalId && !visible.has(rentalId)) continue;
    const inspection = row.inspectionId ? inspections.get(row.inspectionId) : undefined;
    if (!rentalId) {
      rentalId = inspection?.rentalId ?? null;
      if (!rentalId || !visible.has(rentalId)) continue;
    } else if (inspection?.rentalId && inspection.rentalId !== rentalId) {
      continue;
    }
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const clock = photoClock(row.takenAt, row.takenAtSource, row.createdAt);
    const preview = previewFor(row.mimeType, row.sharePath);
    const photo: DriverStaffPhoto = {
      id: row.id,
      kind: "condition",
      event,
      rentalId,
      vehicleId: row.vehicleId,
      angle: row.angle,
      mimeType: row.mimeType,
      at: clock.at,
      timeLabel: clock.timeLabel,
      preview,
      url: null,
    };
    const bucket = event === "pickup" ? pickup : returned;
    const list = bucket.get(rentalId) ?? [];
    list.push(photo);
    bucket.set(rentalId, list);
    const share = signableSharePath(row.storagePath, row.sharePath);
    if (preview === "ready" && share && row.storageBucket) {
      shares.push({ key: `condition:${row.id}`, bucket: row.storageBucket, path: share });
    }
  }

  const swapsByRental = new Map<string, SwapRow[]>();
  const swapById = new Map<string, SwapRow>();
  for (const swap of input.swaps) {
    if (!visible.has(swap.rentalId)) continue;
    swapById.set(swap.id, swap);
    const list = swapsByRental.get(swap.rentalId) ?? [];
    list.push(swap);
    swapsByRental.set(swap.rentalId, list);
  }
  const photosBySwap = new Map<string, DriverStaffPhoto[]>();
  for (const row of input.swapPhotos) {
    const swap = swapById.get(row.swapId);
    if (!swap) continue;
    if (!isStillImage("photo", row.mimeType)) continue;
    const preview = previewFor(row.mimeType, null);
    const photo: DriverStaffPhoto = {
      id: row.id,
      kind: "swap",
      event: "swap",
      rentalId: swap.rentalId,
      vehicleId: row.vehicleId || swap.toVehicleId,
      angle: null,
      mimeType: row.mimeType,
      at: row.createdAt,
      timeLabel: "Uploaded",
      preview,
      url: null,
    };
    const list = photosBySwap.get(swap.id) ?? [];
    list.push(photo);
    photosBySwap.set(swap.id, list);
  }

  const rentals: DriverStaffRental[] = [];
  const ranked = [...visible.values()].sort((a, b) => {
    const stageA = rentalPortalStage(a.status, a.endDate, input.todayEt);
    const stageB = rentalPortalStage(b.status, b.endDate, input.todayEt);
    if (stageA !== stageB) return stageA === "active" ? -1 : 1;
    return String(b.startDate ?? "").localeCompare(String(a.startDate ?? ""));
  });

  for (const rental of ranked) {
    const swaps = (swapsByRental.get(rental.id) ?? [])
      .slice()
      .sort(
        (a, b) =>
          (a.swapNumber ?? 0) - (b.swapNumber ?? 0) || a.createdAt.localeCompare(b.createdAt),
      )
      .map((swap) => ({
        swapId: swap.id,
        swapNumber: swap.swapNumber,
        at: swap.createdAt,
        vehicle: vehicleLabel(vehicles.get(swap.toVehicleId), swap.toVehicleId),
        photos: (photosBySwap.get(swap.id) ?? []).slice().sort(byTime),
      }));
    const pickupBlocks = blocksFor(pickup.get(rental.id) ?? [], vehicles);
    const returnBlocks = blocksFor(returned.get(rental.id) ?? [], vehicles);
    const hasPhotos =
      pickupBlocks.some((block) => block.photos.length > 0) ||
      returnBlocks.some((block) => block.photos.length > 0) ||
      swaps.some((swap) => swap.photos.length > 0);
    if (!hasPhotos && swaps.length === 0) continue;
    rentals.push({
      rentalId: rental.id,
      stage:
        rentalPortalStage(rental.status, rental.endDate, input.todayEt) === "active"
          ? "active"
          : "returned",
      startDate: dateOnly(rental.startDate),
      endDate: dateOnly(rental.endDate),
      pickup: pickupBlocks,
      swaps,
      returnPhotos: returnBlocks,
    });
  }

  return { album: { rentals }, shares };
}

export function applySignedUrls(
  album: DriverStaffAlbum,
  urls: ReadonlyMap<string, string | null>,
): DriverStaffAlbum {
  const mapPhoto = (photo: DriverStaffPhoto): DriverStaffPhoto => {
    if (photo.preview !== "ready") return photo;
    const url = urls.get(`${photo.kind}:${photo.id}`) ?? null;
    if (!url) return { ...photo, url: null, preview: "unavailable" };
    return { ...photo, url };
  };
  const mapBlock = (block: DriverStaffBlock): DriverStaffBlock => ({
    ...block,
    photos: block.photos.map(mapPhoto),
  });
  return {
    rentals: album.rentals.map((rental) => ({
      ...rental,
      pickup: rental.pickup.map(mapBlock),
      returnPhotos: rental.returnPhotos.map(mapBlock),
      swaps: rental.swaps.map((swap) => ({ ...swap, photos: swap.photos.map(mapPhoto) })),
    })),
  };
}
