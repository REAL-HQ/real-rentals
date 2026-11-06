import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertPortalDocumentUpdateEnabled,
  documentsNeedingUpdate,
  easternCalendarDate,
  type ApplicationDocumentFacts,
  type DocumentOnFile,
  type PortalDocumentUpdateItem,
} from "@/lib/portal-document-update";

function previewInput(d: unknown): { previewDriverId?: string } {
  const id = (d as { previewDriverId?: unknown } | null)?.previewDriverId;
  if (id == null || id === "") return {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid driver");
  return { previewDriverId: id };
}

/**
 * Documents the signed-in driver should update.
 *
 * Read only. The flag is checked before any role lookup or query. Uploading
 * stays on createDocumentUploadUrl / confirmDocumentUpload, which are shared
 * with the documents vault and stay available when this card is off.
 */
export const getPortalDocumentUpdates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(previewInput)
  .handler(async ({ context, data }): Promise<PortalDocumentUpdateItem[]> => {
    assertPortalDocumentUpdateEnabled();
    const { portalScope } = await import("@/lib/driver-preview.server");
    const { supabase, userId } = await portalScope(context, data, "documents");

    const { data: app, error: appError } = await supabase
      .from("applications")
      .select("id,license_photo_url,insurance_doc_url,license_expiration,insurance_expires_on")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (appError) throw new Error("Could not load your documents.");
    if (!app) return [];

    const { data: rows, error: docError } = await supabase
      .from("documents")
      .select("category,expires_at,is_current,storage_path,created_at,visibility")
      .eq("driver_id", app.id)
      .eq("is_current", true)
      .in("category", ["license_front", "license_back", "insurance"]);
    if (docError) throw new Error("Could not load your documents.");

    const documents: DocumentOnFile[] = (rows ?? []).map((row) => ({
      category: String(row.category ?? ""),
      expiresAt: (row.expires_at as string | null) ?? null,
      isCurrent: row.is_current !== false,
      storagePath: (row.storage_path as string | null) ?? null,
      createdAt: (row.created_at as string | null) ?? null,
      visibleToDriver: Array.isArray(row.visibility) && row.visibility.includes("driver"),
    }));

    const application: ApplicationDocumentFacts = {
      licensePhotoPath: (app.license_photo_url as string | null) ?? null,
      licenseExpiration: (app.license_expiration as string | null) ?? null,
      insuranceDocPath: (app.insurance_doc_url as string | null) ?? null,
      insuranceExpiresOn: (app.insurance_expires_on as string | null) ?? null,
    };

    return documentsNeedingUpdate(documents, application, easternCalendarDate(new Date()));
  });
