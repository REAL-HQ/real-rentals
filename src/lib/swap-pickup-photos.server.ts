/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase service-role client, as elsewhere in src/lib */
/**
 * Staff pickup photos for one vehicle swap.
 *
 * Storage is the existing private condition-media bucket, via a signed upload
 * URL (the file bytes never pass through this server). The database row is
 * insert-only. This module has no update of rental_vehicle_swaps, rentals,
 * vehicles, agreements or payments — a Completed swap stays Completed.
 *
 * This module signs originals for staff. The driver portal does not use it.
 * Drivers read the same rows through driver-staff-photos and only receive a
 * metadata-free copy. condition_media is a different table;
 * confirmConditionUpload refuses a /swap/ path so these objects cannot be
 * filed as renter-visible trip photos.
 */
import { tableMissing } from "@/lib/fleet-api.server";
import { VEHICLE_SWAPS_TABLE } from "@/lib/vehicle-swap";
import { verifyMagic } from "@/lib/trip-media";
import {
  SWAP_PICKUP_PHOTO_BUCKET,
  SWAP_PICKUP_PHOTO_MAX_BYTES,
  SWAP_PICKUP_PHOTO_MAX_COUNT,
  SWAP_PICKUP_PHOTOS_TABLE,
  swapPickupAdditionError,
  swapPickupFileName,
  swapPickupPhotoExt,
  swapPickupPhotoMime,
  swapPickupPhotoPathOk,
  swapPickupPhotoPrefix,
} from "@/lib/swap-pickup-photos";

const NOT_INSTALLED = "Pickup photos are not available until the database update is applied.";
const HEAD_BYTES = 256 * 1024;

export type SwapForPhotos = {
  id: string;
  to_vehicle_id: string;
  rental_id: string;
  swap_number: number;
  status: string;
};

export type SwapPhotoRow = {
  id: string;
  swap_id: string;
  vehicle_id: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
};

export type SwapPickupPhotoView = {
  id: string;
  fileName: string | null;
  mimeType: string;
  sizeBytes: number | null;
  createdAt: string;
  url: string | null;
};

export type SwapPhotoBody = {
  ok: boolean;
  error?: string;
  path?: string;
  token?: string;
  bucket?: string;
  mimeType?: string | null;
  id?: string;
  duplicate?: boolean;
  rentalId?: string;
  swapNumber?: number;
  vehicleId?: string;
};

export type SwapPhotoResult = { status: number; body: SwapPhotoBody };

type PhotoInsert = {
  id?: string;
  swap_id: string;
  vehicle_id: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string;
  size_bytes: number | null;
  uploaded_by: string | null;
};

/**
 * Narrow store so the rules can be tested without Supabase.
 * There is no method that updates a swap.
 */
export type SwapPhotoDb = {
  loadSwap(swapId: string): Promise<SwapForPhotos | null | "missing">;
  countPhotos(swapId: string): Promise<number | "missing">;
  findByPath(path: string): Promise<{ id: string } | null>;
  insertPhoto(row: PhotoInsert): Promise<{ id: string }>;
  listPhotos(swapId: string): Promise<SwapPhotoRow[] | "missing">;
  signUpload(path: string): Promise<{ path: string; token: string } | null>;
  signRead(path: string): Promise<string | null>;
  readHead(path: string): Promise<{ bytes: Uint8Array; size: number | null } | null>;
  removeObject(path: string): Promise<void>;
};

const fail = (status: number, error: string): SwapPhotoResult => ({
  status,
  body: { ok: false, error },
});

function isUnique(e: unknown): boolean {
  const code = String((e as { code?: string })?.code ?? "");
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return code === "23505" || /duplicate key|already exists/i.test(msg);
}

async function countOrMissing(db: SwapPhotoDb, swapId: string): Promise<number | "missing"> {
  try {
    return await db.countPhotos(swapId);
  } catch (e) {
    if (tableMissing(e, SWAP_PICKUP_PHOTOS_TABLE)) return "missing";
    throw e;
  }
}

export async function listSwapPickupPhotos(
  db: SwapPhotoDb,
  swapId: string,
): Promise<{ installed: boolean; photos: SwapPickupPhotoView[] }> {
  let rows: SwapPhotoRow[] | "missing";
  try {
    rows = await db.listPhotos(swapId);
  } catch (e) {
    if (tableMissing(e, SWAP_PICKUP_PHOTOS_TABLE)) return { installed: false, photos: [] };
    throw e;
  }
  if (rows === "missing") return { installed: false, photos: [] };
  const photos: SwapPickupPhotoView[] = [];
  for (const row of rows) {
    const url =
      row.storage_bucket === SWAP_PICKUP_PHOTO_BUCKET ? await db.signRead(row.storage_path) : null;
    photos.push({
      id: row.id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      url,
    });
  }
  return { installed: true, photos };
}

export async function reserveSwapPickupPhoto(
  db: SwapPhotoDb,
  input: { swapId: string; fileName: string; mimeType: string | null; sizeBytes: number },
): Promise<SwapPhotoResult> {
  const swap = await db.loadSwap(input.swapId);
  if (swap === "missing") return fail(503, NOT_INSTALLED);
  if (!swap) return fail(404, "That swap was not found.");
  const vehicleId = String(swap.to_vehicle_id).toLowerCase();
  const swapId = String(swap.id).toLowerCase();
  const mime = swapPickupPhotoMime(input.fileName, input.mimeType);
  const count = await countOrMissing(db, swap.id);
  if (count === "missing") return fail(503, NOT_INSTALLED);
  const problem = swapPickupAdditionError({
    existingCount: count,
    sizeBytes: input.sizeBytes,
    fileName: input.fileName,
    mimeType: mime,
  });
  if (problem) return fail(400, problem);
  const path = `${swapPickupPhotoPrefix(vehicleId, swapId)}${crypto.randomUUID()}.${swapPickupPhotoExt(mime!)}`;
  const signed = await db.signUpload(path);
  if (!signed) return fail(503, "Could not start the upload.");
  return {
    status: 200,
    body: {
      ok: true,
      path: signed.path,
      token: signed.token,
      bucket: SWAP_PICKUP_PHOTO_BUCKET,
      mimeType: mime,
    },
  };
}

export async function saveSwapPickupPhoto(
  db: SwapPhotoDb,
  input: {
    swapId: string;
    path: string;
    fileName: string;
    mimeType: string | null;
    sizeBytes: number;
    actorUserId: string;
  },
): Promise<SwapPhotoResult> {
  const swap = await db.loadSwap(input.swapId);
  if (swap === "missing") return fail(503, NOT_INSTALLED);
  if (!swap) return fail(404, "That swap was not found.");
  // Read-only use of the swap. Status (including completed) is not a gate and is not written.
  const vehicleId = String(swap.to_vehicle_id).toLowerCase();
  const swapId = String(swap.id).toLowerCase();
  if (!swapPickupPhotoPathOk(input.path, vehicleId, swapId)) {
    return fail(400, "Invalid upload path.");
  }
  const existing = await db.findByPath(input.path);
  if (existing)
    return {
      status: 200,
      body: {
        ok: true,
        duplicate: true,
        id: existing.id,
        rentalId: swap.rental_id,
        swapNumber: swap.swap_number,
      },
    };

  const claimed = swapPickupPhotoMime(input.fileName, input.mimeType);
  if (!claimed) {
    await db.removeObject(input.path).catch(() => {});
    return fail(400, "Use a JPEG, PNG, WebP or HEIC photo.");
  }

  const head = await db.readHead(input.path);
  if (!head) {
    await db.removeObject(input.path).catch(() => {});
    return fail(400, "The upload didn't arrive. Nothing was saved.");
  }
  let mime: string;
  try {
    mime = verifyMagic(claimed, head.bytes);
  } catch (e) {
    await db.removeObject(input.path).catch(() => {});
    return fail(
      400,
      e instanceof Error ? e.message : "The file's contents aren't a supported photo.",
    );
  }
  if (mime !== claimed) {
    await db.removeObject(input.path).catch(() => {});
    return fail(400, "The file's contents don't match its type.");
  }
  const size = head.size ?? input.sizeBytes;
  if (size > SWAP_PICKUP_PHOTO_MAX_BYTES) {
    await db.removeObject(input.path).catch(() => {});
    return fail(400, "Larger than 50 MB.");
  }
  const count = await countOrMissing(db, swap.id);
  if (count === "missing") {
    await db.removeObject(input.path).catch(() => {});
    return fail(503, NOT_INSTALLED);
  }
  if (count >= SWAP_PICKUP_PHOTO_MAX_COUNT) {
    await db.removeObject(input.path).catch(() => {});
    return fail(400, `This swap already has ${SWAP_PICKUP_PHOTO_MAX_COUNT} pickup photos.`);
  }

  try {
    const row = await db.insertPhoto({
      swap_id: swapId,
      vehicle_id: vehicleId,
      storage_bucket: SWAP_PICKUP_PHOTO_BUCKET,
      storage_path: input.path,
      file_name: swapPickupFileName(input.fileName),
      mime_type: mime,
      size_bytes: size,
      uploaded_by: input.actorUserId,
    });
    return {
      status: 200,
      body: {
        ok: true,
        id: row.id,
        rentalId: swap.rental_id,
        swapNumber: swap.swap_number,
        vehicleId: swap.to_vehicle_id,
      },
    };
  } catch (e) {
    if (isUnique(e)) {
      const again = await db.findByPath(input.path);
      if (again)
        return {
          status: 200,
          body: {
            ok: true,
            duplicate: true,
            id: again.id,
            rentalId: swap.rental_id,
            swapNumber: swap.swap_number,
          },
        };
    }
    await db.removeObject(input.path).catch(() => {});
    return fail(503, "Could not save the photo.");
  }
}

/** First bytes plus the real object size. Does not download a 2–4 MB photo whole. */
export async function readConditionObjectHead(
  admin: any,
  path: string,
): Promise<{ bytes: Uint8Array; size: number | null } | null> {
  const { data: signed, error } = await admin.storage
    .from(SWAP_PICKUP_PHOTO_BUCKET)
    .createSignedUrl(path, 60);
  if (error || !signed?.signedUrl) return null;
  const res = await fetch(signed.signedUrl, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
  if (!res.ok) return null;
  const range = res.headers.get("content-range");
  const total = range ? Number(range.split("/")[1]) : Number(res.headers.get("content-length"));
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let got = 0;
  while (got < HEAD_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    got += value.length;
  }
  await reader.cancel().catch(() => {});
  const bytes = new Uint8Array(Math.min(got, HEAD_BYTES));
  let o = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, bytes.length - o);
    bytes.set(c.subarray(0, take), o);
    o += take;
    if (o >= bytes.length) break;
  }
  return { bytes, size: Number.isFinite(total) && total > 0 ? total : null };
}

export function supabaseSwapPhotoDb(admin: any): SwapPhotoDb {
  return {
    async loadSwap(swapId) {
      const r = await admin
        .from(VEHICLE_SWAPS_TABLE)
        .select("id,to_vehicle_id,rental_id,swap_number,status")
        .eq("id", swapId)
        .maybeSingle();
      if (r.error) {
        if (tableMissing(r.error, VEHICLE_SWAPS_TABLE)) return "missing";
        throw new Error("Could not read the swap.");
      }
      return (r.data as SwapForPhotos | null) ?? null;
    },
    async countPhotos(swapId) {
      const r = await admin
        .from(SWAP_PICKUP_PHOTOS_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("swap_id", swapId);
      if (r.error) {
        if (tableMissing(r.error, SWAP_PICKUP_PHOTOS_TABLE)) return "missing";
        throw r.error;
      }
      return Number(r.count ?? 0);
    },
    async findByPath(path) {
      const r = await admin
        .from(SWAP_PICKUP_PHOTOS_TABLE)
        .select("id")
        .eq("storage_path", path)
        .maybeSingle();
      if (r.error) {
        if (tableMissing(r.error, SWAP_PICKUP_PHOTOS_TABLE)) return null;
        throw r.error;
      }
      return (r.data as { id: string } | null) ?? null;
    },
    async insertPhoto(row) {
      const r = await admin.from(SWAP_PICKUP_PHOTOS_TABLE).insert(row).select("id").single();
      if (r.error) throw r.error;
      return { id: String(r.data.id) };
    },
    async listPhotos(swapId) {
      const r = await admin
        .from(SWAP_PICKUP_PHOTOS_TABLE)
        .select(
          "id,swap_id,vehicle_id,storage_bucket,storage_path,file_name,mime_type,size_bytes,uploaded_by,created_at",
        )
        .eq("swap_id", swapId)
        .order("created_at", { ascending: true })
        .limit(SWAP_PICKUP_PHOTO_MAX_COUNT);
      if (r.error) {
        if (tableMissing(r.error, SWAP_PICKUP_PHOTOS_TABLE)) return "missing";
        throw r.error;
      }
      return (r.data ?? []) as SwapPhotoRow[];
    },
    async signUpload(path) {
      const { data, error } = await admin.storage
        .from(SWAP_PICKUP_PHOTO_BUCKET)
        .createSignedUploadUrl(path);
      if (error || !data?.token) return null;
      return { path, token: data.token };
    },
    async signRead(path) {
      const { data, error } = await admin.storage
        .from(SWAP_PICKUP_PHOTO_BUCKET)
        .createSignedUrl(path, 60 * 30);
      if (error || !data?.signedUrl) return null;
      return data.signedUrl as string;
    },
    readHead(path) {
      return readConditionObjectHead(admin, path);
    },
    async removeObject(path) {
      await admin.storage.from(SWAP_PICKUP_PHOTO_BUCKET).remove([path]);
    },
  };
}
