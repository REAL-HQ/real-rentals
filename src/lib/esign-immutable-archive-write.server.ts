// Flag-on archive. archiveDocument calls this only when
// ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED is true, and only after
// SIGNED_ARCHIVE_V1_ENABLED. When both flags are on, completed-v1 runs
// and this writer does not.
//
// The PDF is uploaded once. supabase-js stores the upload `metadata`
// option on storage.objects.user_metadata (storage migration 0025), which
// is the column approval reads. The metadata column stays system data.
// The documents row is hidden from the driver until the agreement update
// commits. A failed attempt deletes the row and object it created.
import { logAudit } from "@/lib/audit.server";
import type { Actor } from "@/lib/roles.server";
import { renderCompletedPdf, sha256Hex } from "@/lib/esign-pdf.server";

const BUCKET = "rental-agreements";

/** Same agreement and PDF bytes always name the same documents.id. */
export async function immutableArchiveDocumentId(agreementId: string, fileSha: string): Promise<string> {
  const identity = await sha256Hex(`immutable-v1:${agreementId}:${fileSha}`);
  return `${identity.slice(0, 8)}-${identity.slice(8, 12)}-5${identity.slice(13, 16)}-a${identity.slice(17, 20)}-${identity.slice(20, 32)}`;
}

function alreadyStored(error: { message?: string; statusCode?: string | number } | null): boolean {
  if (!error) return false;
  return String(error.statusCode ?? "") === "409" || /already exists/i.test(error.message ?? "");
}

async function revealToDriver(admin: any, documentId: string): Promise<void> {
  const revealed = await admin.from("documents").update({ visibility: ["driver", "admin"] }).eq("id", documentId);
  if (revealed?.error) throw new Error(`reveal: ${revealed.error.message}`);
}

export async function archiveImmutableV1(admin: any, ag: any, actor: Actor | null): Promise<boolean> {
  const wasFailed = ag.archive_status === "failed";
  const alreadyArchived = ag.archive_status === "archived";
  let documentId = "";
  let fileSha = "";
  let path = "";
  let uploadedThisAttempt = false;
  let createdDocument = false;
  let finalized = false;

  try {
    if (ag.archive_status === "archived") {
      if (!ag.document_id || !ag.sha256) throw new Error("archived agreement is missing evidence");
      documentId = ag.document_id;
      fileSha = ag.sha256;
      const doc = await admin
        .from("documents")
        .select("id,content_sha256")
        .eq("id", documentId)
        .maybeSingle();
      if (doc.error || !doc.data || doc.data.content_sha256 !== fileSha) throw new Error("archived agreement evidence mismatch");
      await revealToDriver(admin, documentId);
      return true;
    }

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
    fileSha = await sha256Hex(pdf);
    const derivedId = await immutableArchiveDocumentId(ag.id, fileSha);
    documentId = ag.document_id || derivedId;
    path = `immutable-v1/${documentId}/${fileSha}.pdf`;

    const existing = await admin
      .from("documents")
      .select("id,driver_id,storage_bucket,storage_path,content_sha256")
      .eq("storage_bucket", BUCKET)
      .eq("storage_path", path)
      .maybeSingle();
    if (existing.error) throw new Error(`documents: ${existing.error.message}`);
    if (existing.data) {
      const row = existing.data;
      if (row.id !== documentId || row.driver_id !== ag.application_id || row.storage_path !== path || row.content_sha256 !== fileSha) {
        throw new Error("documents: existing row does not match this archive");
      }
    }

    const bucket = admin.storage.from(BUCKET);
    const up = await bucket.upload(path, new Blob([pdf as BlobPart], { type: "application/pdf" }), {
      contentType: "application/pdf",
      upsert: false,
      metadata: { sha256: fileSha },
    });
    if (up.error) {
      if (!alreadyStored(up.error)) throw new Error(`upload: ${up.error.message}`);
      const stored = await bucket.download(path);
      if (stored.error || !stored.data) throw new Error("upload: existing object is unreadable");
      const storedSha = await sha256Hex(new Uint8Array(await stored.data.arrayBuffer()));
      if (storedSha !== fileSha) throw new Error("upload: existing object hash mismatch");
    } else {
      uploadedThisAttempt = true;
    }

    if (!existing.data) {
      const { data: doc, error: docErr } = await admin
        .from("documents")
        .insert({
          id: documentId,
          content_sha256: fileSha,
          driver_id: ag.application_id,
          kind: "rental_agreement",
          category: "agreement",
          label: ag.source === "rental" ? "Signed rental agreement" : ag.title,
          storage_bucket: BUCKET,
          storage_path: path,
          visibility: ["admin"],
          file_name: `signed-agreement-${String(ag.id).slice(0, 8)}.pdf`,
          mime_type: "application/pdf",
          uploaded_by_role: "system",
        })
        .select("id")
        .single();
      if (docErr || !doc) {
        const duplicate = docErr?.code === "23505" || /duplicate|already exists/i.test(docErr?.message ?? "");
        if (!duplicate) throw new Error(`documents: ${docErr?.message ?? "no row"}`);
        const again = await admin
          .from("documents")
          .select("id,driver_id,storage_bucket,storage_path,content_sha256")
          .eq("id", documentId)
          .maybeSingle();
        const row = again.data;
        if (again.error || !row || row.driver_id !== ag.application_id || row.storage_bucket !== BUCKET || row.storage_path !== path || row.content_sha256 !== fileSha) {
          throw new Error("documents: existing row does not match this archive");
        }
      } else {
        if (doc.id !== documentId) throw new Error("documents: inserted id mismatch");
        createdDocument = true;
      }
    }

    const { data: won, error: finErr } = await admin
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
      .eq("id", ag.id)
      .is("document_id", null)
      .neq("archive_status", "archived")
      .select("id,document_id,sha256,archive_status")
      .maybeSingle();
    if (finErr) throw new Error(`finalize: ${finErr.message}`);
    if (!won) {
      const again = await admin.from("agreements").select("id,document_id,sha256,archive_status").eq("id", ag.id).maybeSingle();
      const row = again.data;
      if (again.error || !row || row.archive_status !== "archived" || row.document_id !== documentId || row.sha256 !== fileSha) {
        throw new Error("finalize: agreement was not updated");
      }
    }
    finalized = true;
    await revealToDriver(admin, documentId);
    if (wasFailed)
      await logAudit(actor, { action: "document.archive_recovered", summary: "Signed document archived after retry", entityType: "esign_document", entityId: ag.id });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[esign] archive failed", ag.id, msg);
    if (!finalized && !alreadyArchived && documentId && fileSha) {
      try {
        const again = await admin.from("agreements").select("id,document_id,sha256,archive_status").eq("id", ag.id).maybeSingle();
        const row = again?.data;
        if (!again?.error && row?.archive_status === "archived" && row.document_id === documentId && row.sha256 === fileSha) finalized = true;
      } catch {
        // The agreement row could not be re-read. The attempt stays a failure.
      }
    }
    if (finalized) {
      try {
        await revealToDriver(admin, documentId);
      } catch {
        // The agreement is already archived. A later call reveals the document.
      }
      if (wasFailed)
        await logAudit(actor, { action: "document.archive_recovered", summary: "Signed document archived after retry", entityType: "esign_document", entityId: ag.id });
      return true;
    }
    if (createdDocument && documentId) {
      await admin.from("documents").delete().eq("id", documentId);
    }
    if (uploadedThisAttempt && path) {
      await admin.storage.from(BUCKET).remove([path]);
    }
    await admin
      .from("agreements")
      .update({ archive_status: "failed", archive_error: msg.slice(0, 500), archive_attempts: (ag.archive_attempts ?? 0) + 1, archive_last_attempt_at: new Date().toISOString() })
      .eq("id", ag.id)
      .neq("archive_status", "archived");
    await logAudit(actor, { action: "document.archive_failed", summary: "Signed document could not be archived", entityType: "esign_document", entityId: ag.id, metadata: { error: msg.slice(0, 200) } });
    return false;
  }
}
