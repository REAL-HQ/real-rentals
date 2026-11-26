/**
 * Upload or replace one document through the secure application link,
 * before pickup (t466u).
 *
 * The wizard's own save (updateApplicationStep) stays locked once an
 * application is approved, because a live link must not rewrite an
 * application staff have decided. Documents are the exception Dolmar asked
 * for: between approval and pickup the Driver Portal is closed, so the secure
 * link is how a renter re-sends a blurry license or a new insurance card.
 *
 * Only the document column for the named kind changes. The file must be one
 * requestUploadUrl issued for this application (its own folder). The vault
 * sync registers it as the current document and moves the old one to
 * previous versions (single-slot categories supersede themselves; nothing is
 * deleted). Staff get an in-app alert and an audit entry, and the new file
 * shows up for review like any other upload.
 */
import { canUploadBeforePickupStatus } from "@/lib/application-edit-status";

export type ApplicantDocKind = "license" | "insurance" | "gig_profile" | "trip_history" | "income";

export const DOC_KIND_COLUMN: Record<Exclude<ApplicantDocKind, "trip_history">, string> = {
  license: "license_photo_url",
  insurance: "insurance_doc_url",
  gig_profile: "profile_screenshot_url",
  income: "income_proof_url",
};

export const DOC_KIND_LABEL: Record<ApplicantDocKind, string> = {
  license: "Driver's License",
  insurance: "Insurance",
  gig_profile: "Gig Profile",
  trip_history: "Trip History",
  income: "Proof Of Income",
};

export const DOC_REPLACE_LOCKED_MESSAGE =
  "Your rental has started, so documents now go through your driver portal. Sign in there to update them.";
export const DOC_REPLACE_CLOSED_MESSAGE =
  "This application is no longer taking documents. Email team@drivereal.com and we'll add it for you.";

type Admin = { from: (table: string) => any };

/**
 * Exactly the shape requestUploadUrl generates for this application:
 * "<applicationId>/<epoch ms>-<random>.<ext>". Nothing a caller invents
 * (quotes, commas, spaces, another folder) gets stored, so the trip
 * screenshot retirement filter, which builds a not.in list from these
 * paths, stays safe.
 */
export function isIssuedUploadPath(applicationId: string, path: unknown): boolean {
  if (typeof path !== "string" || !/^[0-9a-f-]{36}$/i.test(applicationId)) return false;
  const rest = path.startsWith(`${applicationId}/`) ? path.slice(applicationId.length + 1) : null;
  return rest !== null && /^\d{10,16}-[a-z0-9]{1,8}\.[a-z0-9]{2,5}$/.test(rest);
}

export type ReplaceDeps = {
  pickedUp?: (admin: Admin, applicationId: string, status: string | null) => Promise<boolean>;
  sync?: (admin: Admin, row: Record<string, unknown>) => Promise<unknown>;
  audit?: (entry: Record<string, unknown>) => Promise<void>;
};

export async function replaceApplicantDocumentCore(
  admin: Admin,
  applicationId: string,
  input: { kind: ApplicantDocKind; path: string },
  deps: ReplaceDeps = {},
): Promise<{ ok: true; replaced: boolean }> {
  if (!isIssuedUploadPath(applicationId, input.path)) {
    throw new Error("That file reference is not one we issued.");
  }
  const { data: app, error } = await admin
    .from("applications")
    .select("id,status,user_id,full_name,license_expiration,license_photo_url,insurance_doc_url,profile_screenshot_url,income_proof_url,trip_screenshots")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) throw new Error("Application not found");
  const status = (app.status as string | null) ?? null;
  if (!canUploadBeforePickupStatus(status)) throw new Error(DOC_REPLACE_CLOSED_MESSAGE);
  const pickedUp = deps.pickedUp ?? (await import("@/lib/portal-pickup-gate.server")).applicationPickedUp;
  if (await pickedUp(admin, applicationId, status)) throw new Error(DOC_REPLACE_LOCKED_MESSAGE);

  const patch: Record<string, unknown> = {};
  let replaced = false;
  if (input.kind === "trip_history") {
    const trips = Array.isArray(app.trip_screenshots) ? (app.trip_screenshots as string[]) : [];
    if (!trips.includes(input.path)) patch.trip_screenshots = [...trips, input.path].slice(-10);
  } else {
    const column = DOC_KIND_COLUMN[input.kind];
    replaced = Boolean(app[column]);
    patch[column] = input.path;
  }
  if (Object.keys(patch).length) {
    // The status condition repeats the check above, so a decision landing in
    // between (declined, closed) still wins.
    const { error: upErr } = await admin
      .from("applications")
      .update(patch)
      .eq("id", applicationId)
      .eq("status", status);
    if (upErr) throw new Error(upErr.message);
  }

  try {
    const sync = deps.sync ?? (await import("@/lib/documents.functions")).syncApplicationUploads;
    await sync(admin, { ...app, ...patch });
  } catch (e) {
    console.error("[documents] secure-link document sync failed", e);
  }

  const label = DOC_KIND_LABEL[input.kind];
  const who = String(app.full_name ?? "").trim() || "An applicant";
  await admin
    .from("notifications")
    .insert({
      kind: "document",
      title: replaced ? "Document Replaced" : "Document Uploaded",
      body: `${who} ${replaced ? "replaced" : "uploaded"} their ${label} through their secure link. Review it on their profile.`,
      read: false,
      channels: ["in_app"],
    })
    .then(() => {}, () => {});
  const audit =
    deps.audit ??
    (async (entry: Record<string, unknown>) => {
      const { logAudit } = await import("@/lib/audit.server");
      await logAudit(null, entry as any);
    });
  await audit({
    action: replaced ? "application.document_replaced" : "application.document_uploaded",
    summary: `${label} ${replaced ? "replaced" : "uploaded"} through the secure link`,
    entityType: "application",
    entityId: applicationId,
    metadata: { kind: input.kind, status, source: "secure_link" },
  });
  return { ok: true, replaced };
}

const KIND_CATEGORY: Record<Exclude<ApplicantDocKind, "trip_history">, { category: string; bucket: string }> = {
  license: { category: "license_front", bucket: "license-uploads" },
  insurance: { category: "insurance", bucket: "license-uploads" },
  gig_profile: { category: "gig_profile", bucket: "profile-screenshots" },
  income: { category: "income", bucket: "license-uploads" },
};

export type AddDeps = ReplaceDeps & {
  register?: (admin: Admin, args: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Add another file to a section without touching the ones already there.
 *
 * Replace swaps the file the application column names. Add keeps it and files
 * the new one beside it as a second active document, so an applicant can send
 * two pay stubs or a gig profile for each app and staff (and FLEET) see all of
 * them. The first file in an empty section still goes in the column, so the
 * application itself keeps pointing at a main file. Trip history is already a
 * list and takes the same path as before.
 */
export async function addApplicantDocumentCore(
  admin: Admin,
  applicationId: string,
  input: { kind: ApplicantDocKind; path: string },
  deps: AddDeps = {},
): Promise<{ ok: true; added: true; asPrimary: boolean }> {
  if (!isIssuedUploadPath(applicationId, input.path)) {
    throw new Error("That file reference is not one we issued.");
  }
  if (input.kind === "trip_history") {
    await replaceApplicantDocumentCore(admin, applicationId, input, deps);
    return { ok: true, added: true, asPrimary: false };
  }
  const { data: app, error } = await admin
    .from("applications")
    .select("id,status,user_id,full_name,license_expiration,license_photo_url,insurance_doc_url,profile_screenshot_url,income_proof_url,trip_screenshots")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) throw new Error("Application not found");
  const status = (app.status as string | null) ?? null;
  if (!canUploadBeforePickupStatus(status)) throw new Error(DOC_REPLACE_CLOSED_MESSAGE);
  const pickedUp = deps.pickedUp ?? (await import("@/lib/portal-pickup-gate.server")).applicationPickedUp;
  if (await pickedUp(admin, applicationId, status)) throw new Error(DOC_REPLACE_LOCKED_MESSAGE);

  const column = DOC_KIND_COLUMN[input.kind];
  const { category, bucket } = KIND_CATEGORY[input.kind];
  const label = DOC_KIND_LABEL[input.kind];
  const asPrimary = !app[column];
  const patch: Record<string, unknown> = {};
  if (asPrimary) {
    patch[column] = input.path;
    const { error: upErr } = await admin.from("applications").update(patch).eq("id", applicationId).eq("status", status);
    if (upErr) throw new Error(upErr.message);
  }
  if (asPrimary) {
    const sync = deps.sync ?? (await import("@/lib/documents.functions")).syncApplicationUploads;
    await sync(admin, { ...app, ...patch }).catch((e: unknown) => console.error("[documents] secure-link document sync failed", e));
  } else {
    const register = deps.register ?? (await import("@/lib/documents.functions")).registerDocument;
    await register(admin, {
      applicationId,
      category,
      bucket,
      path: input.path,
      fileName: input.path.split("/").pop() ?? null,
      label: `Additional ${label}`,
      uploadedBy: (app.user_id as string | null) ?? null,
      uploadedByRole: "driver",
    });
  }

  const who = String(app.full_name ?? "").trim() || "An applicant";
  await admin
    .from("notifications")
    .insert({
      kind: "document",
      title: "Document Added",
      body: `${who} added another ${label} file through their secure link. Review it on their profile.`,
      read: false,
      channels: ["in_app"],
    })
    .then(() => {}, () => {});
  const audit =
    deps.audit ??
    (async (entry: Record<string, unknown>) => {
      const { logAudit } = await import("@/lib/audit.server");
      await logAudit(null, entry as any);
    });
  await audit({
    action: "application.document_added",
    summary: `Another ${label} file added through the secure link`,
    entityType: "application",
    entityId: applicationId,
    metadata: { kind: input.kind, status, source: "secure_link", primary: asPrimary },
  });
  return { ok: true, added: true, asPrimary };
}
