import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff, requireManager } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";

// Per-vehicle paperwork: registration card, insurance card, title, purchase
// documents.
//
// The `vehicle-docs` bucket has existed since the fleet-ops migration and
// never had a UI, so there has been nowhere to keep the registration card that
// has to live in the glovebox and the copy that has to live in the office.
// This wires it to the existing `documents` table rather than adding a second
// vault: that table already carries vehicle_id, expires_at, versioning via
// superseded_by, and the visibility array.

export const VEHICLE_DOC_TYPES = [
  { value: "registration", label: "Registration card", expires: true },
  { value: "insurance_card", label: "Insurance card", expires: true },
  { value: "title", label: "Title", expires: false },
  { value: "lien_release", label: "Lien release", expires: false },
  { value: "purchase", label: "Purchase / finance paperwork", expires: false },
  { value: "inspection_cert", label: "State inspection certificate", expires: true },
  { value: "emissions", label: "Emissions certificate", expires: true },
  { value: "other", label: "Other", expires: false },
] as const;

const DOC_TYPE_VALUES = VEHICLE_DOC_TYPES.map((d) => d.value) as unknown as [string, ...string[]];

export type VehicleDoc = {
  id: string;
  vehicle_id: string;
  kind: string;
  kind_label: string;
  label: string | null;
  file_name: string | null;
  storage_path: string;
  expires_at: string | null;
  /** Negative once it has already lapsed. Null when the document never expires. */
  days_until_expiry: number | null;
  notes: string | null;
  created_at: string;
  url: string | null;
};

function labelFor(kind: string): string {
  return VEHICLE_DOC_TYPES.find((d) => d.value === kind)?.label ?? kind;
}

/** Whether the caller may see Owner-only finance slots. Layout only — the server guards stay authoritative. */
export const getVehicleDocAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ financeSlots: boolean }> => {
    const actor = await requireStaff(context.userId);
    const { ownerView } = await import("@/lib/experience.server");
    return { financeSlots: ownerView(actor) };
  });

export const listVehicleDocs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<VehicleDoc[]> => {
    // Staff, not managers: a coordinator checking whether a car's registration
    // is current is doing their job, and none of this is financial.
    const actor = await requireStaff(context.userId);
    const isManager = actor.tier === "manager" || actor.tier === "owner";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows } = await supabaseAdmin
      .from("documents")
      .select("*")
      .eq("vehicle_id", data.vehicleId)
      .eq("is_current", true)
      .order("created_at", { ascending: false });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const out: VehicleDoc[] = [];
    const { isFinanceKind } = await import("@/lib/vehicle-doc-presence");
    const ownerOnlyOk = (await import("@/lib/experience.server")).ownerView(actor);
    for (const r of (rows ?? []) as any[]) {
      // Purchase, loan, payoff and lien paperwork is Owner only.
      if (!ownerOnlyOk && (isFinanceKind(r.kind) || isFinanceKind(r.category))) continue;
      const titleRestricted = !ownerOnlyOk && (r.kind === "title" || r.category === "title");
      out.push({
        id: r.id,
        vehicle_id: r.vehicle_id,
        kind: r.kind,
        kind_label: labelFor(r.kind),
        label: r.label,
        file_name: r.file_name,
        // Never sent to the browser; files are streamed via getFleetDocumentFile.
        storage_path: "",
        expires_at: r.expires_at,
        days_until_expiry: r.expires_at
          ? Math.round((new Date(r.expires_at).getTime() - today.getTime()) / 86400_000)
          : null,
        // Notes on priced evidence can carry amounts; Coordinators get none (the original is Manager-only too).
        notes: titleRestricted || (!isManager && r.evidence_class && r.evidence_class !== "operational") ? null : r.notes,
        created_at: r.created_at,
        url: null,
      });
    }
    return out;
  });

export const registerVehicleDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        vehicleId: z.string().uuid(),
        kind: z.enum(DOC_TYPE_VALUES),
        path: z.string().trim().min(1).max(400),
        fileName: z.string().trim().max(200).nullish(),
        mimeType: z.string().trim().max(120).nullish(),
        sizeBytes: z.number().int().nonnegative().nullish(),
        expiresAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish(),
        notes: z.string().trim().max(1000).nullish(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; id: string; duplicate?: boolean } | { ok: false; error: string }> => {
    const actor = await requireStaff(context.userId);
    // Title, acquisition, lien and loan paperwork is Owner only. Storage says
    // the same (private.vehicle_doc_object_owner_only covers 'title'), but this
    // handler writes with the admin client, which bypasses both RLS and the
    // storage policies — so the boundary has to be enforced here as well.
    const { isOwnerOnlyDocKind } = await import("@/lib/vehicle-doc-presence");
    if (isOwnerOnlyDocKind(data.kind) && actor.tier !== "owner") {
      return { ok: false, error: "Only the Owner can add title, purchase, loan or lien paperwork." };
    }
    // The file must sit under this vehicle's folder, so a request cannot
    // attach some other object to this record.
    if (!data.path.startsWith(`${data.vehicleId}/`) || data.path.includes("..")) {
      return { ok: false, error: "That file reference is not valid for this vehicle." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Content identity, the same way Fleet Inbox computes it. Without it this
    // path stored a byte-identical file again under a new row, and the two
    // paths disagreed about what "already on file" means.
    const { data: file } = await supabaseAdmin.storage.from("vehicle-docs").download(data.path);
    if (!file) return { ok: false, error: "That upload could not be read back." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
    const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

    // An original is stored once and related to each vehicle it is evidence
    // for — the rule the vault already follows for Fleet Inbox files. So an
    // identical file is linked, not stored again, and the just-uploaded object
    // is removed rather than left orphaned in the bucket.
    const { data: dup } = await supabaseAdmin
      .from("documents")
      .select("id,vehicle_id,kind")
      .eq("content_sha256", sha)
      .is("driver_id", null)
      .maybeSingle();
    if (dup) {
      await supabaseAdmin.storage.from("vehicle-docs").remove([data.path]);
      if (dup.vehicle_id !== data.vehicleId) {
        await supabaseAdmin
          .from("document_vehicle_links")
          .upsert({ document_id: dup.id, vehicle_id: data.vehicleId, created_by: actor.userId },
                  { onConflict: "document_id,vehicle_id", ignoreDuplicates: true });
      }
      if (data.expiresAt) {
        await supabaseAdmin.from("documents").update({ expires_at: data.expiresAt }).eq("id", dup.id).is("expires_at", null);
      }
      await logAudit(actor, {
        action: "vehicle_doc.linked_existing",
        summary: `Linked an existing ${labelFor(String(dup.kind ?? data.kind))} to a vehicle (identical file already on file)`,
        entityType: "vehicle",
        entityId: data.vehicleId,
        metadata: { kind: dup.kind ?? data.kind, document_id: dup.id },
      });
      return { ok: true, id: dup.id as string, duplicate: true };
    }

    // Replacing a document of the same kind supersedes the old one rather than
    // deleting it — an expired registration is still the evidence of what was
    // in the car last month.
    const { data: prior } = await supabaseAdmin
      .from("documents")
      .select("id")
      .eq("vehicle_id", data.vehicleId)
      .eq("kind", data.kind)
      .eq("is_current", true);

    const { data: row, error } = await supabaseAdmin
      .from("documents")
      .insert({
        vehicle_id: data.vehicleId,
        kind: data.kind,
        category: data.kind,
        label: labelFor(data.kind),
        storage_bucket: "vehicle-docs",
        storage_path: data.path,
        file_name: data.fileName ?? null,
        mime_type: data.mimeType ?? null,
        size_bytes: data.sizeBytes ?? null,
        content_sha256: sha,
        expires_at: data.expiresAt || null,
        is_current: true,
        // Vehicle paperwork is internal; drivers have no reason to see the
        // title or the finance agreement.
        visibility: ["admin"],
        uploaded_by: context.userId,
        uploaded_by_role: "admin",
        notes: data.notes ?? null,
      })
      .select("id")
      .single();

    if (error || !row) {
      // Lost the unique content index to an identical concurrent upload. Same
      // outcome as above: link the one that won, drop the duplicate object.
      const { data: raced } = await supabaseAdmin
        .from("documents").select("id").eq("content_sha256", sha).is("driver_id", null).maybeSingle();
      if (raced) {
        await supabaseAdmin.storage.from("vehicle-docs").remove([data.path]);
        await supabaseAdmin
          .from("document_vehicle_links")
          .upsert({ document_id: raced.id, vehicle_id: data.vehicleId, created_by: actor.userId },
                  { onConflict: "document_id,vehicle_id", ignoreDuplicates: true });
        return { ok: true, id: raced.id as string, duplicate: true };
      }
      return { ok: false, error: error?.message ?? "Could not save the document." };
    }

    if (prior?.length) {
      await supabaseAdmin
        .from("documents")
        .update({ is_current: false, superseded_by: row.id })
        .in("id", prior.map((p: any) => p.id));
    }

    await logAudit(actor, {
      action: "vehicle_doc.uploaded",
      summary: `Uploaded ${labelFor(data.kind)}${data.expiresAt ? ` (expires ${data.expiresAt})` : ""}`,
      entityType: "vehicle",
      entityId: data.vehicleId,
      metadata: { kind: data.kind, superseded: prior?.length ?? 0 },
    });

    return { ok: true, id: row.id };
  });

export const deleteVehicleDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    // Deleting paperwork outright is a manager decision; staff can only
    // supersede it by uploading a newer one.
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: doc } = await supabaseAdmin
      .from("documents")
      .select("id,vehicle_id,kind,category,storage_bucket,storage_path")
      .eq("id", data.id)
      .maybeSingle();
    // Deleting is irreversible and this handler uses the admin client, so the
    // Owner-only boundary is checked on BOTH columns: a Fleet Inbox original
    // carries its class in `category`, a slot upload in `kind`.
    if (!doc) return { ok: false, error: "That document no longer exists." };
    {
      const { isOwnerOnlyDocKind } = await import("@/lib/vehicle-doc-presence");
      if ((isOwnerOnlyDocKind(doc.kind) || isOwnerOnlyDocKind((doc as any).category)) && actor.tier !== "owner") {
        return { ok: false, error: "Only the Owner can delete title, purchase, loan or lien paperwork." };
      }
    }

    if (doc.storage_path) {
      await supabaseAdmin.storage
        .from(doc.storage_bucket || "vehicle-docs")
        .remove([doc.storage_path]);
    }
    await supabaseAdmin.from("documents").delete().eq("id", data.id);

    await logAudit(actor, {
      action: "vehicle_doc.deleted",
      summary: `Deleted ${labelFor(String(doc.kind ?? ""))} from a vehicle record`,
      entityType: "vehicle",
      entityId: doc.vehicle_id ?? null,
      metadata: { kind: doc.kind, category: (doc as any).category ?? null, path: doc.storage_path },
    });

    return { ok: true };
  });

export type ExpiringItem = {
  vehicle_id: string;
  label: string;
  what: string;
  expires_on: string;
  days: number;
};

/**
 * Everything with an expiry date that is close or already past: the vehicle
 * columns (plate, registration, insurance) and any uploaded document.
 *
 * These dates have been collectable since the fleet-ops migration and nothing
 * has ever read them back, which makes them decorative. A car on the road with
 * lapsed registration is the kind of thing that should surface by itself.
 */
export const listExpiring = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ withinDays: z.number().int().min(1).max(365).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<ExpiringItem[]> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const within = data.withinDays ?? 45;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today.getTime() + within * 86400_000);
    const horizonStr = horizon.toISOString().slice(0, 10);

    const { data: vehicles } = await supabaseAdmin
      .from("vehicles")
      .select("id,year,make,model,license_plate,plate_expires_on,registration_expires_on,insurance_expires_on");

    const out: ExpiringItem[] = [];
    const push = (v: any, what: string, date: string | null) => {
      if (!date) return;
      if (date > horizonStr) return;
      const days = Math.round((new Date(date).getTime() - today.getTime()) / 86400_000);
      out.push({
        vehicle_id: v.id,
        label: `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() +
          (v.license_plate ? ` · ${v.license_plate}` : ""),
        what,
        expires_on: date,
        days,
      });
    };

    for (const v of (vehicles ?? []) as any[]) {
      push(v, "Plate", v.plate_expires_on);
      push(v, "Registration", v.registration_expires_on);
      push(v, "Insurance", v.insurance_expires_on);
    }

    // Documents owned directly by a vehicle.
    const { data: docs } = await supabaseAdmin
      .from("documents")
      .select("id,vehicle_id,kind,expires_at")
      .not("vehicle_id", "is", null)
      .not("expires_at", "is", null)
      .eq("is_current", true)
      .lte("expires_at", horizonStr);

    const vById = new Map((vehicles ?? []).map((v: any) => [v.id, v]));
    for (const d of (docs ?? []) as any[]) {
      push(vById.get(d.vehicle_id), `${labelFor(d.kind)} (document)`, d.expires_at);
    }

    // And documents RELATED to a vehicle through document_vehicle_links.
    // Fleet Inbox originals never carry a vehicle_id — one file can be evidence
    // for several cars — so the query above could not see them, and a
    // registration that came through the reader expired silently.
    const { data: linkedDocs } = await supabaseAdmin
      .from("documents")
      .select("id,kind,expires_at")
      .is("vehicle_id", null)
      .not("expires_at", "is", null)
      .eq("is_current", true)
      .lte("expires_at", horizonStr);
    const linkedIds = (linkedDocs ?? []).map((d: any) => d.id);
    if (linkedIds.length) {
      const { data: links } = await supabaseAdmin
        .from("document_vehicle_links")
        .select("document_id,vehicle_id")
        .in("document_id", linkedIds);
      const docById = new Map((linkedDocs ?? []).map((d: any) => [d.id, d]));
      // One shared insurance PDF warns once per vehicle it covers.
      for (const l of (links ?? []) as any[]) {
        const d = docById.get(l.document_id);
        if (d) push(vById.get(l.vehicle_id), `${labelFor(d.kind)} (document)`, d.expires_at);
      }
    }

    // Soonest — and most overdue — first.
    return out.sort((a, b) => a.days - b.days);
  });
