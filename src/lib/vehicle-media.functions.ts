import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff, requireManager } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit.server";

// Vehicle photography.
//
// Three kinds of image, and the differences matter more than the similarities:
//
//   original      what the camera saw. Permanent, and the only thing an
//                 enhancement may be derived from.
//   ai_enhanced   a retouched derivative. Always points at its original,
//                 always arrives unpublished, always labelled in the UI.
//   inspection    condition evidence. Lives in condition_media, is not
//                 reachable from this file, and never will be.
//
// vehicles.photos — the array the public site renders — is not written here.
// A database trigger derives it from the published rows of this table, so the
// order an operator arranges is the order a visitor sees and the two cannot
// drift apart.

export type VehicleMedia = {
  id: string;
  vehicle_id: string;
  kind: "original" | "ai_enhanced";
  provenance: "uploaded" | "adopted" | "ai_enhanced";
  storage_bucket: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  derived_from_id: string | null;
  enhancement_mode: string | null;
  enhancement_provider: string | null;
  is_primary: boolean;
  published: boolean;
  sort_order: number;
  caption: string | null;
  created_at: string;
};

export type VehicleMediaList = {
  items: VehicleMedia[];
  canDelete: boolean;
  enhancement: { available: boolean; provider: string | null; reason: string };
};

export const listVehicleMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<VehicleMediaList> => {
    const actor = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enhancementAvailability } = await import("@/lib/vehicle-enhance.server");

    const { data: rows } = await supabaseAdmin
      .from("vehicle_media")
      .select("*")
      .eq("vehicle_id", data.vehicleId)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    return {
      items: (rows as VehicleMedia[] | null) ?? [],
      // Deleting the only copy of a photograph is Manager-only at the policy
      // layer; the UI is told so it can say why rather than fail on click.
      canDelete: actor.tier === "manager" || actor.tier === "owner",
      enhancement: enhancementAvailability(),
    };
  });

export const registerVehicleMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        vehicleId: z.string().uuid(),
        path: z.string().trim().min(1).max(400),
        fileName: z.string().trim().max(200).nullish(),
        mimeType: z.string().trim().max(100).nullish(),
        sizeBytes: z.number().int().min(0).max(50_000_000).nullish(),
        caption: z.string().trim().max(300).nullish(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; id?: string; error?: string }> => {
    const actor = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: vehicle } = await supabaseAdmin
      .from("vehicles")
      .select("id,unit_number,year,make,model")
      .eq("id", data.vehicleId)
      .maybeSingle();
    if (!vehicle) return { ok: false, error: "That vehicle no longer exists." };

    // First photo on a vehicle becomes the primary, so a car is never listed
    // with a gallery and no lead image.
    const { count } = await supabaseAdmin
      .from("vehicle_media")
      .select("id", { count: "exact", head: true })
      .eq("vehicle_id", data.vehicleId)
      .eq("published", true);
    const first = (count ?? 0) === 0;

    const { data: maxRow } = await supabaseAdmin
      .from("vehicle_media")
      .select("sort_order")
      .eq("vehicle_id", data.vehicleId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: row, error } = await supabaseAdmin
      .from("vehicle_media")
      .insert({
        vehicle_id: data.vehicleId,
        kind: "original",
        provenance: "uploaded",
        storage_bucket: "vehicle-photos",
        storage_path: data.path,
        file_name: data.fileName ?? null,
        mime_type: data.mimeType ?? null,
        size_bytes: data.sizeBytes ?? null,
        caption: data.caption ?? null,
        is_primary: first,
        sort_order: ((maxRow?.sort_order as number | undefined) ?? -1) + 1,
        uploaded_by: actor.userId,
      } as any)
      .select("id")
      .single();

    if (error || !row) {
      console.error("[vehicle-media] register failed", error?.message);
      return { ok: false, error: error?.message ?? "Could not save that photo." };
    }

    await logAudit(actor, {
      action: "vehicle.photo.added",
      summary: `Added a photo to ${vehicle.unit_number || `${vehicle.year} ${vehicle.make} ${vehicle.model}`}`,
      entityType: "vehicle",
      entityId: data.vehicleId,
      metadata: { media_id: row.id, file_name: data.fileName ?? null },
    });

    return { ok: true, id: row.id };
  });

export const updateVehicleMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        caption: z.string().trim().max(300).nullish(),
        published: z.boolean().optional(),
        makePrimary: z.boolean().optional(),
        sortOrder: z.number().int().min(0).max(999).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const actor = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row } = await supabaseAdmin
      .from("vehicle_media")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) return { ok: false, error: "That photo is no longer here." };

    const patch: Record<string, unknown> = {};
    if (data.caption !== undefined) patch.caption = data.caption || null;
    if (data.sortOrder !== undefined) patch.sort_order = data.sortOrder;
    if (data.published !== undefined) patch.published = data.published;

    if (data.makePrimary) {
      // Primary implies published — a lead image the site cannot show is not a
      // lead image. The partial unique index would reject the pair anyway.
      patch.is_primary = true;
      patch.published = true;
      const { error: clearErr } = await supabaseAdmin
        .from("vehicle_media")
        .update({ is_primary: false } as any)
        .eq("vehicle_id", row.vehicle_id)
        .neq("id", data.id);
      if (clearErr) return { ok: false, error: clearErr.message };
    }

    // Unpublishing the primary would leave the vehicle with none, so the flag
    // comes off with it and the next photo in order leads.
    if (data.published === false && row.is_primary) patch.is_primary = false;

    if (!Object.keys(patch).length) return { ok: true };

    const { error } = await supabaseAdmin
      .from("vehicle_media")
      .update(patch as any)
      .eq("id", data.id);
    if (error) return { ok: false, error: error.message };

    // Publishing a retouched image onto the public listing is a decision worth
    // a record. Arranging the gallery is not.
    if (row.kind === "ai_enhanced" && data.published === true) {
      await logAudit(actor, {
        action: "vehicle.photo.enhanced_published",
        summary: `Published an AI-enhanced photo to the public listing`,
        entityType: "vehicle",
        entityId: row.vehicle_id,
        metadata: {
          media_id: data.id,
          mode: row.enhancement_mode,
          provider: row.enhancement_provider,
        },
      });
    }

    return { ok: true };
  });

export const deleteVehicleMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; error?: string; removedDerivatives: number }> => {
      const actor = await requireManager(context.userId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { data: row } = await supabaseAdmin
        .from("vehicle_media")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      if (!row) return { ok: true, removedDerivatives: 0 };

      // Derivatives cascade in the database. Counted first so the operator is
      // told what else went, rather than discovering it in the gallery.
      const { data: derivatives } = await supabaseAdmin
        .from("vehicle_media")
        .select("id,storage_path,storage_bucket")
        .eq("derived_from_id", data.id);
      const kids = derivatives ?? [];

      const { error } = await supabaseAdmin.from("vehicle_media").delete().eq("id", data.id);
      if (error) return { ok: false, error: error.message, removedDerivatives: 0 };

      // Files go after the rows. The other order can leave a row pointing at
      // nothing if the delete fails halfway.
      const paths = [row, ...kids].map((r: any) => r.storage_path).filter(Boolean);
      if (paths.length) {
        const { error: rmErr } = await supabaseAdmin.storage.from("vehicle-photos").remove(paths);
        if (rmErr) console.error("[vehicle-media] file cleanup failed", rmErr.message);
      }

      await logAudit(actor, {
        action: "vehicle.photo.deleted",
        summary: `Deleted a ${row.kind === "ai_enhanced" ? "retouched" : "vehicle"} photo${
          kids.length ? ` and ${kids.length} derivative${kids.length === 1 ? "" : "s"}` : ""
        }`,
        entityType: "vehicle",
        entityId: row.vehicle_id,
        metadata: { media_id: data.id, kind: row.kind, derivatives: kids.length },
      });

      return { ok: true, removedDerivatives: kids.length };
    },
  );

export const enhanceVehiclePhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        mediaId: z.string().uuid(),
        mode: z.enum(["clean_background", "studio", "outdoor", "dealer_listing"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; id?: string; error?: string }> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enhance, enhancementAvailability } = await import("@/lib/vehicle-enhance.server");

    const avail = enhancementAvailability();
    if (!avail.available) return { ok: false, error: avail.reason };

    const { data: source } = await supabaseAdmin
      .from("vehicle_media")
      .select("*")
      .eq("id", data.mediaId)
      .maybeSingle();
    if (!source) return { ok: false, error: "That photo is no longer here." };

    // Only an original may be enhanced. Enhancing an enhancement compounds
    // whatever the first pass invented, and the derivation constraint only
    // permits one level anyway.
    if (source.kind !== "original") {
      return { ok: false, error: "Only an original photograph can be enhanced." };
    }

    const { data: file, error: dlErr } = await supabaseAdmin.storage
      .from(source.storage_bucket || "vehicle-photos")
      .download(source.storage_path);
    if (dlErr || !file) return { ok: false, error: "Could not read the original photo." };

    const { data: vehicle } = await supabaseAdmin
      .from("vehicles")
      .select("year,make,model,color,unit_number")
      .eq("id", source.vehicle_id)
      .maybeSingle();

    let result;
    try {
      result = await enhance({
        source: new Uint8Array(await file.arrayBuffer()),
        sourceMimeType: source.mime_type || file.type || "image/jpeg",
        mode: data.mode,
        subject: {
          year: vehicle?.year ?? null,
          make: vehicle?.make ?? null,
          model: vehicle?.model ?? null,
          color: vehicle?.color ?? null,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Enhancement failed.";
      console.error("[vehicle-media] enhance failed", msg);
      return { ok: false, error: msg };
    }

    const ext = result.mimeType.includes("png")
      ? "png"
      : result.mimeType.includes("webp")
        ? "webp"
        : "jpg";
    const path = `${source.vehicle_id}/enhanced-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("vehicle-photos")
      .upload(path, result.bytes, { contentType: result.mimeType });
    if (upErr) return { ok: false, error: upErr.message };

    // published is forced false by a database trigger regardless of what is
    // sent here. Stated explicitly so the intent is visible at the call site.
    const { data: row, error } = await supabaseAdmin
      .from("vehicle_media")
      .insert({
        vehicle_id: source.vehicle_id,
        kind: "ai_enhanced",
        provenance: "ai_enhanced",
        storage_bucket: "vehicle-photos",
        storage_path: path,
        mime_type: result.mimeType,
        size_bytes: result.bytes.byteLength,
        derived_from_id: source.id,
        enhancement_mode: data.mode,
        enhancement_provider: result.provider,
        published: false,
        is_primary: false,
        sort_order: source.sort_order ?? 0,
        uploaded_by: actor.userId,
      } as any)
      .select("id")
      .single();

    if (error || !row) {
      await supabaseAdmin.storage.from("vehicle-photos").remove([path]);
      return { ok: false, error: error?.message ?? "Could not save the enhanced photo." };
    }

    await logAudit(actor, {
      action: "vehicle.photo.enhanced",
      summary: `Created a ${data.mode.replace(/_/g, " ")} version of a photo of ${
        vehicle?.unit_number ||
        `${vehicle?.year ?? ""} ${vehicle?.make ?? ""} ${vehicle?.model ?? ""}`.trim()
      } — not published`,
      entityType: "vehicle",
      entityId: source.vehicle_id,
      metadata: {
        media_id: row.id,
        derived_from: source.id,
        mode: data.mode,
        provider: result.provider,
      },
    });

    return { ok: true, id: row.id };
  });
