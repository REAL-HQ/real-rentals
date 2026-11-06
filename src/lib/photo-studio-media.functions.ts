// Photo Studio — originals (PR A).
//
// A car photo that Fleet Inbox has tied to a car (a person approved the match,
// or attached it) is copied once into the PRIVATE vehicle-originals bucket and
// recorded as a team-only `original` row. Originals are never published and
// are only ever handed out as short-lived signed URLs to staff.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";
import { ORIGINALS_BUCKET, type PhotoClass } from "@/lib/photo-studio";

const SIGNED_URL_SECONDS = 300;
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

const PHOTO_CLASS = z.enum([
  "exterior_front", "exterior_rear", "exterior_driver", "exterior_passenger", "exterior_other",
  "interior_dash", "interior_front", "interior_rear", "interior_other",
  "damage", "document", "odometer", "vin_plate", "unknown",
]);

/** Map Fleet Inbox photo classes onto studio classes. Damage stays damage. */
export function studioClassFromInbox(docClass: string | null | undefined, angle?: string | null): PhotoClass {
  switch (docClass) {
    case "damage_photo": case "repair_photo": return "damage";
    case "odometer_photo": return "odometer";
    case "vin_photo": return "vin_plate";
    case "condition_photo": case "acquisition_photo": {
      const a = PHOTO_CLASS.safeParse(angle);
      return a.success ? a.data : "exterior_other";
    }
    default: return "unknown";
  }
}

/** Copy one Fleet Inbox photo (already linked to `vehicleId`) into originals. */
export const attachInboxPhotoAsOriginal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    itemId: z.string().uuid(), vehicleId: z.string().uuid(), photoClass: PHOTO_CLASS.optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    const sb = await admin();
    const { data: item } = await sb.from("fleet_import_items").select("id,document_id,doc_class,extraction").eq("id", data.itemId).maybeSingle();
    if (!item?.document_id) return { ok: false as const, error: "Inbox item not found." };
    // The photo must already be linked to this car by an approved match or an
    // explicit attach. The studio never decides identity on its own.
    const { data: link } = await sb.from("document_vehicle_links").select("vehicle_id").eq("document_id", item.document_id).eq("vehicle_id", data.vehicleId).maybeSingle();
    if (!link) return { ok: false as const, error: "Link this photo to the car in Fleet Inbox first." };
    const { data: existing } = await (sb.from("vehicle_media") as any).select("id").eq("fleet_inbox_item_id", data.itemId).eq("vehicle_id", data.vehicleId).maybeSingle();
    if (existing) return { ok: true as const, mediaId: existing.id as string, duplicate: true };

    const { data: doc } = await sb.from("documents").select("storage_bucket,storage_path,file_name,mime_type").eq("id", item.document_id).maybeSingle();
    if (!doc) return { ok: false as const, error: "File missing." };
    const { data: file, error: dlErr } = await sb.storage.from(doc.storage_bucket as string).download(doc.storage_path as string);
    if (dlErr || !file) return { ok: false as const, error: "Could not read the file." };

    const photoClass = data.photoClass ?? studioClassFromInbox(item.doc_class as string, (item.extraction as any)?.photoAngle ?? null);
    const path = `${data.vehicleId}/${crypto.randomUUID()}-${(doc.file_name as string | null)?.replace(/[^\w.-]/g, "_") ?? "photo.jpg"}`;
    const up = await sb.storage.from(ORIGINALS_BUCKET).upload(path, file, { contentType: (doc.mime_type as string) ?? "image/jpeg", upsert: false });
    if (up.error) return { ok: false as const, error: "Upload to originals failed." };

    const { data: row, error } = await sb.from("vehicle_media").insert({
      vehicle_id: data.vehicleId, kind: "original", provenance: "uploaded", storage_bucket: ORIGINALS_BUCKET,
      storage_path: path, file_name: doc.file_name, mime_type: doc.mime_type, published: false,
      fleet_inbox_item_id: data.itemId, photo_class: photoClass, uploaded_by: actor.userId,
    } as any).select("id").single();
    if (error) { await sb.storage.from(ORIGINALS_BUCKET).remove([path]); return { ok: false as const, error: "Could not record the original." }; }
    await logAudit(actor, { action: "photo_studio.original_attached", summary: `Original photo attached (${photoClass})`, entityType: "vehicle", entityId: data.vehicleId, metadata: { itemId: data.itemId, mediaId: row.id } });
    return { ok: true as const, mediaId: row.id as string, duplicate: false };
  });

/** Re-label an original's angle (the AI guess can be wrong). */
export const setOriginalPhotoClass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ mediaId: z.string().uuid(), photoClass: PHOTO_CLASS }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context.userId);
    const sb = await admin();
    const { error } = await sb.from("vehicle_media").update({ photo_class: data.photoClass } as any).eq("id", data.mediaId).eq("kind", "original");
    return error ? { ok: false as const, error: "Could not update." } : { ok: true as const };
  });

/** Staff-only list of a car's originals and marketing shots, as signed URLs. */
export const listStudioMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context.userId);
    const sb = await admin();
    const { data: rows } = await (sb.from("vehicle_media") as any)
      .select("id,kind,storage_bucket,storage_path,photo_class,shot_slot,studio_review_status,studio_check,generation_model,source_media_ids,published,approved_at,created_at")
      .eq("vehicle_id", data.vehicleId).in("kind", ["original", "marketing"]).order("created_at");
    const out = [];
    for (const r of (rows ?? []) as any[]) {
      const { data: s } = await sb.storage.from(r.storage_bucket).createSignedUrl(r.storage_path, SIGNED_URL_SECONDS);
      out.push({ ...r, url: s?.signedUrl ?? null });
    }
    return { items: out };
  });
