import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  DOCUMENT_CONTENT_SHA256_ENABLED,
  isUploadedContentShaRefusal,
  recordUploadedContentSha,
} from "@/lib/document-content-sha";
import {
  SIGNED_AGREEMENT_DELETE_REFUSED,
  SIGNED_AGREEMENT_DRIVER_UPLOAD_REFUSED,
  SIGNED_AGREEMENT_NEEDS_NEW_REFUSED,
  SIGNED_AGREEMENT_REPLACE_REFUSED,
  isSignedAgreementEvidence,
} from "@/lib/signed-agreement-evidence";

export const DOC_BUCKET = "driver-docs";

export const DOC_CATEGORIES = [
  { key: "license_front", label: "Driver's license (front)", expiring: true },
  { key: "license_back", label: "Driver's license (back)", expiring: true },
  { key: "insurance", label: "Insurance card", expiring: true },
  { key: "gig_profile", label: "Gig profile screenshot", expiring: false },
  // Its own category, not a second gig_profile. Filing trip screenshots under
  // gig_profile meant each one superseded the applicant's actual gig profile
  // — and every trip screenshot before it — because registerDocument marks
  // same-category currents as superseded. One applicant's four uploads showed
  // up as one document with three "previous versions", none of them the file
  // the label claimed.
  { key: "trip_history", label: "Trip history screenshot", expiring: false },
  { key: "agreement", label: "Signed agreement", expiring: false },
  { key: "other", label: "Other document", expiring: false },
  // Owner-only. A recording of an insurance verification call carries a third
  // party's voice and policy details, so it is confined at the row level in
  // RLS, not merely hidden in the UI. See RESTRICTED_CATEGORIES.
  { key: "verification_recording", label: "Verification call recording", expiring: false },
] as const;

/**
 * Categories no staff member below Owner may see, in any payload.
 *
 * Enforced twice, because each layer alone has a hole. The RLS policy on
 * `documents` stops a Manager or Coordinator reading the row through
 * PostgREST with their own JWT — verified, because before that policy existed
 * a Coordinator could read the row and its storage_path directly. The server
 * checks below stop the same row escaping through these functions, which sign
 * URLs with the service role and therefore bypass RLS entirely.
 */
export const RESTRICTED_CATEGORIES: readonly string[] = ["verification_recording"];

/**
 * Categories where several files are current at once.
 *
 * A licence has one right answer, so a new one supersedes the old. Trip
 * history is a set — an applicant sends four screenshots of four weeks — and
 * superseding within it destroys the evidence it exists to hold.
 */
export const MULTI_FILE_CATEGORIES: readonly string[] = ["trip_history", "other"];

export type DocCategory = (typeof DOC_CATEGORIES)[number]["key"];

export type VaultDocument = {
  id: string;
  category: string;
  label: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  expires_at: string | null;
  is_current: boolean;
  visibility: string[];
  uploaded_by_role: string | null;
  created_at: string;
  url: string | null;
  /**
   * uploaded  — received; nobody has looked at it
   * verified  — a staff member confirmed it is the right, readable document
   * rejected  — a staff member asked for a replacement
   *
   * Verifying a document is not approving the applicant, and nothing here
   * should ever be rendered as if it were.
   */
  review_status: DocumentReviewStatus;
  review_note: string | null;
  reviewed_at: string | null;
  /**
   * Signed-agreement evidence by its row shape (isSignedAgreementEvidence).
   * The vault hides Delete for these; deleteDocument refuses them regardless,
   * and also refuses anything an agreements row points at.
   */
  signed_agreement: boolean;
};

export type DocumentReviewStatus = "uploaded" | "verified" | "rejected";

const CategoryEnum = z.enum([
  "license_front",
  "license_back",
  "insurance",
  "gig_profile",
  "trip_history",
  "agreement",
  "other",
  "verification_recording",
]);

/** Owner, in the tier vocabulary the rest of the app uses. */
async function isOwner(supabase: any, userId: string): Promise<boolean> {
  return isAdmin(supabase, userId);
}

async function isAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

function safeExt(fileName: string, mime: string): string {
  const fromName = (fileName.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName && fromName.length <= 5) return fromName;
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "application/pdf": "pdf",
  };
  return map[mime] || "bin";
}

async function withUrls(admin: any, rows: any[]): Promise<VaultDocument[]> {
  return Promise.all(
    rows.map(async (d) => {
      let url: string | null = null;
      const { data: signed } = await admin.storage
        .from(d.storage_bucket)
        .createSignedUrl(d.storage_path, 60 * 15);
      url = signed?.signedUrl ?? null;
      return {
        id: d.id,
        category: d.category ?? "other",
        label: d.label ?? null,
        file_name: d.file_name ?? null,
        mime_type: d.mime_type ?? null,
        size_bytes: d.size_bytes ?? null,
        expires_at: d.expires_at ?? null,
        is_current: d.is_current ?? true,
        visibility: (d.visibility ?? []) as string[],
        uploaded_by_role: d.uploaded_by_role ?? null,
        created_at: d.created_at,
        url,
        review_status: (d.review_status ?? "uploaded") as DocumentReviewStatus,
        review_note: d.review_note ?? null,
        reviewed_at: d.reviewed_at ?? null,
        signed_agreement: isSignedAgreementEvidence(d),
      };
    }),
  );
}

const SELECT =
  "id,kind,category,label,file_name,mime_type,size_bytes,expires_at,is_current,visibility,uploaded_by_role,created_at,storage_bucket,storage_path,review_status,review_note,reviewed_at";

/**
 * Register an already-uploaded file as the current document in its category
 * and supersede whatever it replaces.
 *
 * Shared by the driver/admin vault upload and by the application wizard, whose
 * files land in the `license-uploads` bucket. Before this existed, anything a
 * renter uploaded while applying lived only as a URL column on the application
 * row — invisible to the portal vault, with no version history and no expiry
 * tracking. Registering it here means one record of a document regardless of
 * which door it came through.
 *
 * Idempotent: re-registering the same storage path is a no-op, so replaying a
 * wizard step cannot create duplicate vault entries.
 */
export async function registerDocument(
  admin: any,
  args: {
    applicationId: string;
    category: string;
    bucket: string;
    path: string;
    fileName?: string | null;
    mimeType?: string | null;
    sizeBytes?: number | null;
    expiresAt?: string | null;
    label?: string | null;
    uploadedBy?: string | null;
    uploadedByRole?: string;
    visibility?: string[];
  },
): Promise<{ id: string } | null> {
  const { data: seen } = await admin
    .from("documents")
    .select("id,storage_bucket,category,is_current,superseded_by")
    .eq("storage_path", args.path)
    .maybeSingle();
  if (seen) {
    /*
     * Heal what an earlier version of this function recorded wrongly. The
     * application columns are the truth about which file is which — the path
     * came from that column — so a row disagreeing with them is repaired
     * rather than duplicated. Idempotent: after the first pass these are all
     * no-ops.
     *
     *  - bucket: rows written before the per-column bucket map point gig
     *    screenshots at "license-uploads", where the object does not exist,
     *    so signing them returns nothing.
     *  - category: trip screenshots were filed as "gig_profile", which made
     *    each one supersede the applicant's real gig profile.
     *  - is_current: a row demoted by that mis-filing is restored, since the
     *    thing that superseded it was never a newer version of it.
     */
    const patch: Record<string, unknown> = {};
    if (seen.storage_bucket !== args.bucket) patch.storage_bucket = args.bucket;
    if (seen.category !== args.category) {
      patch.category = args.category;
      patch.kind = args.category;
      if (args.label) patch.label = args.label;
    }
    if (seen.is_current === false) {
      patch.is_current = true;
      patch.superseded_by = null;
    }
    if (Object.keys(patch).length) {
      await admin.from("documents").update(patch).eq("id", seen.id);
    }
    // Metadata the original registration could not know, filled in once.
    if (args.mimeType || args.sizeBytes) {
      await admin
        .from("documents")
        .update({ mime_type: args.mimeType ?? null, size_bytes: args.sizeBytes ?? null })
        .eq("id", seen.id)
        .is("size_bytes", null);
    }
    return { id: seen.id as string };
  }

  // Flag on, a missing object or a user_metadata write throws. Callers catch
  // that. Flag off, this returns null and the insert columns stay as they are.
  const contentSha = await recordUploadedContentSha(admin, args.bucket, args.path);
  const { data: row, error } = await admin
    .from("documents")
    .insert({
      driver_id: args.applicationId,
      kind: args.category,
      category: args.category,
      label: args.label ?? null,
      storage_bucket: args.bucket,
      storage_path: args.path,
      visibility: args.visibility ?? ["driver", "admin"],
      file_name: args.fileName ?? null,
      mime_type: args.mimeType ?? null,
      size_bytes: args.sizeBytes ?? null,
      expires_at: args.expiresAt || null,
      is_current: true,
      uploaded_by: args.uploadedBy ?? null,
      uploaded_by_role: args.uploadedByRole ?? "driver",
      ...(contentSha ? { content_sha256: contentSha } : {}),
    })
    .select("id")
    .single();
  if (error) {
    console.error("[documents] register failed", error.message);
    return null;
  }

  // Single-slot categories only. See MULTI_FILE_CATEGORIES.
  if (!MULTI_FILE_CATEGORIES.includes(args.category)) {
    await admin
      .from("documents")
      .update({ is_current: false, superseded_by: row.id })
      .eq("driver_id", args.applicationId)
      .eq("category", args.category)
      .eq("is_current", true)
      .neq("id", row.id);
  }

  return { id: row.id as string };
}

/**
 * Application columns that hold an uploaded file, mapped to a vault category
 * AND to the bucket the wizard actually uploaded them to.
 *
 * The bucket used to be hardcoded to "license-uploads" for all of these. It is
 * right for the licence and the insurance document and wrong for anything the
 * gig step collects, which goes to "profile-screenshots". A row recorded
 * against the wrong bucket still looks fine in the database — the failure only
 * shows up later, when signing the URL returns nothing and the document
 * silently renders as no link at all.
 */
export const APPLICATION_UPLOAD_FIELDS: Array<{
  column: string;
  category: string;
  label: string;
  bucket: string;
}> = [
  {
    column: "license_photo_url",
    category: "license_front",
    label: "Driver's license (from application)",
    bucket: "license-uploads",
  },
  {
    column: "insurance_doc_url",
    category: "insurance",
    label: "Insurance (from application)",
    bucket: "license-uploads",
  },
  {
    column: "profile_screenshot_url",
    category: "gig_profile",
    label: "Gig profile (from application)",
    bucket: "profile-screenshots",
  },
];

/** Trip screenshots are an array on the application, not a single column. */
const TRIP_SCREENSHOT_BUCKET = "profile-screenshots";

/**
 * Size and type, read from the object the applicant actually uploaded.
 *
 * The wizard uploads straight to storage with a signed URL, so the server
 * never sees the bytes and had nothing to record: every row registered from
 * an application carried mime_type and size_bytes NULL. The staff view then
 * had to guess "is this an image?" from the filename, and could not show a
 * size at all. Storage knows both; this asks it.
 *
 * Best-effort on purpose — a document that lists without its size is worth
 * far more than one that fails to register because a metadata call hiccuped.
 */
async function objectMeta(
  admin: any,
  bucket: string,
  path: string,
): Promise<{ mimeType: string | null; sizeBytes: number | null }> {
  try {
    const slash = path.lastIndexOf("/");
    const folder = slash > 0 ? path.slice(0, slash) : "";
    const name = slash > 0 ? path.slice(slash + 1) : path;
    const { data } = await admin.storage.from(bucket).list(folder, { search: name, limit: 100 });
    const hit = (data ?? []).find((o: any) => o?.name === name);
    return {
      mimeType: hit?.metadata?.mimetype ?? null,
      sizeBytes: typeof hit?.metadata?.size === "number" ? hit.metadata.size : null,
    };
  } catch {
    return { mimeType: null, sizeBytes: null };
  }
}

/**
 * Flag off: registerDocument's errors propagate, as they did before the
 * content-hash flag. Flag on: only a content-hash refusal is logged and
 * skipped, so one file does not drop the rest of the wizard sync.
 */
async function registerSyncedUpload(
  admin: any,
  category: string,
  args: Parameters<typeof registerDocument>[1],
): Promise<boolean> {
  if (!DOCUMENT_CONTENT_SHA256_ENABLED) {
    const res = await registerDocument(admin, args);
    return !!res;
  }
  try {
    const res = await registerDocument(admin, args);
    return !!res;
  } catch (e) {
    if (!isUploadedContentShaRefusal(e)) throw e;
    console.error("[documents] registration refused", category, e);
    return false;
  }
}

/**
 * Copy any files captured during the application into the document vault.
 * Safe to call on every wizard step — already-registered paths are skipped.
 */
export async function syncApplicationUploads(
  admin: any,
  application: Record<string, any>,
): Promise<number> {
  if (!application?.id) return 0;
  let registered = 0;

  for (const field of APPLICATION_UPLOAD_FIELDS) {
    const path = application[field.column];
    // Legacy rows stored a full URL rather than a storage path; those are not
    // objects we own, so leave them alone.
    if (!path || typeof path !== "string" || path.startsWith("http")) continue;
    if (
      await registerSyncedUpload(admin, field.category, {
        applicationId: application.id as string,
        category: field.category,
        bucket: field.bucket,
        path,
        fileName: path.split("/").pop() ?? null,
        label: field.label,
        expiresAt:
          field.category === "license_front" ? (application.license_expiration ?? null) : null,
        uploadedBy: (application.user_id as string) ?? null,
        uploadedByRole: "driver",
        ...(await objectMeta(admin, field.bucket, path)),
      })
    ) {
      registered++;
    }
  }

  // Gig trip screenshots arrive as an array of paths.
  const shots = Array.isArray(application.trip_screenshots) ? application.trip_screenshots : [];
  for (const path of shots) {
    if (!path || typeof path !== "string" || path.startsWith("http")) continue;
    if (
      await registerSyncedUpload(admin, "trip_history", {
        applicationId: application.id as string,
        category: "trip_history",
        bucket: TRIP_SCREENSHOT_BUCKET,
        path,
        fileName: path.split("/").pop() ?? null,
        label: "Trip screenshot (from application)",
        uploadedBy: (application.user_id as string) ?? null,
        uploadedByRole: "driver",
        ...(await objectMeta(admin, TRIP_SCREENSHOT_BUCKET, path)),
      })
    ) {
      registered++;
    }
  }

  /*
   * Retire trip screenshots the applicant has since removed.
   *
   * Single-slot categories retire themselves: registering a new licence
   * supersedes the old one. Trip history is a set, so nothing demotes a
   * member when it leaves — and the vault would go on showing a screenshot
   * the applicant deliberately took down as current evidence.
   *
   * Retired, not deleted. The row and the object both stay; it moves to
   * previous versions, where staff can still see what was once sent.
   */
  if (Array.isArray(application.trip_screenshots)) {
    const keep = shots.filter((p: unknown) => typeof p === "string");
    let q = admin
      .from("documents")
      .update({ is_current: false })
      .eq("driver_id", application.id)
      .eq("category", "trip_history")
      .eq("is_current", true);
    if (keep.length) q = q.not("storage_path", "in", `(${keep.map((p: string) => `"${p}"`).join(",")})`);
    await q;
  }

  return registered;
}

// ------------------------------------------------------------------- admin

export const adminListDriverDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<VaultDocument[]> => {
    // Manager and above. A driver's vault holds their licence, their
    // insurance and their identity documents, and the list carries the
    // storage paths that reach the files themselves — so this is not
    // operational screening work, whatever the screening workflow needs.
    // (It was briefly Coordinator-and-above for exactly that reason; the
    // reviewed security position is Manager.)
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const owner = await isOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Backfill on read: applications submitted before uploads were mirrored
    // into the vault get their files registered the first time anyone opens
    // it. Idempotent, so this settles to a no-op after the first view.
    const { data: app } = await supabaseAdmin
      .from("applications")
      .select(
        "id,user_id,license_photo_url,insurance_doc_url,profile_screenshot_url,trip_screenshots,license_expiration",
      )
      .eq("id", data.applicationId)
      .maybeSingle();
    if (app) await syncApplicationUploads(supabaseAdmin, app);

    // Filtered in the query, not after it. Everything below Owner must not
    // receive the restricted row at all — not the id, not the storage path,
    // not a signed URL that a network tab would show. This query runs as the
    // service role, so RLS is not doing the work here; the RLS policy is the
    // second lock, for a browser that skips this function entirely.
    let q = supabaseAdmin.from("documents").select(SELECT).eq("driver_id", data.applicationId);
    if (!owner) q = q.not("category", "in", `(${RESTRICTED_CATEGORIES.join(",")})`);
    const { data: rows } = await q.order("created_at", { ascending: false });
    return withUrls(supabaseAdmin, rows ?? []);
  });

/**
 * The verification call recording, for the one tier allowed to hear it.
 *
 * Separate from adminListDriverDocuments on purpose: a caller who is not an
 * Owner cannot reach this at all, so there is no filtering to get wrong and no
 * payload for a restricted row to hide inside.
 */
export const ownerListVerificationRecordings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<VaultDocument[]> => {
    const { requireOwner } = await import("@/lib/roles.server");
    await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("documents")
      .select(SELECT)
      .eq("driver_id", data.applicationId)
      .eq("category", "verification_recording")
      .order("created_at", { ascending: false });
    return withUrls(supabaseAdmin, rows ?? []);
  });

export const createDocumentUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: z.string().uuid().optional(),
        category: CategoryEnum,
        fileName: z.string().min(1).max(200),
        mimeType: z.string().min(3).max(120),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = await isAdmin(context.supabase, context.userId);
    // A restricted category may only ever be written by an Owner, whichever
    // door the upload comes through.
    if (RESTRICTED_CATEGORIES.includes(data.category)) {
      const { requireOwner } = await import("@/lib/roles.server");
      await requireOwner(context.userId);
    }
    // "If you are staff at all, you must be a Manager." Deliberately not a
    // flat requireManager: the applicant branch below uploads against their
    // OWN application and holds no staff grant at all, and gating this on
    // the tier alone would lock a driver out of their own paperwork.
    {
      const { getActor, requireManager } = await import("@/lib/roles.server");
      if (await getActor(context.userId)) await requireManager(context.userId);
    }
    let applicationId = data.applicationId ?? null;
    let staff = admin;
    if (admin) {
      if (!applicationId) throw new Error("Missing driver");
    } else if (await isStaffUser(context.userId)) {
      // Coordinator or Manager uploading on an applicant's behalf.
      if (!applicationId) throw new Error("Missing driver");
      staff = true;
    } else {
      const { data: app } = await context.supabase
        .from("applications")
        .select("id")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!app) throw new Error("No application on file");
      applicationId = app.id as string;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Before anything is signed, so a refused Replace leaves no object behind.
    await refuseSignedAgreementReplace(supabaseAdmin, {
      applicationId: applicationId as string,
      category: data.category,
      staff,
    });
    const path = `${applicationId}/${data.category}-${crypto.randomUUID()}.${safeExt(data.fileName, data.mimeType)}`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from(DOC_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message || "Could not start upload");
    return { path: signed.path, token: signed.token, bucket: DOC_BUCKET, applicationId };
  });

/**
 * Refuse to act on a restricted document unless the caller is an Owner.
 *
 * Used by the functions that take a document id rather than a category — the
 * category has to be read back before the tier can be judged.
 */
async function assertMayTouch(userId: string, documentId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: doc } = await supabaseAdmin
    .from("documents")
    .select("category")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) throw new Error("Document not found");
  if (RESTRICTED_CATEGORIES.includes(doc.category as string)) {
    const { requireOwner } = await import("@/lib/roles.server");
    await requireOwner(userId);
  }
}

/** True when an agreements row names any of these documents as its evidence. */
async function namedByAgreement(admin: any, ids: string[], failure: string): Promise<boolean> {
  if (!ids.length) return false;
  for (const column of ["document_id", "completed_document_id"] as const) {
    const { data, error } = await admin.from("agreements").select("id").in(column, ids).limit(1);
    // Fail closed: a lookup that errored is not proof the rows are ordinary.
    if (error) throw new Error(failure);
    if ((data ?? []).length > 0) return true;
  }
  return false;
}

const REPLACE_CHECK_FAILED =
  "Could not confirm this upload would not replace a signed agreement. Nothing was uploaded.";

/**
 * Refuse an upload that would supersede signed-agreement evidence.
 *
 * Replace in the vault is "upload a new file in the same category":
 * persistConfirmedDocument marks every current row of that category
 * is_current=false, superseded_by=<new row>. On the Signed agreement card that
 * demoted the archived, signed PDF to "Replaced versions" and showed the new
 * upload as the signed agreement. Signed evidence is immutable; a wrong
 * agreement is voided and re-sent through eSign instead. Drivers never file
 * agreements at all — theirs come from eSign. Called before an upload URL is
 * signed and again before the row is written.
 * See docs/esign/SIGNED-AGREEMENT-IMMUTABILITY.md.
 */
async function refuseSignedAgreementReplace(
  admin: any,
  args: { applicationId: string; category: string; staff: boolean },
): Promise<void> {
  if (!args.staff && args.category === "agreement") {
    throw new Error(SIGNED_AGREEMENT_DRIVER_UPLOAD_REFUSED);
  }
  const { data: rows, error } = await admin
    .from("documents")
    .select("id,kind,category,storage_bucket,storage_path")
    .eq("driver_id", args.applicationId)
    .eq("category", args.category)
    .eq("is_current", true);
  if (error) throw new Error(REPLACE_CHECK_FAILED);
  const current = (rows ?? []) as Array<{ id: string } & Parameters<typeof isSignedAgreementEvidence>[0]>;
  if (current.some((r) => isSignedAgreementEvidence(r))) {
    throw new Error(SIGNED_AGREEMENT_REPLACE_REFUSED);
  }
  if (await namedByAgreement(admin, current.map((r) => r.id), REPLACE_CHECK_FAILED)) {
    throw new Error(SIGNED_AGREEMENT_REPLACE_REFUSED);
  }
}

type UploadHasher = (admin: any, bucket: string, path: string) => Promise<string | null>;

/**
 * Insert the documents row, then hash. The hasher returns null when
 * DOCUMENT_CONTENT_SHA256_ENABLED is off, and when the packet function is
 * not installed yet. A returned hex is written to content_sha256. A thrown
 * hasher marks this new row not current and is rethrown. The previous
 * current row stays current. The new row is not deleted. Supersede runs
 * only after the hasher returns.
 */
export async function persistConfirmedDocument(
  admin: any,
  fields: {
    driver_id: string;
    kind: string;
    category: string;
    label: string | null;
    storage_bucket: string;
    storage_path: string;
    visibility: string[];
    file_name: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    expires_at: string | null;
    uploaded_by: string | null;
    uploaded_by_role: string;
  },
  hash: UploadHasher = recordUploadedContentSha,
): Promise<{ id: string }> {
  const { data: row, error } = await admin
    .from("documents")
    .insert({ ...fields, is_current: true })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  let contentSha: string | null = null;
  try {
    contentSha = await hash(admin, fields.storage_bucket, fields.storage_path);
  } catch (hashError) {
    const demoted = await admin.from("documents").update({ is_current: false }).eq("id", row.id);
    if (demoted?.error) {
      console.error(
        "[documents] could not mark the unhashed upload not current",
        demoted.error.message ?? demoted.error,
      );
    }
    throw hashError;
  }
  if (contentSha) {
    const stamped = await admin.from("documents").update({ content_sha256: contentSha }).eq("id", row.id);
    if (stamped?.error) {
      const demoted = await admin.from("documents").update({ is_current: false }).eq("id", row.id);
      if (demoted?.error) {
        console.error(
          "[documents] could not mark the unhashed upload not current",
          demoted.error.message ?? demoted.error,
        );
      }
      throw new Error(stamped.error.message || "Could not record the content hash");
    }
  }
  await admin
    .from("documents")
    .update({ is_current: false, superseded_by: row.id })
    .eq("driver_id", fields.driver_id)
    .eq("category", fields.category)
    .eq("is_current", true)
    .neq("id", row.id);
  return { id: row.id as string };
}

/** True for Coordinator and above. */
async function isStaffUser(userId: string): Promise<boolean> {
  try {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(userId);
    return true;
  } catch {
    return false;
  }
}

export const confirmDocumentUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: z.string().uuid(),
        category: CategoryEnum,
        path: z.string().min(3).max(400),
        fileName: z.string().max(200).optional(),
        mimeType: z.string().max(120).optional(),
        sizeBytes: z.number().int().nonnegative().optional(),
        expiresAt: z.string().max(20).optional().nullable(),
        label: z.string().max(140).optional().nullable(),
        internal: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = await isAdmin(context.supabase, context.userId);
    const restricted = RESTRICTED_CATEGORIES.includes(data.category);
    if (restricted) {
      const { requireOwner } = await import("@/lib/roles.server");
      await requireOwner(context.userId);
    }
    // Same shape as the upload-url call above: staff must be a Manager, and
    // a driver confirming their own upload is left to the ownership check
    // further down.
    {
      const { getActor, requireManager } = await import("@/lib/roles.server");
      if (await getActor(context.userId)) await requireManager(context.userId);
    }
    const staff = admin || (await isStaffUser(context.userId));
    if (!staff) {
      const { data: app } = await context.supabase
        .from("applications")
        .select("id")
        .eq("id", data.applicationId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!app) throw new Error("Forbidden");
    }
    if (!data.path.startsWith(`${data.applicationId}/`)) throw new Error("Invalid upload path");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Again here: the confirm is what supersedes, and it can be called alone.
    await refuseSignedAgreementReplace(supabaseAdmin, {
      applicationId: data.applicationId,
      category: data.category,
      staff,
    });
    // A recording is never shared with the applicant, whatever the caller
    // asked for.
    const visibility = restricted || (staff && data.internal) ? ["admin"] : ["driver", "admin"];
    const saved = await persistConfirmedDocument(supabaseAdmin, {
      driver_id: data.applicationId,
      kind: data.category,
      category: data.category,
      label: data.label ?? null,
      storage_bucket: DOC_BUCKET,
      storage_path: data.path,
      visibility,
      file_name: data.fileName ?? null,
      mime_type: data.mimeType ?? null,
      size_bytes: data.sizeBytes ?? null,
      expires_at: data.expiresAt || null,
      uploaded_by: context.userId,
      uploaded_by_role: admin ? "team" : "driver",
    });
    return { ok: true, id: saved.id };
  });

export const updateDocumentMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        // Named documentId, like every other document function. It was `id`
        // here and `documentId` next door, which is the kind of difference
        // that typechecks fine and throws at runtime.
        documentId: z.string().uuid(),
        expiresAt: z.string().max(20).nullable().optional(),
        label: z.string().max(140).nullable().optional(),
        internal: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Retitling a document, changing its expiry or flipping it to
    // internal-only all change what the driver is shown and what readiness
    // counts. Manager and above.
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    await assertMayTouch(context.userId, data.documentId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, any> = {};
    if (data.expiresAt !== undefined) patch.expires_at = data.expiresAt || null;
    if (data.label !== undefined) patch.label = data.label;
    if (data.internal !== undefined)
      patch.visibility = data.internal ? ["admin"] : ["driver", "admin"];
    const { error } = await supabaseAdmin
      .from("documents")
      .update(patch as any)
      .eq("id", data.documentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ documentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.supabase, context.userId))) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: doc, error: readError } = await supabaseAdmin
      .from("documents")
      .select("id,kind,category,storage_bucket,storage_path")
      .eq("id", data.documentId)
      .maybeSingle();
    // Fail closed: a read that errored is not proof the document is ordinary.
    if (readError) throw new Error(readError.message);
    if (!doc) return { ok: true };

    // Signed-agreement evidence is refused before storage is touched, so a
    // refusal removes nothing. The storage object went first here, which is
    // why the row-shape check and the agreements lookup both come before it.
    if (isSignedAgreementEvidence(doc)) throw new Error(SIGNED_AGREEMENT_DELETE_REFUSED);
    // Any document an agreement names as its evidence, whatever bucket or
    // category it was filed under. Two equality filters, not an interpolated
    // .or(). agreements.document_id is ON DELETE SET NULL, so deleting the row
    // would also have silently detached the agreement from its archive.
    for (const column of ["document_id", "completed_document_id"] as const) {
      const { data: refs, error: refError } = await supabaseAdmin
        .from("agreements")
        .select("id")
        .eq(column, data.documentId)
        .limit(1);
      if (refError) {
        throw new Error(
          "Could not confirm this document is not a signed agreement. Nothing was deleted.",
        );
      }
      if ((refs ?? []).length > 0) throw new Error(SIGNED_AGREEMENT_DELETE_REFUSED);
    }

    await supabaseAdmin.storage
      .from(doc.storage_bucket as string)
      .remove([doc.storage_path as string]);
    await supabaseAdmin.from("documents").delete().eq("id", data.documentId);
    return { ok: true };
  });

// ------------------------------------------------------------------ driver

export const getMyVault = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({ context }): Promise<{ applicationId: string | null; documents: VaultDocument[] }> => {
      const { data: app } = await context.supabase
        .from("applications")
        .select(
          "id,user_id,license_photo_url,insurance_doc_url,profile_screenshot_url,trip_screenshots,license_expiration",
        )
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!app) return { applicationId: null, documents: [] };

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // Same backfill as the admin vault, so a renter sees the licence and
      // insurance they uploaded while applying — and can replace them.
      await syncApplicationUploads(supabaseAdmin, app);

      const { data: rows } = await context.supabase
        .from("documents")
        .select(SELECT)
        .eq("driver_id", app.id)
        .order("created_at", { ascending: false });

      const visible = (rows ?? []).filter((d: any) => (d.visibility ?? []).includes("driver"));
      return { applicationId: app.id as string, documents: await withUrls(supabaseAdmin, visible) };
    },
  );

/**
 * Record a staff decision about a document.
 *
 * Coordinator and above. Checking that a licence photo is the right document,
 * readable and unexpired is operational work, not an approval decision — a
 * Coordinator doing it cannot and does not approve the applicant, which stays
 * an Owner/Manager action elsewhere.
 *
 * Audited, because "who said this licence was fine?" is exactly the question
 * that gets asked after something goes wrong, and the row alone only shows the
 * current answer. The vehicle document equivalents have always logged; driver
 * documents did not.
 */
export const setDocumentReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        documentId: z.string().uuid(),
        status: z.enum(["uploaded", "verified", "rejected"]),
        note: z.string().trim().max(500).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Verifying or rejecting an identity document is an authorization
    // decision about a person, not a clerical one. Manager and above.
    const { requireManager } = await import("@/lib/roles.server");
    const { logAudit } = await import("@/lib/audit.server");
    const actor = await requireManager(context.userId);
    await assertMayTouch(context.userId, data.documentId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: doc } = await supabaseAdmin
      .from("documents")
      .select("id,driver_id,kind,category,label,review_status,is_current,storage_bucket,storage_path,content_sha256")
      .eq("id", data.documentId)
      .maybeSingle();
    if (!doc) throw new Error("Document not found");

    // Needs New asks for a replacement, and a signed agreement is never
    // replaced: it is voided and re-sent through eSign. Verifying, and
    // clearing a decision already on the row, stay allowed.
    if (
      data.status === "rejected" &&
      (isSignedAgreementEvidence(doc) ||
        (await namedByAgreement(
          supabaseAdmin,
          [doc.id as string],
          "Could not confirm this document is not a signed agreement. Nothing was changed.",
        )))
    ) {
      throw new Error(SIGNED_AGREEMENT_NEEDS_NEW_REFUSED);
    }

    // A signed paper agreement verified here counts as the signed agreement
    // for rental activation (activation-readiness.ts isAuditedPaperAgreement,
    // re-checked in activate_rental_checked_tx). So this verification must
    // leave a complete, mandatory audit trail BEFORE the document changes:
    // verifier, time, document id, storage path, content SHA-256 and version
    // when known. If that audit row cannot be written, nothing is verified.
    // Activation trusts the audit row, not review_status alone.
    if (doc.category === "agreement" && data.status === "verified") {
      if (!doc.is_current) throw new Error("Only the current agreement document can be verified.");
      if (!doc.storage_bucket || !doc.storage_path)
        throw new Error("Upload the signed agreement file before verifying it.");
      const reviewedAt = new Date().toISOString();
      const { error: auditErr } = await supabaseAdmin.from("audit_log").insert({
        actor_user_id: actor.userId,
        actor_email: actor.email ?? null,
        actor_role: actor.role,
        action: "document.verified",
        entity_type: "application",
        entity_id: doc.driver_id,
        summary: `Verified signed agreement ${doc.label ?? doc.id}`,
        metadata: {
          documentId: doc.id,
          category: doc.category,
          from: doc.review_status,
          to: "verified",
          note: data.note ?? null,
          paper_agreement: true,
          verifier_user_id: actor.userId,
          verifier_role: actor.role,
          verifier_tier: actor.tier,
          reviewed_at: reviewedAt,
          reviewed_at_ms: Date.parse(reviewedAt),
          storage_bucket: doc.storage_bucket,
          storage_path: doc.storage_path,
          content_sha256: doc.content_sha256 ?? null,
          document_label: doc.label ?? null,
          // Vault documents carry no agreement version; recorded as unknown.
          agreement_version: null,
        },
      });
      if (auditErr) throw new Error("Could not record the verification. The agreement was not verified.");
      const { error: upErr } = await supabaseAdmin
        .from("documents")
        .update({ review_status: "verified", review_note: data.note ?? null, reviewed_at: reviewedAt, reviewed_by: context.userId })
        .eq("id", data.documentId);
      // The audit row names this exact reviewed_at; without the matching
      // document update it never counts as a signed agreement.
      if (upErr) throw new Error(upErr.message);
      return { ok: true as const };
    }

    const clearing = data.status === "uploaded";
    const { error } = await supabaseAdmin
      .from("documents")
      .update({
        review_status: data.status,
        // A note only belongs to a decision. Clearing the decision clears it.
        review_note: clearing ? null : (data.note ?? null),
        reviewed_at: clearing ? null : new Date().toISOString(),
        reviewed_by: clearing ? null : context.userId,
      })
      .eq("id", data.documentId);
    if (error) throw new Error(error.message);

    await logAudit(actor, {
      action: `document.${data.status === "uploaded" ? "review_cleared" : data.status}`,
      summary: `${
        data.status === "verified"
          ? "Verified"
          : data.status === "rejected"
            ? "Asked for a replacement of"
            : "Cleared the review on"
      } ${doc.label ?? doc.category}`,
      entityType: "application",
      entityId: doc.driver_id,
      metadata: {
        documentId: doc.id,
        category: doc.category,
        from: doc.review_status,
        to: data.status,
        note: clearing ? null : (data.note ?? null),
      },
    });

    return { ok: true as const };
  });
