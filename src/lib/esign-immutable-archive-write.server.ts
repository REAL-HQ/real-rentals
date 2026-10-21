// Flag-on archive. archiveDocument calls this only when
// ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED is true, and only after
// SIGNED_ARCHIVE_V1_ENABLED. When both flags are on, completed-v1 runs
// and this writer does not.
//
// The PDF is uploaded once. supabase-js stores the upload `metadata`
// option on storage.objects.user_metadata (storage migration 0025), which
// is the column approval reads. The metadata column stays system data.
// The documents row is hidden from the driver until the agreement update
// commits. A failed attempt does not delete that row or object: a concurrent
// winner may have adopted them after this attempt last read the agreement.
// SIGNED_ARCHIVE_V1_ENABLED must stay false when immutable-v1 is on.
// archiveDocument checks that flag first and runs completed-v1 instead.
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
  const revealed = await admin.from("documents").update({ visibility: ["driver", "admin"], is_current: true }).eq("id", documentId);
  if (revealed?.error) throw new Error(`reveal: ${revealed.error.message}`);
}

/**
 * A retry whose PDF inputs changed stores a new immutable-v1 object. The
 * earlier attempt's admin-only row is not the archived document. Mark it
 * not current. Do not delete the row or the object.
 *
 * Staff can run the same rule when no later attempt archived a replacement:
 * UPDATE public.documents AS d
 * SET is_current = false
 * WHERE d.is_current = true
 *   AND d.storage_bucket = 'rental-agreements'
 *   AND d.storage_path LIKE 'immutable-v1/%'
 *   AND d.visibility = ARRAY['admin']::text[]
 *   AND NOT EXISTS (
 *     SELECT 1 FROM public.agreements AS a
 *     WHERE a.document_id = d.id OR a.completed_document_id = d.id
 *   );
 */
async function retireUnclaimedImmutableOrphans(admin: any, applicationId: string, documentId: string): Promise<void> {
  const listed = await admin
    .from("documents")
    .select("id,storage_path,visibility,is_current,driver_id,storage_bucket")
    .eq("driver_id", applicationId)
    .eq("storage_bucket", BUCKET)
    .eq("is_current", true);
  const rows = Array.isArray(listed?.data) ? listed.data : listed?.data ? [listed.data] : [];
  for (const row of rows) {
    if (!row || row.id === documentId || row.is_current !== true) continue;
    if (typeof row.storage_path !== "string" || !row.storage_path.startsWith("immutable-v1/")) continue;
    const visibility = Array.isArray(row.visibility) ? row.visibility : [];
    if (visibility.length !== 1 || visibility[0] !== "admin") continue;
    const claimed = await admin.from("agreements").select("id").eq("document_id", row.id).maybeSingle();
    if (claimed?.data) continue;
    const completed = await admin.from("agreements").select("id").eq("completed_document_id", row.id).maybeSingle();
    if (completed?.data) continue;
    await admin.from("documents").update({ is_current: false }).eq("id", row.id);
  }
}

export async function archiveImmutableV1(admin: any, ag: any, actor: Actor | null): Promise<boolean> {
  const wasFailed = ag.archive_status === "failed";
  const alreadyArchived = ag.archive_status === "archived";
  let documentId = "";
  let fileSha = "";
  let path = "";

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
      } else if (doc.id !== documentId) {
        throw new Error("documents: inserted id mismatch");
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
    await revealToDriver(admin, documentId);
    await retireUnclaimedImmutableOrphans(admin, ag.application_id, documentId);
    if (wasFailed)
      await logAudit(actor, { action: "document.archive_recovered", summary: "Signed document archived after retry", entityType: "esign_document", entityId: ag.id });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[esign] archive failed", ag.id, msg);
    const adoptedWinner = async () => {
      const again = await admin.from("agreements").select("id,document_id,sha256,archive_status").eq("id", ag.id).maybeSingle();
      const row = again?.data;
      if (again?.error || !row || row.archive_status !== "archived" || !row.document_id || !row.sha256) return null;
      return row;
    };
    const finishWinner = async (row: { document_id: string; sha256: string }) => {
      if (row.document_id === documentId && row.sha256 === fileSha) {
        try {
          await revealToDriver(admin, documentId);
          await retireUnclaimedImmutableOrphans(admin, ag.application_id, documentId);
        } catch {
          // The agreement is already archived. A later call reveals the document.
        }
      }
      if (wasFailed)
        await logAudit(actor, { action: "document.archive_recovered", summary: "Signed document archived after retry", entityType: "esign_document", entityId: ag.id });
      return true;
    };
    if (!alreadyArchived) {
      try {
        const adopted = await adoptedWinner();
        if (adopted) return await finishWinner(adopted);
      } catch {
        // The agreement row could not be re-read. The conditional update below is the next check.
      }
    }
    const failedWrite = await admin
      .from("agreements")
      .update({ archive_status: "failed", archive_error: msg.slice(0, 500), archive_attempts: (ag.archive_attempts ?? 0) + 1, archive_last_attempt_at: new Date().toISOString() })
      .eq("id", ag.id)
      .neq("archive_status", "archived")
      .select("id")
      .maybeSingle();
    if (!failedWrite?.data && !alreadyArchived) {
      try {
        const adopted = await adoptedWinner();
        if (adopted) return await finishWinner(adopted);
      } catch {
        // The failure update matched nothing and the agreement could not be re-read.
      }
    }
    // Do not delete the document or the object. The check above can be stale:
    // another attempt can finalize this same row and object before a delete runs.
    await logAudit(actor, { action: "document.archive_failed", summary: "Signed document could not be archived", entityType: "esign_document", entityId: ag.id, metadata: { error: msg.slice(0, 200) } });
    return false;
  }
}
