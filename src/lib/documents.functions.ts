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
] as const;

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
};

const CategoryEnum = z.enum(["license_front", "license_back", "insurance", "gig_profile", "agreement", "other"]);

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
      };
    }),
  );
}

const SELECT =
  "id,category,label,file_name,mime_type,size_bytes,expires_at,is_current,visibility,uploaded_by_role,created_at,storage_bucket,storage_path";

// ------------------------------------------------------------------- admin

export const adminListDriverDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<VaultDocument[]> => {
    if (!(await isAdmin(context.supabase, context.userId))) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("documents")
      .select(SELECT)
      .eq("driver_id", data.applicationId)
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
    let applicationId = data.applicationId ?? null;
    if (admin) {
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
    if (!admin) {
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
    const visibility = admin && data.internal ? ["admin"] : ["driver", "admin"];

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
        id: z.string().uuid(),
        expiresAt: z.string().max(20).nullable().optional(),
        label: z.string().max(140).nullable().optional(),
        internal: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.supabase, context.userId))) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {};
    if (data.expiresAt !== undefined) patch.expires_at = data.expiresAt || null;
    if (data.label !== undefined) patch.label = data.label;
    if (data.internal !== undefined) patch.visibility = data.internal ? ["admin"] : ["driver", "admin"];
    const { error } = await supabaseAdmin.from("documents").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.supabase, context.userId))) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: doc } = await supabaseAdmin
      .from("documents")
      .select("id,storage_bucket,storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (doc) {
      await supabaseAdmin.storage.from(doc.storage_bucket as string).remove([doc.storage_path as string]);
      await supabaseAdmin.from("documents").delete().eq("id", data.id);
    }
    return { ok: true };
  });

// ------------------------------------------------------------------ driver

export const getMyVault = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ applicationId: string | null; documents: VaultDocument[] }> => {
    const { data: app } = await context.supabase
      .from("applications")
      .select("id")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!app) return { applicationId: null, documents: [] };

    const { data: rows } = await context.supabase
      .from("documents")
      .select(SELECT)
      .eq("driver_id", app.id)
      .order("created_at", { ascending: false });

    const visible = (rows ?? []).filter((d: any) => (d.visibility ?? []).includes("driver"));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return { applicationId: app.id as string, documents: await withUrls(supabaseAdmin, visible) };
  });
