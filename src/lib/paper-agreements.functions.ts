import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { LIVE_RENTAL_RELEASE } from "@/lib/live-rental-release";
import {
  PAPER_BUCKET, PAPER_MAX_BYTES, PAPER_TYPES, checkPaperPdf, decodePaperMeta, encodePaperMeta, resolvePaperMeta, type PaperMeta,
  paperStoragePath, safeFileName, sha256Hex, validSignedOn,
} from "@/lib/paper-agreements";

export const PAPER_UPLOAD_HOLD = "Paper upload is ready but awaits separate activation approval.";

// Read only: no registration/backfill, signing, URL generation or mutation.
export const listPaperAgreementOriginals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ applicationId: z.string().uuid() }).strict().parse(data))
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.from("documents")
      .select("id,file_name,label,created_at,content_sha256,is_current,source,size_bytes,notes,review_status,uploaded_by_role")
      .eq("driver_id", data.applicationId).eq("category", "agreement")
      .eq("storage_bucket", PAPER_BUCKET).eq("source", "paper")
      .order("created_at", { ascending: false });
    if (error) throw new Error("Could not load paper agreements.");
    const ids = (rows ?? []).map((r) => r.id as string);
    const audit = new Map<string, PaperMeta>();
    if (ids.length) {
      const { data: logs } = await supabaseAdmin.from("audit_log").select("entity_id,metadata")
        .eq("action", "paper_agreement.uploaded").eq("entity_type", "document").in("entity_id", ids);
      for (const l of logs ?? []) {
        const m = l.metadata as { signed_on?: string | null; type?: string } | null;
        if (m && PAPER_TYPES.includes(m.type as never)) audit.set(l.entity_id as string, { signed_on: m.signed_on ?? null, type: m.type as PaperMeta["type"] });
      }
    }
    return (rows ?? []).map(({ notes, ...r }) => {
      const { meta, mismatch } = resolvePaperMeta(audit.get(r.id as string) ?? null, decodePaperMeta(notes));
      return { ...r, signed_on: meta?.signed_on ?? null, agreement_type: meta?.type ?? null, metadata_mismatch: mismatch };
    });
  });

/**
 * Upload one wet-signed PDF original. Bytes travel through our server (browsers
 * filter the storage host), so validation and SHA-256 run on the exact stored
 * bytes. Never touches agreements, rentals, statuses or messages.
 */
export const uploadPaperAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({
    applicationId: z.string().uuid(),
    fileName: z.string().min(1).max(255),
    base64: z.string().min(1).max(Math.ceil(PAPER_MAX_BYTES / 3) * 4 + 8),
    signedOn: z.string().nullable(),
    agreementType: z.enum(PAPER_TYPES),
  }).strict().parse(data))
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId); // Owner/Manager only; Coordinators/Drivers refused
    if (!LIVE_RENTAL_RELEASE.paperAgreements) throw new Error(PAPER_UPLOAD_HOLD);
    return storePaperAgreement(actor, data);
  });

type UploadInput = { applicationId: string; fileName: string; base64: string; signedOn: string | null; agreementType: PaperMeta["type"] };

export async function storePaperAgreement(actor: { userId: string; role: string; email: string | null; tier: string }, data: UploadInput) {
  const today = new Date().toISOString().slice(0, 10);
  if (!validSignedOn(data.signedOn, today)) throw new Error("Signed date is invalid.");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0)); }
  catch { throw new Error("The file could not be read."); }
  const check = checkPaperPdf(bytes);
  if (!check.ok) throw new Error(check.reason);
  const sha = await sha256Hex(bytes);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: app } = await supabaseAdmin.from("applications")
    .select("id,deleted_at").eq("id", data.applicationId).maybeSingle();
  if (!app || (app as { deleted_at?: string | null }).deleted_at) throw new Error("Driver not found.");

  const { data: dup } = await supabaseAdmin.from("documents").select("id")
    .eq("driver_id", data.applicationId).eq("storage_bucket", PAPER_BUCKET)
    .eq("content_sha256", sha).limit(1);
  if (dup?.length) throw new Error("This exact file is already on file.");

  const id = crypto.randomUUID();
  const path = paperStoragePath(data.applicationId, id);
  const { error: upErr } = await supabaseAdmin.storage.from(PAPER_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (upErr) throw new Error("Upload failed. Nothing was saved.");

  // Re-read and verify the stored bytes before registering them.
  const { data: stored } = await supabaseAdmin.storage.from(PAPER_BUCKET).download(path);
  const storedSha = stored ? await sha256Hex(new Uint8Array(await stored.arrayBuffer())) : null;
  if (storedSha !== sha) {
    await supabaseAdmin.storage.from(PAPER_BUCKET).remove([path]);
    throw new Error("Upload could not be verified. Nothing was saved.");
  }

  const fileName = safeFileName(data.fileName);
  const { error: insErr } = await supabaseAdmin.from("documents").insert({
    id, driver_id: data.applicationId, kind: "agreement", category: "agreement",
    storage_bucket: PAPER_BUCKET, storage_path: path, visibility: ["admin"],
    label: fileName, file_name: fileName, mime_type: "application/pdf", size_bytes: bytes.length,
    content_sha256: sha, source: "paper", evidence_class: "operational", review_status: "uploaded",
    is_current: true, uploaded_by: actor.userId, uploaded_by_role: actor.role,
    notes: encodePaperMeta({ signed_on: data.signedOn, type: data.agreementType }),
  });
  if (insErr) {
    await supabaseAdmin.storage.from(PAPER_BUCKET).remove([path]);
    throw new Error("Upload could not be recorded. Nothing was saved.");
  }

  const { logAudit } = await import("@/lib/audit.server");
  await logAudit(actor as never, {
    action: "paper_agreement.uploaded", entityType: "document", entityId: id,
    summary: `Uploaded paper agreement ${fileName}`,
    metadata: { application_id: data.applicationId, sha256: sha, size_bytes: bytes.length, signed_on: data.signedOn, type: data.agreementType },
  });
  return { id, sha256: sha };
}

/** PDF bytes for staff; never a storage URL or path. */
export const getPaperAgreementPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ documentId: z.string().uuid() }).strict().parse(data))
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: doc } = await supabaseAdmin.from("documents")
      .select("storage_path,file_name,content_sha256").eq("id", data.documentId)
      .eq("storage_bucket", PAPER_BUCKET).eq("source", "paper").maybeSingle();
    if (!doc) throw new Error("Agreement not found.");
    const { data: file } = await supabaseAdmin.storage.from(PAPER_BUCKET).download(doc.storage_path as string);
    if (!file) throw new Error("The PDF could not be loaded.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (doc.content_sha256 && (await sha256Hex(bytes)) !== doc.content_sha256)
      throw new Error("Integrity check failed for this PDF.");
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { base64: btoa(bin), contentType: "application/pdf" as const, fileName: (doc.file_name as string) ?? "agreement.pdf" };
  });
