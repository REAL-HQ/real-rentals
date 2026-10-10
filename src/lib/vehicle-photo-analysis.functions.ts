// Reading an ordinary vehicle photograph for vehicle details.
//
// There is no second extraction system here, and there must never be one. A
// photo enters the SAME Fleet Inbox pipeline every document uses — one reader,
// one queue, one matcher, one set of field rules, one review panel, one apply
// path — and the only thing this file adds is the doorway.
//
// Two decisions are worth stating plainly, because both are easy to get wrong:
//
//   The bytes are not copied. A `documents` row is created pointing at the
//   photograph where it already lives, in the private vehicle-photos bucket.
//   Copying it into vehicle-docs would put a second, separately-governed copy
//   of every car photo in the document vault, and the two would drift.
//
//   The declared class can only ever be a PHOTO class. A staff member cannot
//   announce "this snapshot is a title" and have it filed as Owner-only
//   paperwork — nor the reverse, smuggling title paperwork in through the
//   Photos tab to dodge the Owner gate on registerInboxFile.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff, requireOwner } from "@/lib/roles.server";
import { PHOTO_CLASSES } from "@/lib/fleet-inbox";
import { remainingOn, refusalReason, todayUtc, usedOn } from "@/lib/photo-reading";

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type PhotoReadResult = {
  ok: boolean;
  mediaId: string;
  itemId?: string;
  /** Already read before: the earlier item is reused rather than read again. */
  duplicate?: boolean;
  /** Slots left against the Owner's daily limit after this one was taken. */
  remainingToday?: number;
  error?: string;
};

/**
 * Queue one already-uploaded photograph for reading.
 *
 * The caller creates the batch once (createImportBatch with source
 * "vehicle_photo") and calls this per photo, then watches the batch with the
 * existing getImportBatch poll — exactly as the Documents tab does.
 */
export const readVehiclePhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      batchId: z.string().uuid(),
      vehicleId: z.string().uuid(),
      mediaId: z.string().uuid(),
      /** What the operator says the shot is. Only photo classes are accepted. */
      intendedClass: z.enum(PHOTO_CLASSES as unknown as [string, ...string[]]).default("condition_photo"),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<PhotoReadResult> => {
    const actor = await requireStaff(context.userId);
    const sb = await admin();

    const { data: media } = await sb
      .from("vehicle_media")
      .select("id,vehicle_id,kind,storage_bucket,storage_path,file_name,mime_type,size_bytes")
      .eq("id", data.mediaId)
      .maybeSingle();
    if (!media) return { ok: false, mediaId: data.mediaId, error: "That photo no longer exists." };
    if (media.vehicle_id !== data.vehicleId) {
      return { ok: false, mediaId: data.mediaId, error: "That photo belongs to a different vehicle." };
    }
    // A retouched derivative is not evidence of anything. Only originals are read.
    if (media.kind !== "original") {
      return { ok: false, mediaId: data.mediaId, error: "Only original photographs can be read — an enhanced copy is not evidence." };
    }

    // Reading the same photograph twice costs money and produces a second
    // identical proposal for staff to wade through. Reuse the earlier read.
    const { data: priorDoc } = await sb
      .from("documents")
      .select("id")
      .eq("storage_bucket", media.storage_bucket)
      .eq("storage_path", media.storage_path)
      .maybeSingle();
    if (priorDoc) {
      const { data: priorItem } = await sb
        .from("fleet_import_items")
        .select("id,status")
        .eq("document_id", priorDoc.id)
        .neq("status", "failed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (priorItem) return { ok: true, mediaId: data.mediaId, itemId: priorItem.id as string, duplicate: true };
    }

    const { data: file } = await sb.storage.from(media.storage_bucket).download(media.storage_path);
    if (!file) return { ok: false, mediaId: data.mediaId, error: "Could not read that photo from storage." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = media.mime_type || file.type || "image/jpeg";
    if (!/^image\/(jpeg|png|webp|gif)$/.test(String(mime).split(";")[0].trim())) {
      return { ok: false, mediaId: data.mediaId, error: `That file type (${mime}) can't be read.` };
    }
    const sha = await sha256Hex(bytes);

    let documentId = priorDoc?.id as string | undefined;
    if (!documentId) {
      const { data: doc, error: docErr } = await sb.from("documents").insert({
        kind: data.intendedClass, category: data.intendedClass,
        label: media.file_name ?? "Vehicle photo",
        vehicle_id: data.vehicleId,
        // Points at the photograph where it already lives. No second copy.
        storage_bucket: media.storage_bucket, storage_path: media.storage_path,
        file_name: media.file_name, mime_type: mime, size_bytes: media.size_bytes ?? bytes.byteLength,
        content_sha256: sha, is_current: true, visibility: ["admin"],
        uploaded_by: actor.userId, uploaded_by_role: actor.role,
        source: "vehicle_photo", review_status: "uploaded", evidence_class: "operational",
      }).select("id").single();
      if (docErr || !doc) {
        // Lost a race with a concurrent read of the same photo: reuse theirs.
        const { data: d2 } = await sb.from("documents").select("id")
          .eq("storage_bucket", media.storage_bucket).eq("storage_path", media.storage_path).maybeSingle();
        if (!d2) return { ok: false, mediaId: data.mediaId, error: "Could not record that photo for reading." };
        documentId = d2.id as string;
      } else {
        documentId = doc.id as string;
      }
    }

    // Everything above this line is free. From here a reading will be queued,
    // so a slot against the Owner's daily limit is taken FIRST — and handed
    // back below if the work never makes it onto the queue.
    const { reservePhotoRead, releasePhotoRead } = await import("@/lib/photo-reading.server");
    const slot = await reservePhotoRead(sb);
    if (!slot.ok) return { ok: false, mediaId: data.mediaId, error: slot.error };

    const { data: item } = await sb.from("fleet_import_items").insert({
      batch_id: data.batchId, document_id: documentId, file_name: media.file_name ?? "Vehicle photo",
      mime_type: mime, size_bytes: media.size_bytes ?? bytes.byteLength, content_sha256: sha,
      status: "uploaded",
      // The operator's expectation, not a reading — a confident classification wins.
      doc_class: data.intendedClass, class_confidence: "low",
    }).select("id").single();
    if (!item) {
      await releasePhotoRead(sb, slot.day);
      return { ok: false, mediaId: data.mediaId, error: "Could not queue that photo for reading." };
    }

    await sb.from("fleet_import_batches").update({ status: "processing" }).eq("id", data.batchId);
    const { error: jobErr } = await sb.from("fleet_inbox_jobs").insert({ item_id: item.id, batch_id: data.batchId, source: "vehicle_photo" });
    if (jobErr) {
      // Nothing will read it, so nothing will be spent on it.
      await sb.from("fleet_import_items").update({ status: "failed", error: "Could not queue the reading." }).eq("id", item.id);
      await releasePhotoRead(sb, slot.day);
      return { ok: false, mediaId: data.mediaId, error: "Could not queue that photo for reading." };
    }

    const { logAudit } = await import("@/lib/audit");
    await logAudit(actor, {
      action: "vehicle.photo_read_requested",
      summary: `Queued a photograph for reading on vehicle ${data.vehicleId}`,
      entityType: "vehicle", entityId: data.vehicleId,
      metadata: { mediaId: data.mediaId, documentId, itemId: item.id, docClass: data.intendedClass },
    });

    return { ok: true, mediaId: data.mediaId, itemId: item.id as string, duplicate: false, remainingToday: slot.remaining };
  });

/** Which photos on this vehicle have already been read, so the UI can say so. */
export const listReadPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ readPaths: string[] }> => {
    await requireStaff(context.userId);
    const sb = await admin();
    const { data: docs } = await sb.from("documents")
      .select("storage_path")
      .eq("vehicle_id", data.vehicleId)
      .eq("storage_bucket", "vehicle-photos")
      .eq("source", "vehicle_photo");
    return { readPaths: (docs ?? []).map((d: any) => d.storage_path as string) };
  });

/**
 * What the Photos tab and the Settings panel need to know. Staff may READ the
 * state — a Manager has to be told why the button is dead — but only an Owner
 * may change it, below and in the RLS policy on app_settings.
 */
export const getPhotoReadingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const actor = await requireStaff(context.userId);
    const sb = await admin();
    const { loadPhotoReading } = await import("@/lib/photo-reading.server");
    const s = await loadPhotoReading(sb);
    const day = todayUtc();
    return {
      enabled: s.enabled,
      dailyLimit: s.dailyLimit,
      usedToday: usedOn(s, day),
      remainingToday: remainingOn(s, day),
      pausedReason: s.pausedReason,
      pausedAt: s.pausedAt,
      updatedAt: s.updatedAt,
      updatedBy: s.updatedBy,
      /** Null when a read may start right now; otherwise why it may not. */
      refusal: refusalReason(s, day),
      isOwner: actor.tier === "owner",
    };
  });

export const savePhotoReadingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      enabled: z.boolean(),
      dailyLimit: z.number().int().min(0).max(1000),
      clearPause: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireOwner(context.userId);
    const sb = await admin();
    const { savePhotoReadingConfig } = await import("@/lib/photo-reading.server");
    const next = await savePhotoReadingConfig(sb, actor.userId, data);
    const { logAudit } = await import("@/lib/audit");
    await logAudit(actor, {
      action: "settings.photo_reading",
      summary: `Photo Reading ${next.enabled ? "On" : "Off"}, ${next.dailyLimit}/day`,
      entityType: "settings", entityId: null as any,
      metadata: { enabled: next.enabled, dailyLimit: next.dailyLimit, clearPause: !!data.clearPause },
    });
    return { ok: true as const };
  });
