/**
 * Staff preview loader for the renter portal. Mirrors
 * public.renter_portal_summary / renter_portal_file using the service role
 * for one named driver. The renter's own path still uses the SECURITY DEFINER
 * RPCs (auth.uid()). No new migration; no existing policy changed.
 */
import {
  clampSummary,
  recordsVisible,
  renterStage,
  type RenterPortalSummary,
  type RenterStage,
} from "@/lib/renter-portal";

function nyToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function stageRank(stage: RenterStage): number {
  if (stage === "active") return 0;
  if (stage === "assigned") return 1;
  if (stage === "returned") return 2;
  return 9;
}

type RentalRow = {
  id: string;
  vehicle_id: string | null;
  application_id: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  updated_at: string | null;
  created_at: string | null;
};

/** Build the same JSON shape as public.renter_portal_summary for one driver. */
export async function loadRenterPortalSummaryForDriver(
  admin: any,
  driverUserId: string,
): Promise<RenterPortalSummary> {
  const today = nyToday();
  const { data: rentals, error } = await admin
    .from("rentals")
    .select("id,vehicle_id,application_id,status,start_date,end_date,updated_at,created_at")
    .eq("driver_id", driverUserId);
  if (error) throw new Error(error.message);

  const ranked = ((rentals ?? []) as RentalRow[])
    .map((r) => ({ r, stage: renterStage(r.status, r.end_date, today) }))
    .filter((x) => x.stage !== "none")
    .sort((a, b) => {
      const d = stageRank(a.stage) - stageRank(b.stage);
      if (d !== 0) return d;
      return String(b.r.created_at ?? "").localeCompare(String(a.r.created_at ?? ""));
    });

  if (ranked.length === 0) return clampSummary({ stage: "none" });
  const { r, stage } = ranked[0];
  const returnedOn =
    stage === "returned"
      ? r.end_date ?? (r.updated_at ? String(r.updated_at).slice(0, 10) : null)
      : null;

  let plate: string | null = null;
  let plateState: string | null = null;
  let vin: string | null = null;
  let registration: RenterPortalSummary["registration"] | undefined;

  if ((stage === "assigned" || stage === "active") && r.vehicle_id) {
    const { data: v } = await admin
      .from("vehicles")
      .select("license_plate,plate_state,vin,registration_state,registration_number,registration_expires_on")
      .eq("id", r.vehicle_id)
      .maybeSingle();
    plate = v?.license_plate ?? null;
    plateState = v?.plate_state ?? null;
    vin = v?.vin ?? null;
    if (stage === "active") {
      const { data: regDocs } = await admin
        .from("documents")
        .select("id,label,file_name,expires_at,created_at")
        .eq("vehicle_id", r.vehicle_id)
        .eq("is_current", true)
        .eq("category", "registration")
        .order("created_at", { ascending: false });
      registration = {
        state: v?.registration_state ?? null,
        number: v?.registration_number ?? null,
        expiresOn: v?.registration_expires_on ?? null,
        files: (regDocs ?? []).map((d: any) => ({
          id: d.id,
          label: d.label || d.file_name || "Registration",
          expiresOn: d.expires_at ?? null,
        })),
      };
    }
  }

  let insurance: RenterPortalSummary["insurance"] | undefined;
  if (stage === "active") {
    const { data: apps } = await admin.from("applications").select("id").eq("user_id", driverUserId);
    const appIds = (apps ?? []).map((a: any) => a.id as string);
    if (appIds.length) {
      const { data: docs } = await admin
        .from("documents")
        .select("id,label,file_name,expires_at,review_status,is_current,created_at,visibility")
        .in("driver_id", appIds)
        .eq("category", "insurance")
        .order("created_at", { ascending: false });
      insurance = (docs ?? [])
        .filter((d: any) => Array.isArray(d.visibility) && d.visibility.includes("driver"))
        .filter((d: any) => d.is_current || d.review_status === "verified")
        .map((d: any) => ({
          id: d.id,
          label: d.label || d.file_name || "Insurance",
          expiresOn: d.expires_at ?? null,
          reviewStatus: d.review_status,
          isCurrent: !!d.is_current,
          uploadedAt: d.created_at ?? null,
        }));
    } else {
      insurance = [];
    }
  }

  const showRecords = recordsVisible(stage, returnedOn, today);
  let photos: RenterPortalSummary["photos"] | undefined;
  let receipts: RenterPortalSummary["receipts"] | undefined;
  if (showRecords) {
    const [{ data: media }, { data: pays }] = await Promise.all([
      admin
        .from("condition_media")
        .select("id,phase,angle,media_type,captured_by_role,created_at,taken_at,taken_at_source")
        .eq("rental_id", r.id)
        .order("created_at", { ascending: true }),
      admin
        .from("payments")
        .select("id,type,amount,paid_date,payment_method")
        .eq("rental_id", r.id)
        .eq("status", "paid")
        .order("paid_date", { ascending: false }),
    ]);
    photos = (media ?? []).map((m: any) => ({
      id: m.id,
      phase: m.phase,
      angle: m.angle,
      mediaType: m.media_type,
      capturedByRole: m.captured_by_role ?? null,
      takenAt: m.taken_at ?? m.created_at,
      takenAtSource: m.taken_at_source ?? (m.taken_at ? "exif" : "upload"),
    }));
    receipts = (pays ?? []).map((p: any) => ({
      id: p.id,
      type: p.type,
      amount: Number(p.amount ?? 0),
      paidDate: p.paid_date,
      method: p.payment_method,
    }));
  }

  return clampSummary({
    stage,
    rentalId: r.id,
    plate,
    plateState,
    vin,
    returnedOn,
    registration,
    insurance,
    photos,
    receipts,
  });
}

/** Same authorization as public.renter_portal_file for a named driver. */
export async function authorizeRenterPortalFileForDriver(
  admin: any,
  driverUserId: string,
  kind: "photo" | "registration" | "insurance",
  id: string,
): Promise<{ storage_bucket: string; storage_path: string } | null> {
  const today = nyToday();
  if (kind === "photo") {
    const { data: m } = await admin
      .from("condition_media")
      .select("id,storage_bucket,share_path,rental_id")
      .eq("id", id)
      .maybeSingle();
    // Renters get the metadata-free share copy, never the original.
    if (!m?.storage_bucket || !m.share_path) return null;
    const { data: rental } = await admin
      .from("rentals")
      .select("id,status,end_date,updated_at,driver_id")
      .eq("id", m.rental_id)
      .maybeSingle();
    if (!rental || rental.driver_id !== driverUserId) return null;
    const stage = renterStage(rental.status, rental.end_date, today);
    const returnedOn =
      stage === "returned"
        ? rental.end_date ?? (rental.updated_at ? String(rental.updated_at).slice(0, 10) : null)
        : null;
    if (!recordsVisible(stage, returnedOn, today)) return null;
    return { storage_bucket: m.storage_bucket, storage_path: m.share_path };
  }

  if (kind === "registration") {
    const { data: d } = await admin
      .from("documents")
      .select("id,storage_bucket,storage_path,vehicle_id,category,is_current")
      .eq("id", id)
      .maybeSingle();
    if (!d || d.category !== "registration" || !d.is_current) return null;
    const { data: rental } = await admin
      .from("rentals")
      .select("id,status,end_date,driver_id")
      .eq("vehicle_id", d.vehicle_id)
      .eq("driver_id", driverUserId)
      .limit(20);
    const active = ((rental ?? []) as any[]).find((r) => renterStage(r.status, r.end_date, today) === "active");
    if (!active) return null;
    return { storage_bucket: d.storage_bucket, storage_path: d.storage_path };
  }

  // insurance
  const { data: d } = await admin
    .from("documents")
    .select("id,storage_bucket,storage_path,driver_id,category,visibility")
    .eq("id", id)
    .maybeSingle();
  if (!d || d.category !== "insurance") return null;
  if (!Array.isArray(d.visibility) || !d.visibility.includes("driver")) return null;
  const { data: app } = await admin.from("applications").select("id,user_id").eq("id", d.driver_id).maybeSingle();
  if (!app || app.user_id !== driverUserId) return null;
  const { data: rentals } = await admin
    .from("rentals")
    .select("status,end_date")
    .eq("driver_id", driverUserId);
  const hasActive = ((rentals ?? []) as any[]).some((r) => renterStage(r.status, r.end_date, today) === "active");
  if (!hasActive) return null;
  return { storage_bucket: d.storage_bucket, storage_path: d.storage_path };
}
