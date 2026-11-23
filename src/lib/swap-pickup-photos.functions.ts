// Staff-only pickup photos on a vehicle swap (Bookings → rental → Vehicles card
// → the swap entry). Coordinator and above. Uploading inserts a photo row and
// never updates the swap, the rental or the vehicles.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { SWAP_PICKUP_PHOTO_MAX_BYTES } from "@/lib/swap-pickup-photos";

export type SwapPickupUploadResult = {
  ok: boolean;
  error?: string;
  path?: string;
  token?: string;
  bucket?: string;
  mimeType?: string | null;
  id?: string;
  duplicate?: boolean;
};

type UploadBody = SwapPickupUploadResult & {
  rentalId?: string;
  swapNumber?: number;
  vehicleId?: string;
};

function publish(body: UploadBody): SwapPickupUploadResult {
  return {
    ok: body.ok,
    error: body.error,
    path: body.path,
    token: body.token,
    bucket: body.bucket,
    mimeType: body.mimeType,
    id: body.id,
    duplicate: body.duplicate,
  };
}

const SwapId = z.object({ swapId: z.string().uuid() }).strict();
const ReserveInput = SwapId.extend({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().max(120),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(200 * 1024 * 1024),
}).strict();
const SaveInput = ReserveInput.extend({
  path: z.string().trim().min(3).max(400),
}).strict();

async function staff(userId: string) {
  const { requireStaff } = await import("@/lib/roles.server");
  return requireStaff(userId);
}
async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { supabaseSwapPhotoDb } = await import("@/lib/swap-pickup-photos.server");
  return supabaseSwapPhotoDb(supabaseAdmin);
}

export const listSwapPickupPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SwapId.parse(d))
  .handler(async ({ data, context }) => {
    await staff(context.userId);
    const { listSwapPickupPhotos: list } = await import("@/lib/swap-pickup-photos.server");
    return list(await db(), data.swapId);
  });

export const reserveSwapPickupPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ReserveInput.parse(d))
  .handler(async ({ data, context }) => {
    await staff(context.userId);
    if (data.sizeBytes > SWAP_PICKUP_PHOTO_MAX_BYTES) {
      return { ok: false, error: "Larger than 50 MB." };
    }
    const { reserveSwapPickupPhoto: reserve } = await import("@/lib/swap-pickup-photos.server");
    return publish((await reserve(await db(), data)).body);
  });

export const saveSwapPickupPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data, context }) => {
    const actor = await staff(context.userId);
    if (data.sizeBytes > SWAP_PICKUP_PHOTO_MAX_BYTES) {
      return { ok: false, error: "Larger than 50 MB." };
    }
    const { saveSwapPickupPhoto: save } = await import("@/lib/swap-pickup-photos.server");
    const result = await save(await db(), { ...data, actorUserId: context.userId });
    const body = result.body;
    if (body.ok === true && body.duplicate !== true && typeof body.rentalId === "string") {
      try {
        const { logAudit } = await import("@/lib/audit.server");
        await logAudit(actor, {
          action: "rental.vehicle_swap_pickup_photo",
          summary: `Added a pickup photo to vehicle swap S-${body.swapNumber}`,
          entityType: "rental",
          entityId: body.rentalId,
          metadata: {
            swap_id: data.swapId,
            photo_id: body.id ?? null,
            vehicle_id: body.vehicleId ?? null,
            mime_type: data.mimeType,
            size_bytes: data.sizeBytes,
          },
        });
      } catch {
        // The photo row is already stored. An audit miss must not look like a failed upload.
      }
    }
    return publish(body);
  });
