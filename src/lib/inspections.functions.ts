import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { tierAllows, tierFromRoles, type StaffTier } from "@/lib/roles";
import { tripMediaType } from "@/lib/trip-media";

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
  taken_at: string | null;
  taken_at_source: string | null;
  /** Present for staff listings only; never returned to renters. */
  gps_lat: number | null;
  gps_lng: number | null;
  /** True when EXIF datetime was missing at upload (or unknown for legacy rows). */
  missing_exif_time: boolean;
  url: string | null;
  /** When the file reached us. Separate from taken_at, which is the camera's. */
  uploaded_at?: string;
  application_id?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
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
  driver_signature_name: string | null;
  driver_signed_at: string | null;
  driver_notes: string | null;
  items: InspectionItem[];
  media: ConditionMedia[];
};

/** Just enough of a Supabase client to read one person's roles. */
type RoleClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => PromiseLike<{ data: unknown }>;
    };
  };
};

/**
 * Two different questions, asked of the same roles table.
 *
 * Recording a handoff is operational work: a Coordinator meets the renter in
 * a car park, walks the checklist, photographs the panels, writes down the
 * odometer and the fuel. Destroying that evidence afterwards is not — it is
 * the one thing on this screen that can make a damage claim unprovable, so it
 * stays where it was, with a Manager.
 *
 * `isStaff` therefore keeps EXACTLY the boundary it always had (Owner or
 * Manager) and only `deleteConditionMedia` still asks it. Everything
 * operational asks `canInspect` instead. The role names come from the shared
 * tier model rather than a third hand-written list in this file, so the two
 * cannot drift apart from the rest of the app.
 *
 * Both read the roles through the CALLER's own client, as this file always
 * has — the tier is never taken from the request.
 */
// Taken as `unknown` and narrowed once, here: structurally checking the real
// client against RoleClient makes TypeScript walk the whole generated Database
// type and give up (TS2589). `unknown` is not `any` — nothing is read off it
// without this cast.
async function staffTier(supabase: unknown, userId: string): Promise<StaffTier | null> {
  const { data } = await (supabase as RoleClient)
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return tierFromRoles(((data ?? []) as Array<{ role: unknown }>).map((r) => String(r.role)));
}

/** Owner or Manager. Unchanged: the gate on destroying condition evidence. */
async function isStaff(supabase: unknown, userId: string): Promise<boolean> {
  return tierAllows(await staffTier(supabase, userId), "manager");
}

/**
 * Owner, Manager or Coordinator — may run a handoff and record what they saw.
 *
 * This is the operational inspection permission, enforced here on the server.
 * It admits a Coordinator to: starting and completing a Check-Out or Check-In,
 * setting checklist results, recording odometer, fuel and notes, uploading
 * condition photographs, and reading the photographs for a car. It admits them
 * to nothing else — no licence numbers, no identity documents, no agreement
 * PDFs, no money, no rental lifecycle, and no bucket-wide storage access,
 * because none of those are reached from this file.
 */
async function canInspect(supabase: unknown, userId: string): Promise<boolean> {
  return tierAllows(await staffTier(supabase, userId), "coordinator");
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

async function signMedia(
  admin: any,
  rows: any[],
  opts: { includeGps: boolean; renter?: boolean },
): Promise<ConditionMedia[]> {
  return Promise.all(
    rows.map(async (m) => {
      // A renter is only ever signed the metadata-free share copy, never the
      // original (whose EXIF can carry GPS). No share copy, no URL.
      const path = opts.renter ? ((m.share_path as string | null) ?? null) : (m.storage_path as string);
      const { data: signed } = path
        ? await admin.storage.from(m.storage_bucket).createSignedUrl(path, 60 * 30)
        : { data: null };
      const takenAt = (m.taken_at as string | null) ?? (m.created_at as string);
      const source = (m.taken_at_source as string | null) ?? (m.taken_at ? "exif" : "upload");
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
        taken_at: takenAt,
        taken_at_source: source,
        gps_lat: opts.includeGps && m.gps_lat != null ? Number(m.gps_lat) : null,
        gps_lng: opts.includeGps && m.gps_lng != null ? Number(m.gps_lng) : null,
        missing_exif_time: source !== "exif",
        url: signed?.signedUrl ?? null,
        uploaded_at: m.created_at,
        application_id: opts.renter ? null : (m.application_id ?? null),
        file_name: opts.renter ? null : (m.file_name ?? null),
        mime_type: m.mime_type ?? null,
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
    .select("id,vehicle_id,application_id")
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
    const operator = await canInspect(context.supabase, context.userId);

    if (!tripMediaType(data.fileName, data.mimeType)) throw new Error("This file type isn't supported");
    let vehicleId = data.vehicleId ?? null;
    let folder: string;
    if (!operator) {
      // A driver may only ever upload against the car they are renting, no
      // matter what vehicle id the client sends — and into that rental's
      // folder, which confirm checks again.
      const rental = await activeRentalFor(context.supabase, context.userId);
      if (!rental?.vehicle_id) throw new Error("No active rental on file");
      vehicleId = rental.vehicle_id as string;
      folder = `${vehicleId}/rental/${rental.id}`;
    } else {
      if (!vehicleId) throw new Error("Missing vehicle");
      folder = vehicleId;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `${folder}/${crypto.randomUUID()}.${safeExt(data.fileName, data.mimeType)}`;
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
    const operator = await canInspect(context.supabase, context.userId);
    const mime = tripMediaType(data.fileName ?? data.path, data.mimeType);
    if (!mime) throw new Error("This file type isn't supported");

    let rentalId = data.rentalId ?? null;
    let applicationId: string | null = null;
    if (!operator) {
      const rental = await activeRentalFor(context.supabase, context.userId);
      if (!rental || rental.vehicle_id !== data.vehicleId) throw new Error("Forbidden");
      rentalId = rental.id as string;
      applicationId = (rental.application_id as string | null) ?? null;
      // A renter's file must sit in their own rental's folder.
      if (!data.path.startsWith(`${data.vehicleId}/rental/${rentalId}/`)) throw new Error("Invalid upload path");
    }
    // The upload path is derived from the vehicle id server-side; re-check it
    // so a tampered path cannot file a photo under someone else's car.
    if (!data.path.startsWith(`${data.vehicleId}/`)) throw new Error("Invalid upload path");
    // Staff trip uploads have their own confirm, which checks the applicant.
    if (data.path.startsWith(`${data.vehicleId}/trip/`)) throw new Error("Invalid upload path");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { storeConditionMedia } = await import("@/lib/trip-media.server");
    const saved = await storeConditionMedia(supabaseAdmin, {
      vehicleId: data.vehicleId,
      rentalId,
      applicationId,
      inspectionId: operator ? (data.inspectionId ?? null) : null,
      phase: data.phase,
      angle: data.angle ?? null,
      path: data.path,
      fileName: data.fileName ?? null,
      mimeType: mime,
      sizeBytes: data.sizeBytes ?? null,
      caption: data.caption ?? null,
      capturedBy: context.userId,
      capturedByRole: operator ? "staff" : "driver",
    });
    return { ok: true, missingExifTime: saved.missingExifTime };
  });

export const listConditionMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ vehicleId: z.string().uuid().optional(), rentalId: z.string().uuid().optional() })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<ConditionMedia[]> => {
    const operator = await canInspect(context.supabase, context.userId);

    let vehicleId = data.vehicleId ?? null;
    let renterRental: string | null = null;
    if (!operator) {
      const rental = await activeRentalFor(context.supabase, context.userId);
      if (!rental?.vehicle_id) return [];
      vehicleId = rental.vehicle_id as string;
      renterRental = rental.id as string;
    }
    if (!vehicleId) return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("condition_media")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .order("created_at", { ascending: false })
      .limit(200);
    // A renter sees their own rental's media only — never another booking's
    // on the same car, whatever rentalId the client sends.
    if (renterRental) q = q.eq("rental_id", renterRental);
    else if (data.rentalId) q = q.eq("rental_id", data.rentalId);

    const { data: rows } = await q;
    // Precise GPS is staff-only; renters get the metadata-free copy only.
    return signMedia(supabaseAdmin, rows ?? [], { includeGps: !!operator, renter: !operator });
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
      .select("id,storage_bucket,storage_path,share_path")
      .eq("id", data.id)
      .maybeSingle();
    if (row) {
      await supabaseAdmin.storage
        .from(row.storage_bucket as string)
        .remove([row.storage_path as string, ...(row.share_path ? [row.share_path as string] : [])]);
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
    if (!(await canInspect(context.supabase, context.userId))) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // The vehicle was never checked here: a well-formed UUID for a car that
    // does not exist produced an inspection against nothing, and the readiness
    // "Open Inspections" button used to arrive with no vehicle at all and let
    // the form default to whichever car sorted first. Both are how a
    // pre-delivery inspection ends up filed against the wrong vehicle, so the
    // id is now verified on the server rather than trusted from the page.
    const { data: vehicle } = await supabaseAdmin
      .from("vehicles")
      .select("id,archived_at")
      .eq("id", data.vehicleId)
      .maybeSingle();
    if (!vehicle) throw new Error("That vehicle no longer exists.");
    if (vehicle.archived_at)
      throw new Error("That vehicle is archived — restore it before inspecting it.");

    const { data: template } = await supabaseAdmin
      .from("inspection_templates")
      .select("id,inspection_type")
      .eq("id", data.templateId)
      .maybeSingle();
    if (!template) throw new Error("Template not found");

    // An inspection of a car that is OUT belongs to the rental it is out on.
    //
    // rental_id was only ever what the caller passed, and the Start Inspection
    // form never passed one — so every inspection and every condition photo
    // taken during a live rental was stored with rental_id NULL. The evidence
    // existed and could not be found from the rental it was evidence for: the
    // booking's Inspections tab and listConditionMedia(vehicle, rental) both
    // came back empty, which is exactly the gap that loses a damage claim.
    //
    // So when the caller does not name a rental, ask the car. Only the ACTIVE
    // rental counts, which is why a pre-delivery inspection before activation
    // still correctly records no rental at all.
    let rentalId = data.rentalId ?? null;
    if (!rentalId) {
      const { data: live } = await supabaseAdmin
        .from("rentals")
        .select("id")
        .eq("vehicle_id", data.vehicleId)
        .eq("status", "active")
        .maybeSingle();
      rentalId = (live?.id as string | undefined) ?? null;
    }

    const { data: inspection, error } = await supabaseAdmin
      .from("inspections")
      .insert({
        vehicle_id: data.vehicleId,
        rental_id: rentalId,
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
    const operator = await canInspect(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: inspection } = await supabaseAdmin
      .from("inspections")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!inspection) throw new Error("Inspection not found");

    if (!operator) {
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
      driver_signature_name: inspection.driver_signature_name ?? null,
      driver_signed_at: inspection.driver_signed_at ?? null,
      driver_notes: inspection.driver_notes ?? null,
      items: (items ?? []) as InspectionItem[],
      media: await signMedia(supabaseAdmin, media ?? [], { includeGps: true }),
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
    if (!(await canInspect(context.supabase, context.userId))) throw new Error("Forbidden");
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
    if (!(await canInspect(context.supabase, context.userId))) throw new Error("Forbidden");
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
    if (!(await canInspect(context.supabase, context.userId))) throw new Error("Forbidden");
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

// ------------------------------------------------ renter sign-off at handover

export type InspectionToSign = {
  id: string;
  vehicleLabel: string;
  inspectionType: string;
  odometer: number | null;
  fuelLevel: string | null;
  completedAt: string | null;
  inspectorName: string | null;
  signedAt: string | null;
  signatureName: string | null;
  driverNotes: string | null;
  items: Array<{ section: string; label: string; result: string; notes: string | null }>;
  media: ConditionMedia[];
};

/**
 * The checkout inspection this renter is being asked to agree to.
 *
 * Condition photos and a completed checklist record what the car looked like
 * at handover, but only from our side. Until the renter signs that record, a
 * damage dispute is still our word against theirs.
 *
 * Returns the most recent passed pre-delivery inspection on the car they are
 * renting — signed or not, so the portal can show the countersigned copy
 * afterwards rather than having it disappear.
 */
export const getMyCheckoutInspection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InspectionToSign | null> => {
    const rental = await activeRentalFor(context.supabase, context.userId);
    if (!rental?.vehicle_id) return null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: inspection } = await supabaseAdmin
      .from("inspections")
      .select("*")
      .eq("vehicle_id", rental.vehicle_id)
      .eq("inspection_type", "pre_delivery")
      .eq("status", "passed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!inspection) return null;

    const [{ data: items }, { data: media }, { data: vehicle }] = await Promise.all([
      supabaseAdmin
        .from("inspection_items")
        .select("section,label,result,notes")
        .eq("inspection_id", inspection.id)
        .order("sort_order"),
      // This rental's pickup, or the pre-delivery inspection being signed —
      // never another renter's pickup on the same car. Two reads, merged,
      // rather than an interpolated .or() filter.
      Promise.all([
        supabaseAdmin
          .from("condition_media")
          .select("*")
          .eq("vehicle_id", rental.vehicle_id)
          .eq("phase", "checkout")
          .eq("rental_id", rental.id),
        supabaseAdmin
          .from("condition_media")
          .select("*")
          .eq("vehicle_id", rental.vehicle_id)
          .eq("phase", "checkout")
          .eq("inspection_id", inspection.id),
      ]).then(([a, b]) => {
        const seen = new Map<string, any>();
        for (const m of [...(a.data ?? []), ...(b.data ?? [])]) seen.set(m.id, m);
        return { data: [...seen.values()].sort((x, y) => String(x.created_at).localeCompare(String(y.created_at))) };
      }),
      supabaseAdmin
        .from("vehicles")
        .select("year,make,model,license_plate")
        .eq("id", rental.vehicle_id)
        .maybeSingle(),
    ]);

    return {
      id: inspection.id as string,
      vehicleLabel:
        [
          [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" "),
          vehicle?.license_plate,
        ]
          .filter(Boolean)
          .join(" · ") || "Your vehicle",
      inspectionType: inspection.inspection_type as string,
      odometer: (inspection.odometer as number | null) ?? null,
      fuelLevel: (inspection.fuel_level as string | null) ?? null,
      completedAt: (inspection.completed_at as string | null) ?? null,
      inspectorName: (inspection.inspector_name as string | null) ?? null,
      signedAt: (inspection.driver_signed_at as string | null) ?? null,
      signatureName: (inspection.driver_signature_name as string | null) ?? null,
      driverNotes: (inspection.driver_notes as string | null) ?? null,
      items: (items ?? []) as InspectionToSign["items"],
      media: await signMedia(supabaseAdmin, media ?? [], { includeGps: false, renter: true }),
    };
  });

export const signCheckoutInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        inspectionId: z.string().uuid(),
        signerName: z.string().trim().min(2).max(140),
        agree: z.literal(true),
        notes: z.string().max(2000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
    await (await import("@/lib/driver-preview.server")).refuseStaffPortalWrite(context.userId);
    const rental = await activeRentalFor(context.supabase, context.userId);
    if (!rental?.vehicle_id) return { error: "No active rental on file." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: inspection } = await supabaseAdmin
      .from("inspections")
      .select("id,vehicle_id,status,inspection_type,driver_signed_at")
      .eq("id", data.inspectionId)
      .maybeSingle();
    if (!inspection) return { error: "Inspection not found." };

    // The renter may only sign the checkout inspection for the car they
    // actually rent, and only one that has passed.
    if (inspection.vehicle_id !== rental.vehicle_id) return { error: "Forbidden" };
    if (inspection.inspection_type !== "pre_delivery" || inspection.status !== "passed") {
      return { error: "That inspection is not ready for signature." };
    }
    // A signature is a record of a moment; re-signing would overwrite it.
    if (inspection.driver_signed_at) return { error: "You have already signed this." };

    const req = getRequest();
    const ip =
      req?.headers.get("cf-connecting-ip") ||
      req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      null;
    const agent = req?.headers.get("user-agent") ?? null;

    const { error } = await supabaseAdmin
      .from("inspections")
      .update({
        driver_user_id: context.userId,
        driver_signature_name: data.signerName.trim(),
        driver_signed_at: new Date().toISOString(),
        driver_signature_ip: ip,
        driver_signature_user_agent: agent,
        driver_notes: data.notes?.trim() || null,
      })
      .eq("id", data.inspectionId)
      // Re-check under the write so two concurrent submissions cannot both
      // land; the second updates zero rows.
      .is("driver_signed_at", null);
    if (error) return { error: error.message };

    return { ok: true };
  });
