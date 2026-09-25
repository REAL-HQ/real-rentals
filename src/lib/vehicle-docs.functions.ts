import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff, requireManager } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit.server";

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

export const listVehicleDocs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<VehicleDoc[]> => {
    // Staff, not managers: a coordinator checking whether a car's registration
    // is current is doing their job, and none of this is financial.
    await requireStaff(context.userId);
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
    for (const r of (rows ?? []) as any[]) {
      const { data: signed } = await supabaseAdmin.storage
        .from(r.storage_bucket || "vehicle-docs")
        .createSignedUrl(r.storage_path, 3600);
      out.push({
        id: r.id,
        vehicle_id: r.vehicle_id,
        kind: r.kind,
        kind_label: labelFor(r.kind),
        label: r.label,
        file_name: r.file_name,
        storage_path: r.storage_path,
        expires_at: r.expires_at,
        days_until_expiry: r.expires_at
          ? Math.round((new Date(r.expires_at).getTime() - today.getTime()) / 86400_000)
          : null,
        notes: r.notes,
        created_at: r.created_at,
        url: signed?.signedUrl ?? null,
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
  .handler(async ({ data, context }): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
    const actor = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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

    if (error || !row) return { ok: false, error: error?.message ?? "Could not save the document." };

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
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    // Deleting paperwork outright is a manager decision; staff can only
    // supersede it by uploading a newer one.
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: doc } = await supabaseAdmin
      .from("documents")
      .select("id,vehicle_id,kind,storage_bucket,storage_path")
      .eq("id", data.id)
      .maybeSingle();

    if (doc?.storage_path) {
      await supabaseAdmin.storage
        .from(doc.storage_bucket || "vehicle-docs")
        .remove([doc.storage_path]);
    }
    await supabaseAdmin.from("documents").delete().eq("id", data.id);

    await logAudit(actor, {
      action: "vehicle_doc.deleted",
      summary: `Deleted ${labelFor(String(doc?.kind ?? ""))} from a vehicle record`,
      entityType: "vehicle",
      entityId: doc?.vehicle_id ?? null,
      metadata: { kind: doc?.kind, path: doc?.storage_path },
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

    const { data: docs } = await supabaseAdmin
      .from("documents")
      .select("vehicle_id,kind,expires_at")
      .not("vehicle_id", "is", null)
      .not("expires_at", "is", null)
      .eq("is_current", true)
      .lte("expires_at", horizonStr);

    const vById = new Map((vehicles ?? []).map((v: any) => [v.id, v]));
    for (const d of (docs ?? []) as any[]) {
      push(vById.get(d.vehicle_id), `${labelFor(d.kind)} (document)`, d.expires_at);
    }

    // Soonest — and most overdue — first.
    return out.sort((a, b) => a.days - b.days);
  });
