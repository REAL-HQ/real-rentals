// Flag-on archive. archiveDocument calls this only when
// ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED is true. The storage object and the
// documents row are written before the agreement row receives sha256 and
// document_id.
import { logAudit } from "@/lib/audit.server";
import type { Actor } from "@/lib/roles.server";
import { renderCompletedPdf, sha256Hex } from "@/lib/esign-pdf.server";

export async function archiveImmutableV1(admin: any, ag: any, actor: Actor | null): Promise<boolean> {
  const wasFailed = ag.archive_status === "failed";
  try {
    const bodySha = await sha256Hex(ag.body as string);
    const pdf = await renderCompletedPdf({
      id: ag.id,
      title: ag.title,
      body: ag.body,
      bodySha256: bodySha,
      signerName: ag.signer_name,
      signerEmail: ag.signer_email,
      signedAt: ag.signed_at,
      createdAt: ag.created_at,
      sentAt: ag.sent_at,
      viewedAt: ag.viewed_at,
      ip: ag.signer_ip,
      userAgent: ag.signer_user_agent,
      authMethod: ag.auth_method ?? "email_link",
      companySignerName: ag.company_signer_name || "REAL RENTALS",
      companySignerTitle: ag.company_signer_title ?? null,
      adoption: (ag.metadata as any)?.signature?.adoption ?? null,
      adoptionSha256: (ag.metadata as any)?.signature?.sha256 ?? null,
    });
    const fileSha = await sha256Hex(pdf);
    const documentId = crypto.randomUUID();
    const path = `immutable-v1/${documentId}/${fileSha}.pdf`;
    const up = await admin.storage.from("rental-agreements").upload(path, new Blob([pdf as BlobPart], { type: "application/pdf" }), {
      contentType: "application/pdf",
      upsert: false,
      metadata: { sha256: fileSha },
    });
    if (up.error) throw new Error(`upload: ${up.error.message}`);

    const { data: doc, error: docErr } = await admin
      .from("documents")
      .insert({
        id: documentId,
        content_sha256: fileSha,
        driver_id: ag.application_id,
        kind: "rental_agreement",
        category: "agreement",
        label: ag.source === "rental" ? "Signed rental agreement" : ag.title,
        storage_bucket: "rental-agreements",
        storage_path: path,
        visibility: ["driver", "admin"],
        file_name: `signed-agreement-${String(ag.id).slice(0, 8)}.pdf`,
        mime_type: "application/pdf",
        uploaded_by_role: "system",
      })
      .select("id")
      .single();
    if (docErr || !doc) throw new Error(`documents: ${docErr?.message ?? "no row"}`);

    const { error: finErr } = await admin
      .from("agreements")
      .update({
        archive_status: "archived",
        archive_error: null,
        archive_attempts: (ag.archive_attempts ?? 0) + 1,
        archive_last_attempt_at: new Date().toISOString(),
        document_id: documentId,
        completed_document_id: documentId,
        sha256: fileSha,
        body_sha256: bodySha,
      })
      .eq("id", ag.id);
    if (finErr) throw new Error(`finalize: ${finErr.message}`);
    if (wasFailed)
      await logAudit(actor, { action: "document.archive_recovered", summary: "Signed document archived after retry", entityType: "esign_document", entityId: ag.id });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[esign] archive failed", ag.id, msg);
    await admin
      .from("agreements")
      .update({ archive_status: "failed", archive_error: msg.slice(0, 500), archive_attempts: (ag.archive_attempts ?? 0) + 1, archive_last_attempt_at: new Date().toISOString() })
      .eq("id", ag.id);
    await logAudit(actor, { action: "document.archive_failed", summary: "Signed document could not be archived", entityType: "esign_document", entityId: ag.id, metadata: { error: msg.slice(0, 200) } });
    return false;
  }
}
