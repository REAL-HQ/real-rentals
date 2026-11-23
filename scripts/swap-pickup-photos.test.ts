// Pickup photos on a vehicle swap: still images in the private condition-media
// bucket, shown on the rental Vehicles card. A Completed swap stays Completed.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  SWAP_PICKUP_PHOTO_MAX_BYTES,
  SWAP_PICKUP_PHOTO_MAX_COUNT,
  swapPickupAdditionError,
  swapPickupBatchError,
  swapPickupPhotoMime,
  swapPickupPhotoPathOk,
  swapPickupVehicleLine,
} from "@/lib/swap-pickup-photos";
import {
  listSwapPickupPhotos,
  reserveSwapPickupPhoto,
  saveSwapPickupPhoto,
  type SwapForPhotos,
  type SwapPhotoDb,
  type SwapPhotoRow,
} from "@/lib/swap-pickup-photos.server";

const read = (f: string) => readFileSync(f, "utf8");
const MB = 1024 * 1024;
const SWAP_ID = "70000000-0000-4000-8000-000000000001";
const VEHICLE_ID = "c0000000-0000-4000-8000-000000000002";
const ACTOR = "b0000000-0000-4000-8000-0000000000aa";

function jpeg(size: number) {
  const bytes = new Uint8Array(16);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xe0;
  return { bytes, size };
}

function png(size: number) {
  const bytes = new Uint8Array(16);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return { bytes, size };
}

function harness(status = "completed", head: { bytes: Uint8Array; size: number | null } | null = jpeg(4 * MB)) {
  const swap = Object.freeze({
    id: SWAP_ID,
    to_vehicle_id: VEHICLE_ID,
    rental_id: "d0000000-0000-4000-8000-000000000001",
    swap_number: 4242,
    status,
  }) as SwapForPhotos;
  const before = JSON.stringify(swap);
  const photos: SwapPhotoRow[] = [];
  const removed: string[] = [];
  const db: SwapPhotoDb = {
    async loadSwap(id) {
      return id === swap.id ? swap : null;
    },
    async countPhotos() {
      return photos.length;
    },
    async findByPath(path) {
      const row = photos.find((p) => p.storage_path === path);
      return row ? { id: row.id } : null;
    },
    async insertPhoto(row) {
      if (photos.some((p) => p.storage_path === row.storage_path)) {
        const err = new Error("duplicate key value violates unique constraint");
        (err as { code?: string }).code = "23505";
        throw err;
      }
      const saved: SwapPhotoRow = {
        id: crypto.randomUUID(),
        swap_id: row.swap_id,
        vehicle_id: row.vehicle_id,
        storage_bucket: row.storage_bucket,
        storage_path: row.storage_path,
        file_name: row.file_name,
        mime_type: row.mime_type,
        size_bytes: row.size_bytes,
        uploaded_by: row.uploaded_by,
        created_at: new Date().toISOString(),
      };
      photos.push(saved);
      return { id: saved.id };
    },
    async listPhotos() {
      return photos.map((p) => ({ ...p }));
    },
    async signUpload(path) {
      return { path, token: "upload-token" };
    },
    async signRead(path) {
      return `https://example.test/signed/${encodeURIComponent(path)}`;
    },
    async readHead() {
      return head;
    },
    async removeObject(path) {
      removed.push(path);
    },
  };
  return { swap, before, db, photos, removed };
}

async function add(db: SwapPhotoDb, swapId: string, size = 4 * MB) {
  const reserved = await reserveSwapPickupPhoto(db, {
    swapId,
    fileName: "pickup.jpg",
    mimeType: "image/jpeg",
    sizeBytes: size,
  });
  if (reserved.body.ok !== true) return reserved;
  return saveSwapPickupPhoto(db, {
    swapId,
    path: String(reserved.body.path),
    fileName: "pickup.jpg",
    mimeType: "image/jpeg",
    sizeBytes: size,
    actorUserId: ACTOR,
  });
}

describe("file rules", () => {
  test("accepts the still-image types staff actually drop, including a bare image/jpg", () => {
    expect(swapPickupPhotoMime("a.jpg", "image/jpeg")).toBe("image/jpeg");
    expect(swapPickupPhotoMime("a.jpg", "image/jpg")).toBe("image/jpeg");
    expect(swapPickupPhotoMime("a.HEIC", "")).toBe("image/heic");
    expect(swapPickupPhotoMime("a.png", "image/png")).toBe("image/png");
    expect(swapPickupPhotoMime("a.webp", "image/webp")).toBe("image/webp");
    expect(swapPickupPhotoMime("a.mp4", "video/mp4")).toBeNull();
    expect(swapPickupPhotoMime("a.pdf", "application/pdf")).toBeNull();
  });

  test("a first batch of 42 photos at 4 MB fits, and 50 MB is the per-file cap", () => {
    const files = Array.from({ length: 42 }, () => ({ sizeBytes: 4 * MB, fileName: "pickup.jpg", mimeType: "image/jpeg" }));
    expect(swapPickupBatchError(0, files)).toBeNull();
    expect(swapPickupAdditionError({ existingCount: 0, sizeBytes: 4 * MB, fileName: "pickup.jpg", mimeType: "image/jpeg" })).toBeNull();
    expect(swapPickupAdditionError({ existingCount: 0, sizeBytes: SWAP_PICKUP_PHOTO_MAX_BYTES, fileName: "pickup.jpg", mimeType: "image/jpeg" })).toBeNull();
    expect(swapPickupAdditionError({ existingCount: 0, sizeBytes: SWAP_PICKUP_PHOTO_MAX_BYTES + 1, fileName: "pickup.jpg", mimeType: "image/jpeg" })).toBe("Larger than 50 MB.");
    expect(swapPickupAdditionError({ existingCount: 0, sizeBytes: 4 * MB, fileName: "clip.mp4", mimeType: "video/mp4" })).toBe("Use a JPEG, PNG, WebP or HEIC photo.");
    expect(swapPickupBatchError(0, Array.from({ length: SWAP_PICKUP_PHOTO_MAX_COUNT + 1 }, () => ({ sizeBytes: 2 * MB, fileName: "pickup.jpg", mimeType: "image/jpeg" })))).toMatch(/No files were saved/);
    expect(swapPickupAdditionError({ existingCount: SWAP_PICKUP_PHOTO_MAX_COUNT, sizeBytes: 2 * MB, fileName: "pickup.jpg", mimeType: "image/jpeg" })).toMatch(/80 pickup photos/);
  });

  test("the vehicle line is plate and VIN last 6, never the unit number", () => {
    const line = swapPickupVehicleLine({
      unit_number: "U-1000",
      license_plate: "ec20lk",
      vin: "1FA6P0HD0F5100001",
    });
    expect(line).toBe("EC20LK · VIN …100001");
    expect(line).not.toContain("U-1000");
    expect(line).not.toContain("1FA6P0HD0F5100001");
  });
});

describe("saving never changes the swap", () => {
  test("42 photos land on a Completed swap and the swap is untouched", async () => {
    const h = harness("completed");
    for (let i = 0; i < 42; i++) {
      const saved = await add(h.db, h.swap.id);
      expect(saved.body.ok).toBe(true);
    }
    expect(h.photos).toHaveLength(42);
    expect(h.photos.every((p) => p.swap_id === SWAP_ID && p.vehicle_id === VEHICLE_ID)).toBe(true);
    expect(h.photos.every((p) => p.size_bytes === 4 * MB && p.mime_type === "image/jpeg")).toBe(true);
    expect(JSON.stringify(h.swap)).toBe(h.before);
    expect(h.swap.status).toBe("completed");
    const listed = await listSwapPickupPhotos(h.db, h.swap.id);
    expect(listed.installed).toBe(true);
    expect(listed.photos).toHaveLength(42);
    expect(listed.photos[0].url).toContain("https://example.test/signed/");
    expect(JSON.stringify(h.swap)).toBe(h.before);
  });

  test("signed, voided and send_failed swaps accept a photo too", async () => {
    for (const status of ["signed", "voided", "send_failed", "pending_signature"]) {
      const h = harness(status);
      const saved = await add(h.db, h.swap.id);
      expect(saved.body.ok).toBe(true);
      expect(h.swap.status).toBe(status);
      expect(JSON.stringify(h.swap)).toBe(h.before);
    }
  });

  test("the 81st photo is refused and the completed swap stays completed", async () => {
    const h = harness("completed");
    for (let i = 0; i < SWAP_PICKUP_PHOTO_MAX_COUNT; i++) {
      const saved = await add(h.db, h.swap.id, 2 * MB);
      expect(saved.body.ok).toBe(true);
    }
    const extra = await add(h.db, h.swap.id, 2 * MB);
    expect(extra.body.ok).toBe(false);
    expect(String(extra.body.error)).toMatch(/80 pickup photos/);
    expect(h.photos).toHaveLength(SWAP_PICKUP_PHOTO_MAX_COUNT);
    expect(h.swap.status).toBe("completed");
    expect(JSON.stringify(h.swap)).toBe(h.before);
  });

  test("a file that is not a photo is removed and not recorded", async () => {
    const h = harness("completed", { bytes: new Uint8Array(16), size: 4 * MB });
    const reserved = await reserveSwapPickupPhoto(h.db, {
      swapId: h.swap.id,
      fileName: "pickup.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4 * MB,
    });
    expect(reserved.body.ok).toBe(true);
    const path = String(reserved.body.path);
    expect(swapPickupPhotoPathOk(path, VEHICLE_ID, SWAP_ID)).toBe(true);
    const saved = await saveSwapPickupPhoto(h.db, {
      swapId: h.swap.id,
      path,
      fileName: "pickup.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4 * MB,
      actorUserId: ACTOR,
    });
    expect(saved.body.ok).toBe(false);
    expect(h.photos).toHaveLength(0);
    expect(h.removed).toEqual([path]);
    expect(h.swap.status).toBe("completed");
  });

  test("a claimed JPEG that is really a PNG is removed", async () => {
    const h = harness("completed", png(3 * MB));
    const reserved = await reserveSwapPickupPhoto(h.db, {
      swapId: h.swap.id,
      fileName: "pickup.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 3 * MB,
    });
    const saved = await saveSwapPickupPhoto(h.db, {
      swapId: h.swap.id,
      path: String(reserved.body.path),
      fileName: "pickup.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 3 * MB,
      actorUserId: ACTOR,
    });
    expect(saved.body.ok).toBe(false);
    expect(String(saved.body.error)).toMatch(/don't match/);
    expect(h.photos).toHaveLength(0);
    expect(h.removed).toHaveLength(1);
    expect(h.swap.status).toBe("completed");
  });

  test("an object larger than 50 MB is removed even if the client under-reported it", async () => {
    const h = harness("completed", jpeg(SWAP_PICKUP_PHOTO_MAX_BYTES + 1));
    const reserved = await reserveSwapPickupPhoto(h.db, {
      swapId: h.swap.id,
      fileName: "pickup.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4 * MB,
    });
    const saved = await saveSwapPickupPhoto(h.db, {
      swapId: h.swap.id,
      path: String(reserved.body.path),
      fileName: "pickup.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4 * MB,
      actorUserId: ACTOR,
    });
    expect(saved.body.ok).toBe(false);
    expect(String(saved.body.error)).toBe("Larger than 50 MB.");
    expect(h.photos).toHaveLength(0);
    expect(h.removed).toHaveLength(1);
    expect(h.swap.status).toBe("completed");
  });

  test("a path outside this swap is refused and not deleted", async () => {
    const h = harness("completed");
    const saved = await saveSwapPickupPhoto(h.db, {
      swapId: h.swap.id,
      path: `${VEHICLE_ID}/trip/someone-else.jpg`,
      fileName: "pickup.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4 * MB,
      actorUserId: ACTOR,
    });
    expect(saved.body.ok).toBe(false);
    expect(h.removed).toHaveLength(0);
    expect(h.photos).toHaveLength(0);
    expect(h.swap.status).toBe("completed");
  });

  test("saving the same object twice does not insert a second row", async () => {
    const h = harness("completed");
    const first = await add(h.db, h.swap.id);
    const again = await saveSwapPickupPhoto(h.db, {
      swapId: h.swap.id,
      path: h.photos[0].storage_path,
      fileName: "pickup.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4 * MB,
      actorUserId: ACTOR,
    });
    expect(first.body.ok).toBe(true);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.id).toBe(first.body.id);
    expect(h.photos).toHaveLength(1);
    expect(h.swap.status).toBe("completed");
  });

  test("a missing photo table refuses before any upload", async () => {
    const h = harness("completed");
    h.db.loadSwap = async () => "missing";
    const reserved = await reserveSwapPickupPhoto(h.db, {
      swapId: h.swap.id,
      fileName: "pickup.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4 * MB,
    });
    expect(reserved.body.ok).toBe(false);
    expect(String(reserved.body.error)).toMatch(/database update/i);
    expect(h.photos).toHaveLength(0);
  });
});

describe("where it shows up", () => {
  const history = read("src/components/admin/BookingVehicleHistory.tsx");
  const ui = read("src/components/admin/SwapPickupPhotos.tsx");
  const server = read("src/lib/swap-pickup-photos.server.ts");
  const fns = read("src/lib/swap-pickup-photos.functions.ts");
  const sql = read("supabase/migrations/20261123120000_swap_pickup_photos.sql");
  const portal = read("src/routes/portal.tsx");

  test("the control is on the swap entry in the Vehicles card, for every status", () => {
    expect(history.indexOf('data-testid="swap-entry"')).toBeGreaterThan(-1);
    expect(history.indexOf("<SwapPickupPhotos")).toBeGreaterThan(history.indexOf('data-testid="swap-entry"'));
    expect(history.indexOf("<SwapPickupPhotos")).toBeLessThan(history.indexOf("function OpenSwapCard"));
    expect(history).not.toMatch(/status === ["']completed["'].*SwapPickupPhotos|SwapPickupPhotos[\s\S]{0,80}completed/);
    expect(ui).toContain("Pickup Photos");
    expect(ui).toContain("Saving Photos Does Not Change The Swap.");
    expect(ui).toContain("multiple");
    expect(ui).toContain("maxFiles={room}");
    expect(ui).toContain("SWAP_PICKUP_PHOTO_MAX_COUNT");
    expect(ui).toContain("Add Pickup Photos");
    expect(ui).toContain("Enlarge Pickup Photo");
    expect(ui).toContain("swapPickupVehicleLine");
    expect(ui).not.toMatch(/unit_number|formatVehicleLabel|text-transform|uppercase/);
    expect(ui).not.toMatch(/<input[^>]*type=["']file["']/);
  });

  test("staff only, and renters are not given a new path", () => {
    expect(fns).toContain("requireStaff");
    expect(fns).not.toMatch(/^import\s.*swap-pickup-photos\.server/m);
    expect(fns.match(/await import\("@\/lib\/swap-pickup-photos\.server"\)/g)?.length).toBeGreaterThan(0);
    expect(portal).not.toContain("swap-pickup-photos");
    expect(portal).not.toContain("Pickup Photos");
    expect(read("src/lib/inspections.functions.ts")).toContain('data.path.includes("/swap/")');
  });

  test("the server never updates a swap, and the migration only adds the photo table", () => {
    expect(server).not.toContain(".update(");
    expect(server).not.toContain("complete_rental_vehicle_swap");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.rental_vehicle_swap_photos");
    expect(sql).toContain("condition-media");
    expect(sql).toContain("52428800");
    expect(sql).toContain("private.is_staff()");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rental_vehicle_swap_photos FROM authenticated");
    expect(sql).not.toMatch(/UPDATE\s+public\.rental_vehicle_swaps/i);
    expect(sql).not.toContain("9108ea8c-528f-4a81-9237-af505a1b208a");
    expect(server).not.toContain("9108ea8c-528f-4a81-9237-af505a1b208a");
  });
});
