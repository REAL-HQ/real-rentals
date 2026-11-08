/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase service-role rows, as elsewhere in src/lib */
/**
 * Staff side of trip media on a renter's profile: Pickup / Return / Issues,
 * each Ours (team) and Yours (renter). Every upload is bound to one
 * application and either one of that applicant's rentals or, before any
 * rental exists, the vehicle the application names. The binding is decided
 * on the server, written into the storage path at reservation, and checked
 * again at confirm.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { tierAllows, tierFromRoles } from "@/lib/roles";
import {
  resolveBinding,
  tripMediaPrefix,
  tripMediaType,
  TRIP_MEDIA_MAX_BYTES,
  type BindingApp,
  type BindingRental,
} from "@/lib/trip-media";
import { CONDITION_BUCKET_NAME } from "@/lib/trip-media-bucket";

const Phase = z.enum(["checkout", "checkin", "damage", "other"]);
const Uuid = z.string().uuid();

async function requireInspector(supabase: any, userId: string): Promise<void> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const tier = tierFromRoles(((data ?? []) as Array<{ role: unknown }>).map((r) => String(r.role)));
  if (!tierAllows(tier, "coordinator")) throw new Error("Forbidden");
}

async function loadApp(admin: any, applicationId: string): Promise<BindingApp> {
  const { data, error } = await admin
    .from("applications")
    .select("id,user_id,vehicle_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new Error("Could not read the application");
  if (!data) throw new Error("Application not found");
  return data as BindingApp;
}

async function loadRentals(
  admin: any,
  app: BindingApp,
): Promise<Array<BindingRental & Record<string, any>>> {
  const cols = "id,driver_id,vehicle_id,application_id,status,start_date,end_date,created_at";
  const byApp = await admin.from("rentals").select(cols).eq("application_id", app.id);
  const byUser = app.user_id
    ? await admin.from("rentals").select(cols).eq("driver_id", app.user_id)
    : { data: [] };
  const seen = new Map<string, any>();
  for (const r of [...(byApp.data ?? []), ...(byUser.data ?? [])]) seen.set(r.id, r);
  return [...seen.values()].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  );
}

export type TripTarget = {
  key: string;
  rentalId: string | null;
  vehicleId: string;
  vehicleLabel: string;
  label: string;
  status: string | null;
};

/** The trips this applicant has, plus "Before Rental" when the application names a vehicle. */
export const listTripTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: Uuid }).parse(d))
  .handler(async ({ data, context }): Promise<TripTarget[]> => {
    await requireInspector(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await loadApp(supabaseAdmin, data.applicationId);
    const rentals = await loadRentals(supabaseAdmin, app);
    const vehicleIds = [
      ...new Set([...rentals.map((r) => r.vehicle_id), app.vehicle_id].filter(Boolean)),
    ] as string[];
    const { data: vs } = vehicleIds.length
      ? await supabaseAdmin
          .from("vehicles")
          .select("id,year,make,model,license_plate,vehicle_number")
          .in("id", vehicleIds)
      : { data: [] as any[] };
    const vl = (id: string) => {
      const v = (vs ?? []).find((x: any) => x.id === id);
      return v
        ? [v.vehicle_number, [v.year, v.make, v.model].filter(Boolean).join(" "), v.license_plate]
            .filter(Boolean)
            .join(" · ")
        : "Vehicle";
    };
    const out: TripTarget[] = rentals.map((r) => ({
      key: r.id,
      rentalId: r.id,
      vehicleId: r.vehicle_id,
      vehicleLabel: vl(r.vehicle_id),
      label: `Trip ${r.start_date ?? "—"} → ${r.end_date ?? "open"}`,
      status: r.status ?? null,
    }));
    if (app.vehicle_id) {
      out.push({
        key: "pre",
        rentalId: null,
        vehicleId: app.vehicle_id,
        vehicleLabel: vl(app.vehicle_id),
        label: "Before Rental",
        status: null,
      });
    }
    return out;
  });

export const createTripMediaUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: Uuid,
        rentalId: Uuid.nullable(),
        phase: Phase,
        fileName: z.string().min(1).max(200),
        mimeType: z.string().max(120),
        sizeBytes: z.number().int().positive(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireInspector(context.supabase, context.userId);
    const mime = tripMediaType(data.fileName, data.mimeType);
    if (!mime) throw new Error("This file type isn't supported");
    if (data.sizeBytes > TRIP_MEDIA_MAX_BYTES) throw new Error("Larger than 50 MB");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { vehicleId, rentalId } = await bind(supabaseAdmin, data.applicationId, data.rentalId);
    const ext =
      (data.fileName.split(".").pop() ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 5) || "bin";
    const path = `${tripMediaPrefix(vehicleId, data.applicationId, rentalId)}${data.phase}-${crypto.randomUUID()}.${ext}`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from(CONDITION_BUCKET_NAME)
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message || "Could not start upload");
    return {
      path: signed.path,
      token: signed.token,
      bucket: CONDITION_BUCKET_NAME,
      mimeType: mime,
    };
  });

async function bind(admin: any, applicationId: string, rentalId: string | null) {
  const app = await loadApp(admin, applicationId);
  let rental: BindingRental | null = null;
  if (rentalId) {
    const { data } = await admin
      .from("rentals")
      .select("id,driver_id,vehicle_id,application_id")
      .eq("id", rentalId)
      .maybeSingle();
    if (!data) throw new Error("Trip not found");
    rental = data as BindingRental;
  }
  return resolveBinding(app, rental);
}

export const confirmTripMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: Uuid,
        rentalId: Uuid.nullable(),
        phase: Phase,
        path: z.string().min(3).max(400),
        fileName: z.string().max(200),
        mimeType: z.string().max(120),
        sizeBytes: z.number().int().positive(),
        caption: z.string().max(200).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireInspector(context.supabase, context.userId);
    const mime = tripMediaType(data.fileName, data.mimeType);
    if (!mime) throw new Error("This file type isn't supported");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Re-derive the binding; the path must be the one reserved for it.
    const { vehicleId, rentalId } = await bind(supabaseAdmin, data.applicationId, data.rentalId);
    const prefix = tripMediaPrefix(vehicleId, data.applicationId, rentalId);
    const rest = data.path.slice(prefix.length);
    if (!data.path.startsWith(prefix) || !rest.startsWith(`${data.phase}-`) || rest.includes("/")) {
      throw new Error("Invalid upload path");
    }
    const { storeConditionMedia } = await import("@/lib/trip-media.server");
    const saved = await storeConditionMedia(supabaseAdmin, {
      vehicleId,
      rentalId,
      applicationId: data.applicationId,
      inspectionId: null,
      phase: data.phase,
      angle: data.phase === "damage" ? "damage" : null,
      path: data.path,
      fileName: data.fileName,
      mimeType: mime,
      sizeBytes: data.sizeBytes,
      caption: data.caption ?? null,
      capturedBy: context.userId,
      capturedByRole: "staff",
    });
    return { ok: true, id: saved.id, missingExifTime: saved.missingExifTime };
  });

/** Everything on file for this applicant: their trips' media plus pre-rental media. Staff only, originals. */
export const listTripMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: Uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireInspector(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await loadApp(supabaseAdmin, data.applicationId);
    const rentals = await loadRentals(supabaseAdmin, app);
    const ids = rentals.map((r) => r.id);
    const byApp = await supabaseAdmin
      .from("condition_media")
      .select("*")
      .eq("application_id", app.id);
    const byRental = ids.length
      ? await supabaseAdmin.from("condition_media").select("*").in("rental_id", ids)
      : { data: [] as any[] };
    const rows = new Map<string, any>();
    for (const r of [...(byApp.data ?? []), ...(byRental.data ?? [])]) rows.set(r.id, r);
    const list = [...rows.values()].sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at)),
    );
    return Promise.all(
      list.map(async (m) => {
        const { data: s } = await supabaseAdmin.storage
          .from(m.storage_bucket)
          .createSignedUrl(m.storage_path, 60 * 30);
        return {
          id: m.id as string,
          rental_id: (m.rental_id as string | null) ?? null,
          phase: m.phase as string,
          media_type: (m.media_type as string) ?? "photo",
          mime_type: (m.mime_type as string | null) ?? null,
          file_name: (m.file_name as string | null) ?? null,
          captured_by_role: (m.captured_by_role as string) ?? "staff",
          taken_at: m.taken_at_source === "exif" ? ((m.taken_at as string | null) ?? null) : null,
          uploaded_at: m.created_at as string,
          has_gps: m.gps_lat != null && m.gps_lng != null,
          renter_preview: !!m.share_path,
          url: s?.signedUrl ?? null,
        };
      }),
    );
  });

/**
 * Make renter share copies for files uploaded before share copies existed.
 * Manager or above. Processes a small batch per call; never touches the
 * original object or any column other than share_path. STAGED: not run by
 * this PR — it is step 3 of the release sequence.
 */
export const backfillShareCopies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ limit: z.number().int().min(1).max(20).default(10) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { backfillOne } = await import("@/lib/trip-media.server");
    const { data: rows, error } = await supabaseAdmin
      .from("condition_media")
      .select("id,storage_bucket,storage_path,mime_type")
      .is("share_path", null)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    const out = { made: 0, skipped: 0 };
    for (const r of rows ?? []) {
      if (await backfillOne(supabaseAdmin, r as any)) out.made += 1;
      else out.skipped += 1;
    }
    return out;
  });
