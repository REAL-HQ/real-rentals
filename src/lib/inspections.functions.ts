import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const CONDITION_BUCKET = "condition-media";

/**
 * The angles we ask for at handover. Matching the same list at checkout and
 * check-in is what makes the before/after comparison meaningful — a missing
 * "driver side" photo at return is exactly the gap that loses a damage claim.
 */
export const CONDITION_ANGLES = [
  { key: "front", label: "Front" },
  { key: "rear", label: "Rear" },
  { key: "driver_side", label: "Driver side" },
  { key: "passenger_side", label: "Passenger side" },
  { key: "interior_front", label: "Interior — front" },
  { key: "interior_rear", label: "Interior — rear" },
  { key: "odometer", label: "Odometer" },
  { key: "fuel", label: "Fuel gauge" },
  { key: "damage", label: "Damage / defect" },
  { key: "other", label: "Other" },
] as const;

export const CONDITION_PHASES = [
  { key: "checkout", label: "Before — at pickup" },
  { key: "checkin", label: "After — at return" },
  { key: "damage", label: "Damage report" },
  { key: "other", label: "Other" },
] as const;

const PhaseEnum = z.enum(["checkout", "checkin", "damage", "other"]);
const AngleEnum = z.enum([
  "front",
  "rear",
  "driver_side",
  "passenger_side",
  "interior_front",
  "interior_rear",
  "odometer",
  "fuel",
  "damage",
  "other",
]);
const ResultEnum = z.enum(["pending", "pass", "fail", "na"]);

export type ConditionMedia = {
  id: string;
  vehicle_id: string;
  rental_id: string | null;
  phase: string;
  angle: string | null;
  media_type: string;
  caption: string | null;
  captured_by_role: string;
  created_at: string;
  url: string | null;
};

export type InspectionItem = {
  id: string;
  section: string;
  label: string;
  result: string;
  is_critical: boolean;
  requires_photo: boolean;
  notes: string | null;
  sort_order: number;
};

export type InspectionDetail = {
  id: string;
  vehicle_id: string;
  rental_id: string | null;
  inspection_type: string;
  status: string;
  odometer: number | null;
  fuel_level: string | null;
  exterior_notes: string | null;
  interior_notes: string | null;
  notes: string | null;
  inspector_name: string | null;
  started_at: string;
  completed_at: string | null;
  items: InspectionItem[];
  media: ConditionMedia[];
};

async function isStaff(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "team"])
    .limit(1);
  return !!(data && data.length);
}

function safeExt(fileName: string, mime: string): string {
  const fromName = (fileName.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName && fromName.length <= 5) return fromName;
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
  };
  return map[mime] || "bin";
}

async function signMedia(admin: any, rows: any[]): Promise<ConditionMedia[]> {
  return Promise.all(
    rows.map(async (m) => {
      const { data: signed } = await admin.storage
        .from(m.storage_bucket)
        .createSignedUrl(m.storage_path, 60 * 30);
      return {
        id: m.id,
        vehicle_id: m.vehicle_id,
        rental_id: m.rental_id ?? null,
        phase: m.phase,
        angle: m.angle ?? null,
        media_type: m.media_type ?? "photo",
        caption: m.caption ?? null,
        captured_by_role: m.captured_by_role ?? "staff",
        created_at: m.created_at,
        url: signed?.signedUrl ?? null,
      };
    }),
  );
}

/**
 * Resolve the vehicle the signed-in driver is currently renting. Returns null
 * for staff or for a driver with no active rental.
 */
async function activeRentalFor(supabase: any, userId: string) {
  const { data } = await supabase
    .from("rentals")
    .select("id,vehicle_id")
    .eq("driver_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// ------------------------------------------------------------- condition media

export const createConditionUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        vehicleId: z.string().uuid().optional(),
        fileName: z.string().min(1).max(200),
        mimeType: z.string().min(3).max(120),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const staff = await isStaff(context.supabase, context.userId);

    let vehicleId = data.vehicleId ?? null;
    if (!staff) {
      // A driver may only ever upload against the car they are renting, no
      // matter what vehicle id the client sends.
      const rental = await activeRentalFor(context.supabase, context.userId);
      if (!rental?.vehicle_id) throw new Error("No active rental on file");
      vehicleId = rental.vehicle_id as string;
    }
    if (!vehicleId) throw new Error("Missing vehicle");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `${vehicleId}/${crypto.randomUUID()}.${safeExt(data.fileName, data.mimeType)}`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from(CONDITION_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message || "Could not start upload");
    return { path: signed.path, token: signed.token, bucket: CONDITION_BUCKET, vehicleId };
  });

export const confirmConditionUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        vehicleId: z.string().uuid(),
        rentalId: z.string().uuid().nullable().optional(),
        inspectionId: z.string().uuid().nullable().optional(),
        phase: PhaseEnum,
        angle: AngleEnum.optional().nullable(),
        path: z.string().min(3).max(400),
        fileName: z.string().max(200).optional(),
        mimeType: z.string().max(120).optional(),
        sizeBytes: z.number().int().nonnegative().optional(),
        caption: z.string().max(200).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const staff = await isStaff(context.supabase, context.userId);

    let rentalId = data.rentalId ?? null;
    if (!staff) {
      const rental = await activeRentalFor(context.supabase, context.userId);
      if (!rental || rental.vehicle_id !== data.vehicleId) throw new Error("Forbidden");
      rentalId = rental.id as string;
    }
    // The upload path is derived from the vehicle id server-side; re-check it
    // so a tampered path cannot file a photo under someone else's car.
    if (!data.path.startsWith(`${data.vehicleId}/`)) throw new Error("Invalid upload path");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const isVideo = (data.mimeType ?? "").startsWith("video/");
    const { error } = await supabaseAdmin.from("condition_media").insert({
      vehicle_id: data.vehicleId,
      rental_id: rentalId,
      inspection_id: data.inspectionId ?? null,
      phase: data.phase,
      angle: data.angle ?? null,
      media_type: isVideo ? "video" : "photo",
      storage_bucket: CONDITION_BUCKET,
      storage_path: data.path,
      file_name: data.fileName ?? null,
      mime_type: data.mimeType ?? null,
      size_bytes: data.sizeBytes ?? null,
      captured_by: context.userId,
      captured_by_role: staff ? "staff" : "driver",
      caption: data.caption ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listConditionMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ vehicleId: z.string().uuid().optional(), rentalId: z.string().uuid().optional() })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<ConditionMedia[]> => {
    const staff = await isStaff(context.supabase, context.userId);

    let vehicleId = data.vehicleId ?? null;
    if (!staff) {
      const rental = await activeRentalFor(context.supabase, context.userId);
      if (!rental?.vehicle_id) return [];
      vehicleId = rental.vehicle_id as string;
    }
    if (!vehicleId) return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("condition_media")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.rentalId) q = q.eq("rental_id", data.rentalId);

    const { data: rows } = await q;
    return signMedia(supabaseAdmin, rows ?? []);
  });

export const deleteConditionMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Condition photos are evidence. Only staff can remove one, and never a
    // renter — otherwise the proof could be deleted by the party it implicates.
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("condition_media")
      .select("id,storage_bucket,storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (row) {
      await supabaseAdmin.storage
        .from(row.storage_bucket as string)
        .remove([row.storage_path as string]);
      await supabaseAdmin.from("condition_media").delete().eq("id", data.id);
    }
    return { ok: true };
  });

// ----------------------------------------------------------------- inspections

export const startInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        vehicleId: z.string().uuid(),
        templateId: z.string().uuid(),
        rentalId: z.string().uuid().nullable().optional(),
        odometer: z.number().int().nonnegative().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: template } = await supabaseAdmin
      .from("inspection_templates")
      .select("id,inspection_type")
      .eq("id", data.templateId)
      .maybeSingle();
    if (!template) throw new Error("Template not found");

    const { data: inspection, error } = await supabaseAdmin
      .from("inspections")
      .insert({
        vehicle_id: data.vehicleId,
        rental_id: data.rentalId ?? null,
        template_id: template.id,
        inspection_type: template.inspection_type,
        status: "in_progress",
        odometer: data.odometer ?? null,
        inspector_id: context.userId,
        inspector_name: ((context.claims as any)?.email as string) ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Snapshot the template into per-inspection rows. Editing the template
    // later must not rewrite the history of an inspection already performed.
    const { data: templateItems } = await supabaseAdmin
      .from("inspection_template_items")
      .select("section,label,requires_photo,is_critical,sort_order")
      .eq("template_id", template.id)
      .order("sort_order");

    if (templateItems?.length) {
      const { error: itemsErr } = await supabaseAdmin.from("inspection_items").insert(
        templateItems.map((t: any) => ({
          inspection_id: inspection.id,
          section: t.section,
          label: t.label,
          requires_photo: t.requires_photo,
          is_critical: t.is_critical,
          sort_order: t.sort_order,
          result: "pending",
        })),
      );
      if (itemsErr) throw new Error(itemsErr.message);
    }

    return { id: inspection.id as string };
  });

export const getInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<InspectionDetail> => {
    const staff = await isStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: inspection } = await supabaseAdmin
      .from("inspections")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!inspection) throw new Error("Inspection not found");

    if (!staff) {
      // Drivers may only read an inspection on the car they rent.
      const rental = await activeRentalFor(context.supabase, context.userId);
      if (!rental || rental.vehicle_id !== inspection.vehicle_id) throw new Error("Forbidden");
    }

    const [{ data: items }, { data: media }] = await Promise.all([
      supabaseAdmin
        .from("inspection_items")
        .select("*")
        .eq("inspection_id", data.id)
        .order("sort_order"),
      supabaseAdmin
        .from("condition_media")
        .select("*")
        .eq("inspection_id", data.id)
        .order("created_at"),
    ]);

    return {
      id: inspection.id,
      vehicle_id: inspection.vehicle_id,
      rental_id: inspection.rental_id ?? null,
      inspection_type: inspection.inspection_type,
      status: inspection.status,
      odometer: inspection.odometer ?? null,
      fuel_level: inspection.fuel_level ?? null,
      exterior_notes: inspection.exterior_notes ?? null,
      interior_notes: inspection.interior_notes ?? null,
      notes: inspection.notes ?? null,
      inspector_name: inspection.inspector_name ?? null,
      started_at: inspection.started_at,
      completed_at: inspection.completed_at ?? null,
      items: (items ?? []) as InspectionItem[],
      media: await signMedia(supabaseAdmin, media ?? []),
    };
  });

export const setInspectionItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        itemId: z.string().uuid(),
        result: ResultEnum.optional(),
        notes: z.string().max(500).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {};
    if (data.result !== undefined) patch.result = data.result;
    if (data.notes !== undefined) patch.notes = data.notes;
    const { error } = await supabaseAdmin
      .from("inspection_items")
      .update(patch as any)
      .eq("id", data.itemId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        odometer: z.number().int().nonnegative().nullable().optional(),
        fuelLevel: z
          .enum(["empty", "quarter", "half", "three_quarter", "full"])
          .nullable()
          .optional(),
        exteriorNotes: z.string().max(2000).nullable().optional(),
        interiorNotes: z.string().max(2000).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {};
    if (data.odometer !== undefined) patch.odometer = data.odometer;
    if (data.fuelLevel !== undefined) patch.fuel_level = data.fuelLevel;
    if (data.exteriorNotes !== undefined) patch.exterior_notes = data.exteriorNotes;
    if (data.interiorNotes !== undefined) patch.interior_notes = data.interiorNotes;
    if (data.notes !== undefined) patch.notes = data.notes;
    const { error } = await supabaseAdmin
      .from("inspections")
      .update(patch as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type CompleteResult = {
  ok: boolean;
  status: string;
  blockedBy: string[];
  incomplete: string[];
};

export const completeInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<CompleteResult> => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: items } = await supabaseAdmin
      .from("inspection_items")
      .select("label,result,is_critical")
      .eq("inspection_id", data.id);

    const incomplete = (items ?? [])
      .filter((i: any) => i.result === "pending")
      .map((i: any) => i.label);
    if (incomplete.length) {
      // Refuse to sign off a half-finished checklist — that is the whole point
      // of having one.
      return { ok: false, status: "in_progress", blockedBy: [], incomplete };
    }

    const blockedBy = (items ?? [])
      .filter((i: any) => i.is_critical && i.result === "fail")
      .map((i: any) => i.label);

    // Any failed critical item fails the inspection; the vehicle must not go out.
    const status = blockedBy.length ? "failed" : "passed";

    const { error } = await supabaseAdmin
      .from("inspections")
      .update({ status, completed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    // A failed pre-delivery inspection takes the vehicle off the road so it
    // cannot be assigned to the next applicant by mistake.
    if (status === "failed") {
      const { data: inspection } = await supabaseAdmin
        .from("inspections")
        .select("vehicle_id,inspection_type")
        .eq("id", data.id)
        .maybeSingle();
      if (inspection?.vehicle_id) {
        await supabaseAdmin
          .from("vehicles")
          .update({ status: "maintenance" })
          .eq("id", inspection.vehicle_id);
      }
    }

    return { ok: true, status, blockedBy, incomplete: [] };
  });
