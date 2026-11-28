// Photo Studio — originals (PR A).
//
// A car photo that Fleet Inbox has tied to a car (a person approved the match,
// or attached it) is copied once into the PRIVATE vehicle-originals bucket and
// recorded as a team-only `original` row. Originals are never published and
// are only ever handed out as short-lived signed URLs to staff.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager, requireStaff } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";
import { ORIGINALS_BUCKET, isMissingPhotoClassColumn, slotReasonsFromAudits, type PhotoClass, type ShotSlot } from "@/lib/photo-studio";
import { classifyStudioGaps, type StudioFailure } from "@/lib/photo-studio-fleet";
import { isMissingDbColumn } from "@/lib/photo-class-label";

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

    // A class passed in was chosen by a person. Otherwise leave it unknown and
    // let the vision labeler fill it after the row exists.
    const photoClass = data.photoClass ?? "unknown";
    const path = `${data.vehicleId}/${crypto.randomUUID()}-${(doc.file_name as string | null)?.replace(/[^\w.-]/g, "_") ?? "photo.jpg"}`;
    const up = await sb.storage.from(ORIGINALS_BUCKET).upload(path, file, { contentType: (doc.mime_type as string) ?? "image/jpeg", upsert: false });
    if (up.error) return { ok: false as const, error: "Upload to originals failed." };

    const { data: row, error } = await sb.from("vehicle_media").insert({
      vehicle_id: data.vehicleId, kind: "original", provenance: "uploaded", storage_bucket: ORIGINALS_BUCKET,
      storage_path: path, file_name: doc.file_name, mime_type: doc.mime_type, published: false,
      fleet_inbox_item_id: data.itemId, photo_class: photoClass, uploaded_by: actor.userId,
    } as any).select("id").single();
    if (error) { await sb.storage.from(ORIGINALS_BUCKET).remove([path]); return { ok: false as const, error: "Could not record the original." }; }
    if (data.photoClass) {
      const { markPhotoClassManual } = await import("@/lib/photo-class-label.server");
      await markPhotoClassManual(row.id as string);
    } else {
      const { enqueuePhotoLabels } = await import("@/lib/photo-class-label.server");
      enqueuePhotoLabels([row.id as string], actor);
    }
    await logAudit(actor, { action: "photo_studio.original_attached", summary: `Original photo attached (${photoClass})`, entityType: "vehicle", entityId: data.vehicleId, metadata: { itemId: data.itemId, mediaId: row.id } });
    return { ok: true as const, mediaId: row.id as string, duplicate: false };
  });

/** Re-label an original's angle (the AI guess can be wrong). Manager+. */
export const setOriginalPhotoClass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ mediaId: z.string().uuid(), photoClass: PHOTO_CLASS }).parse(d))
  .handler(async ({ data, context }) => {
    await requireManager(context.userId);
    const sb = await admin();
    let { error } = await sb.from("vehicle_media").update({ photo_class: data.photoClass, photo_class_source: "manual" } as any).eq("id", data.mediaId).eq("kind", "original");
    if (error && isMissingDbColumn(error.message, "photo_class_source")) {
      const again = await sb.from("vehicle_media").update({ photo_class: data.photoClass } as any).eq("id", data.mediaId).eq("kind", "original");
      error = again.error;
    }
    if (!error) return { ok: true as const };
    if (isMissingPhotoClassColumn(error.message)) return { ok: false as const, error: "Photo classes are not on this database yet.", unavailable: true as const };
    return { ok: false as const, error: "Could not update." };
  });

/** Staff-only list of a car's originals and marketing shots, as signed URLs. */
export const listStudioMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context.userId);
    const sb = await admin();
    const withClass = "id,kind,storage_bucket,storage_path,photo_class,shot_slot,studio_review_status,studio_check,generation_model,source_media_ids,published,approved_at,created_at";
    let photoClassAvailable = true;
    let { data: rows, error } = await (sb.from("vehicle_media") as any)
      .select(withClass)
      .eq("vehicle_id", data.vehicleId).in("kind", ["original", "marketing"]).order("created_at");
    if (error && isMissingPhotoClassColumn(error.message)) {
      photoClassAvailable = false;
      const again = await (sb.from("vehicle_media") as any)
        .select(withClass.replace("photo_class,", ""))
        .eq("vehicle_id", data.vehicleId).in("kind", ["original", "marketing"]).order("created_at");
      rows = again.data;
      error = again.error;
    }
    if (error) return { items: [] as any[], photoClassAvailable: false, attentionSlots: [] as ShotSlot[], slotReasons: {} as Record<string, string> };
    const out = [];
    for (const r of (rows ?? []) as any[]) {
      const { data: s } = await sb.storage.from(r.storage_bucket).createSignedUrl(r.storage_path, SIGNED_URL_SECONDS);
      out.push({ ...r, url: s?.signedUrl ?? null });
    }
    const { data: fails } = await sb.from("photo_studio_spend")
      .select("shot_slot,created_at")
      .eq("vehicle_id", data.vehicleId)
      .eq("outcome", "rejected_check");
    const failures: StudioFailure[] = ((fails ?? []) as any[]).map((r) => ({
      slot: r.shot_slot ?? null,
      failedAt: r.created_at as string,
    }));
    const mediaRows = (rows ?? []) as any[];
    const gaps = classifyStudioGaps(
      mediaRows.filter((r) => r.kind === "original").map((r) => ({
        id: r.id as string,
        photoClass: (r.photo_class ?? null) as string | null,
        createdAt: (r.created_at ?? null) as string | null,
      })),
      mediaRows.filter((r) => r.kind === "marketing").map((r) => ({
        slot: r.shot_slot ?? null,
        status: r.studio_review_status ?? null,
        published: !!r.published,
        check: r.studio_check ?? null,
      })),
      failures,
    );
    const { data: audits } = await sb.from("audit_log")
      .select("created_at,metadata")
      .eq("action", "photo_studio.generate")
      .eq("entity_type", "vehicle")
      .eq("entity_id", data.vehicleId)
      .order("created_at", { ascending: false })
      .limit(30);
    const slotReasons = slotReasonsFromAudits((audits ?? []) as { created_at: string; metadata: unknown }[]);
    return { items: out, photoClassAvailable, attentionSlots: gaps.held, slotReasons };
  });
