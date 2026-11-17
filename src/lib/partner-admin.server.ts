/** Staff-side partner helpers (server only). */
type Admin = any;

const APPROVAL_ERRORS: Record<string, string> = {
  submission_not_found: "That submission no longer exists.",
  submission_already_approved: "That car was already approved.",
  split_out_of_range: "The partner split must be between 1% and 99%.",
  weekly_rate_required: "Enter the weekly rate to list the car.",
  vin_belongs_to_another_partner: "A vehicle with this VIN already belongs to another partner.",
};

export function approvalErrorMessage(error: { message?: string; code?: string } | null | undefined): string {
  const msg = String(error?.message ?? "");
  for (const [k, v] of Object.entries(APPROVAL_ERRORS)) if (msg.includes(k)) return v;
  if (/approve_partner_submission/.test(msg) && /not find|does not exist/i.test(msg)) {
    return "The Partner Portal database update is not installed yet (migration 20261117070000_partner_portal_v2).";
  }
  if (/vehicles_vin_unique_idx/.test(msg)) return "A vehicle with this VIN is already in the fleet.";
  if (/guard|rate|vin/i.test(msg)) return `The car could not be listed: ${msg}`;
  return "Could not approve this car. Nothing was changed.";
}

/**
 * Copy the ticked intake photos into the private vehicle-photos bucket as
 * vehicle_media originals. When publish is true they become the listing
 * photos (the first is the lead image); the database trigger then derives
 * vehicles.photos for the public site. Paths must belong to this submission.
 */
export async function copySubmissionPhotos(
  admin: Admin,
  args: { submissionId: string; vehicleId: string; paths: string[]; publish: boolean; actorId: string },
): Promise<{ copied: number; published: number; failed: number }> {
  const { data: s } = await admin.from("fleet_owner_submissions").select("photo_urls").eq("id", args.submissionId).maybeSingle();
  const allowed = new Set<string>((s?.photo_urls ?? []) as string[]);
  const paths = args.paths.filter((p) => allowed.has(p) && p.startsWith(`${args.submissionId}/`));
  const { count } = await admin.from("vehicle_media").select("id", { count: "exact", head: true }).eq("vehicle_id", args.vehicleId).eq("published", true).eq("is_primary", true);
  let hasLead = (count ?? 0) > 0;
  const { data: maxRow } = await admin.from("vehicle_media").select("sort_order").eq("vehicle_id", args.vehicleId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  let sort = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;
  let copied = 0, published = 0, failed = 0;
  for (const p of paths) {
    try {
      const dl = await admin.storage.from("owner-vehicle-photos").download(p);
      if (dl.error || !dl.data) { failed++; continue; }
      const ext = (p.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const dest = `${args.vehicleId}/partner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const type = (dl.data as Blob).type || (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
      const up = await admin.storage.from("vehicle-photos").upload(dest, dl.data, { contentType: type });
      if (up.error) { failed++; continue; }
      const lead = args.publish && !hasLead;
      const ins = await admin.from("vehicle_media").insert({
        vehicle_id: args.vehicleId,
        kind: "original",
        provenance: "uploaded",
        storage_bucket: "vehicle-photos",
        storage_path: dest,
        file_name: p.split("/").pop() ?? null,
        mime_type: type,
        size_bytes: (dl.data as Blob).size ?? null,
        caption: "From partner submission",
        is_primary: lead || (!args.publish && copied === 0 && !hasLead),
        published: args.publish,
        sort_order: sort++,
        uploaded_by: args.actorId,
      });
      if (ins.error) { failed++; continue; }
      copied++;
      if (args.publish) published++;
      if (lead) hasLead = true;
    } catch {
      failed++;
    }
  }
  return { copied, published, failed };
}
