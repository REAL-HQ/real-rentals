import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const DOC_BUCKET = "driver-docs";

export const DOC_CATEGORIES = [
  { key: "license_front", label: "Driver's license (front)", expiring: true },
  { key: "license_back", label: "Driver's license (back)", expiring: true },
  { key: "insurance", label: "Insurance card", expiring: true },
  { key: "gig_profile", label: "Gig profile screenshot", expiring: false },
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
};

export type DocumentReviewStatus = "uploaded" | "verified" | "rejected";

const CategoryEnum = z.enum([
  "license_front",
  "license_back",
  "insurance",
  "gig_profile",
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
      };
    }),
  );
}

const SELECT =
  "id,category,label,file_name,mime_type,size_bytes,expires_at,is_current,visibility,uploaded_by_role,created_at,storage_bucket,storage_path,review_status,review_note,reviewed_at";

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
    .select("id,storage_bucket")
    .eq("storage_path", args.path)
    .maybeSingle();
  if (seen) {
    // Heal a row recorded against the wrong bucket. Rows written before the
    // per-column bucket map above point gig screenshots at "license-uploads",
    // where the object does not exist, so signing them returns nothing.
    if (seen.storage_bucket !== args.bucket) {
      await admin.from("documents").update({ storage_bucket: args.bucket }).eq("id", seen.id);
    }
    return { id: seen.id as string };
  }

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
    })
    .select("id")
    .single();
  if (error) {
    console.error("[documents] register failed", error.message);
    return null;
  }

  await admin
    .from("documents")
    .update({ is_current: false, superseded_by: row.id })
    .eq("driver_id", args.applicationId)
    .eq("category", args.category)
    .eq("is_current", true)
    .neq("id", row.id);

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
    const res = await registerDocument(admin, {
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
    });
    if (res) registered++;
  }

  // Gig trip screenshots arrive as an array of paths.
  const shots = Array.isArray(application.trip_screenshots) ? application.trip_screenshots : [];
  for (const path of shots) {
    if (!path || typeof path !== "string" || path.startsWith("http")) continue;
    const res = await registerDocument(admin, {
      applicationId: application.id as string,
      category: "gig_profile",
      bucket: TRIP_SCREENSHOT_BUCKET,
      path,
      fileName: path.split("/").pop() ?? null,
      label: "Trip screenshot (from application)",
      uploadedBy: (application.user_id as string) ?? null,
      uploadedByRole: "driver",
    });
    if (res) registered++;
  }

  return registered;
}

// ------------------------------------------------------------------- admin

export const adminListDriverDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<VaultDocument[]> => {
    // Coordinator and above. Checking an applicant's licence is operational
    // screening work, not an approval decision — this used to be Owner-only,
    // which meant a Coordinator could not do the job they are here to do.
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
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
    let applicationId = data.applicationId ?? null;
    if (admin) {
      if (!applicationId) throw new Error("Missing driver");
    } else if (await isStaffUser(context.userId)) {
      // Coordinator or Manager uploading on an applicant's behalf.
      if (!applicationId) throw new Error("Missing driver");
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
    // A recording is never shared with the applicant, whatever the caller
    // asked for.
    const visibility = restricted || (staff && data.internal) ? ["admin"] : ["driver", "admin"];

    const { data: row, error } = await supabaseAdmin
      .from("documents")
      .insert({
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
        is_current: true,
        uploaded_by: context.userId,
        uploaded_by_role: admin ? "team" : "driver",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Supersede the previous current document in the same category.
    await supabaseAdmin
      .from("documents")
      .update({ is_current: false, superseded_by: row.id })
      .eq("driver_id", data.applicationId)
      .eq("category", data.category)
      .eq("is_current", true)
      .neq("id", row.id);

    return { ok: true, id: row.id as string };
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
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
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
    const { data: doc } = await supabaseAdmin
      .from("documents")
      .select("id,storage_bucket,storage_path")
      .eq("id", data.documentId)
      .maybeSingle();
    if (doc) {
      await supabaseAdmin.storage
        .from(doc.storage_bucket as string)
        .remove([doc.storage_path as string]);
      await supabaseAdmin.from("documents").delete().eq("id", data.documentId);
    }
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
    const { requireStaff } = await import("@/lib/roles.server");
    const { logAudit } = await import("@/lib/audit.server");
    const actor = await requireStaff(context.userId);
    await assertMayTouch(context.userId, data.documentId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: doc } = await supabaseAdmin
      .from("documents")
      .select("id,driver_id,category,label,review_status")
      .eq("id", data.documentId)
      .maybeSingle();
    if (!doc) throw new Error("Document not found");

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
