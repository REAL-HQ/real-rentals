// The one eSign engine. Rental agreements (and later standalone documents)
// consume these helpers; nothing else signs, voids or archives.
import { preserveCompletedPdfV1 } from "@/lib/esign-immutable-archive-v1.server";
import { SIGNED_ARCHIVE_V1_ENABLED } from "@/lib/record-rental-live-path";
import { assertSignedArchiveBytes } from "@/lib/signed-archive-protection.server";
import { logAudit } from "@/lib/audit.server";
import type { Actor } from "@/lib/roles.server";
import { renderCompletedPdf, sha256Hex } from "@/lib/esign-pdf.server";

export type ClaimResult = "won" | "already_signed" | "in_progress" | "voided" | "expired" | "invalid";

export function randomToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
export const hashToken = (t: string) => sha256Hex(t);

const DOC_COLS =
  "id,application_id,vehicle_id,source,title,body,status,company_signer_name,company_signer_title,signer_email,signer_name,signed_at,sent_at,viewed_at,created_at,signer_ip,signer_user_agent,auth_method,merge_data,metadata,archive_attempts,document_id";

/** Atomic claim + signature commit. Exactly one concurrent caller wins. */
export async function completeSigning(
  admin: any,
  args: {
    id: string;
    tokenHash: string | null; // null = portal (ownership already verified)
    signerName: string;
    ip: string | null;
    userAgent: string | null;
    authMethod: "email_link" | "portal";
    /** Validated by the caller against the stored body (adoptionProblems). */
    adoption?: import("@/lib/signature-adoption").Adoption | null;
  },
): Promise<{ result: ClaimResult; archived?: boolean }> {
  const { data: claim, error } = await admin.rpc("esign_claim", {
    _id: args.id,
    _token_hash: args.tokenHash,
  });
  if (error) throw new Error("Could not record your signature. Please try again.");
  const result = claim as ClaimResult;
  if (result !== "won") return { result };

  const signedAt = new Date().toISOString();
  let metadata: any = undefined;
  if (args.adoption) {
    const { data: cur } = await admin.from("agreements").select("metadata").eq("id", args.id).maybeSingle();
    const evidence = JSON.stringify(args.adoption);
    metadata = { ...((cur?.metadata as any) ?? {}), signature: { adoption: args.adoption, sha256: await sha256Hex(evidence), adopted_at: signedAt } };
  }
  const { data: ag, error: upErr } = await admin
    .from("agreements")
    .update({
      ...(metadata ? { metadata } : {}),
      status: "signed",
      signed_at: signedAt,
      completed_at: signedAt,
      signer_name: args.signerName,
      signer_ip: args.ip,
      signer_user_agent: args.userAgent,
      auth_method: args.authMethod,
      token_hash: null,
      archive_status: "pending",
      archive_last_attempt_at: signedAt,
    })
    .eq("id", args.id)
    .eq("status", "signing")
    .select(DOC_COLS)
    .single();
  if (upErr || !ag) {
    // Release the lock so the signer can retry rather than leaving it stuck.
    await admin.from("agreements").update({ status: "viewed" }).eq("id", args.id).eq("status", "signing");
    throw new Error("Could not record your signature. Please try again.");
  }
  await admin
    .from("esign_recipients")
    .update({ status: "signed", signed_at: signedAt, ip: args.ip, user_agent: args.userAgent, auth_method: args.authMethod, token_revoked_at: signedAt })
    .eq("document_id", args.id)
    .eq("role", "signer");

  await logAudit(null, {
    action: "document.signed",
    summary: `eSign document signed (${args.authMethod})`,
    entityType: "esign_document",
    entityId: args.id,
    ...(args.adoption ? { metadata: {
      signature: args.adoption.signature.method === "typed" ? `typed:${args.adoption.signature.style}` : "drawn",
      initials: args.adoption.initials.method === "typed" ? `typed:${args.adoption.initials.style}` : "drawn",
      acknowledgments: `${args.adoption.acks.filter(Boolean).length}/${args.adoption.acks.length}`,
      evidence_sha256: metadata.signature.sha256,
    } } : {}),
  });

  const archived = await archiveDocument(admin, ag, null);
  return { result: "won", archived };
}

/**
 * PDF -> hash -> upload -> documents row -> finalize. Storage and DB are not
 * one transaction, so failure is recorded as archive_status='failed' (visible
 * to staff, retried by cron) instead of a silent null.
 */
async function archiveCompletedV1(admin: any, ag: any, actor: Actor | null): Promise<boolean> {
  // Verification of an already finalized PDF stays outside the failure writer.
  // A mismatch throws and does not mark the archived row failed. retryArchive
  // re-enters this check instead of treating archived as success.
  if (ag.archive_status === "archived") {
    const { data: doc, error } = await admin.from("documents").select("id,storage_bucket,storage_path,content_sha256").eq("id", ag.document_id).maybeSingle();
    if (error || !doc) throw new Error("Signed PDF record missing");
    const file = await admin.storage.from(doc.storage_bucket).download(doc.storage_path);
    if (file.error || !file.data) throw new Error("Signed PDF unavailable");
    await assertSignedArchiveBytes(doc, ag, new Uint8Array(await file.data.arrayBuffer()));
    return true;
  }
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
    const identity = await sha256Hex(`completed-v1:${ag.id}:${fileSha}`);
    let documentId: string = ag.document_id ?? `${identity.slice(0, 8)}-${identity.slice(8, 12)}-5${identity.slice(13, 16)}-a${identity.slice(17, 20)}-${identity.slice(20, 32)}`;
    const path = `completed-v1/${documentId}/${fileSha}.pdf`;
    const bucket = admin.storage.from("rental-agreements");
    await preserveCompletedPdfV1({
      upload: (key, bytes, options) => bucket.upload(key, new Blob([bytes as BlobPart], { type: "application/pdf" }), options),
      download: async (key) => {
        const r = await bucket.download(key);
        return { error: r.error, data: r.data ? new Uint8Array(await r.data.arrayBuffer()) : null };
      },
    }, documentId, pdf, fileSha, "completed-v1");
    if (ag.document_id) {
      const { data: current, error } = await admin.from("documents").select("id,storage_path,content_sha256").eq("id", documentId).maybeSingle();
      if (error || !current || current.storage_path !== path || current.content_sha256 !== fileSha) throw new Error("Existing archive identity mismatch");
    }
    if (!ag.document_id) {
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
      if (docErr || !doc) {
        if (docErr?.code !== "23505") throw new Error(`documents: ${docErr?.message ?? "no row"}`);
        const existing = await admin.from("documents").select("id,driver_id,storage_bucket,storage_path,content_sha256").eq("id", documentId).maybeSingle();
        if (existing.error || !existing.data || existing.data.driver_id !== ag.application_id || existing.data.storage_bucket !== "rental-agreements" || existing.data.storage_path !== path || existing.data.content_sha256 !== fileSha)
          throw new Error("ARCHIVE_CONFLICT: document identity");
      } else if (doc.id !== documentId) throw new Error("ARCHIVE_CONFLICT: inserted document identity");
    }

    const { data: finalized, error: finErr } = await admin
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
      .neq("archive_status", "archived")
      .select(`${DOC_COLS},archive_status,completed_document_id,sha256,body_sha256`)
      .maybeSingle();
    const recovered = finalized ? { data: finalized, error: null } : await admin.from("agreements")
      .select(`${DOC_COLS},archive_status,completed_document_id,sha256,body_sha256`).eq("id", ag.id).maybeSingle();
    const canonical = recovered.data;
    if (recovered.error || !canonical || canonical.archive_status !== "archived")
      throw new Error(`ARCHIVE_INCOMPLETE: ${finErr ? "finalization response failed" : "finalization not confirmed"}`);
    const fields = ["id", "application_id", "vehicle_id", "body", "signed_at", "signer_name", "signer_email", "auth_method"];
    if (fields.some((key) => (canonical[key] ?? null) !== (ag[key] ?? null)) || canonical.document_id !== documentId || canonical.completed_document_id !== documentId || canonical.sha256 !== fileSha || canonical.body_sha256 !== bodySha)
      throw new Error("ARCHIVE_CONFLICT: finalized evidence differs");
    const committedDoc = await admin.from("documents").select("id,driver_id,storage_bucket,storage_path,content_sha256").eq("id", documentId).maybeSingle();
    const d = committedDoc.data;
    if (committedDoc.error || !d || d.driver_id !== ag.application_id || d.storage_bucket !== "rental-agreements" || d.storage_path !== path || d.content_sha256 !== fileSha)
      throw new Error("ARCHIVE_CONFLICT: finalized document version differs");
    const downloaded = await bucket.download(path);
    if (downloaded.error || !downloaded.data) throw new Error("ARCHIVE_INCOMPLETE: finalized bytes unavailable");
    await assertSignedArchiveBytes(d, canonical, new Uint8Array(await downloaded.data.arrayBuffer()));
    if (wasFailed)
      await logAudit(actor, { action: "document.archive_recovered", summary: "Signed document archived after retry", entityType: "esign_document", entityId: ag.id });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[esign] archive failed", ag.id, msg);
    await admin
      .from("agreements")
      .update({ archive_status: "failed", archive_error: JSON.stringify({ code: msg.startsWith("ARCHIVE_CONFLICT:") ? "ARCHIVE_CONFLICT" : "ARCHIVE_INCOMPLETE", message: msg.slice(0, 350) }), archive_attempts: (ag.archive_attempts ?? 0) + 1, archive_last_attempt_at: new Date().toISOString() })
      .eq("id", ag.id).neq("archive_status", "archived");
    await logAudit(actor, { action: "document.archive_failed", summary: "Signed document could not be archived", entityType: "esign_document", entityId: ag.id, metadata: { error: msg.slice(0, 200) } });
    return false;
  }
}

export async function archiveDocument(admin: any, ag: any, actor: Actor | null): Promise<boolean> {
  // completed-v1 layout is off until Dolmar turns the flag on. Today's archives
  // stay at {applicationId}/agreement-{id}.pdf on the existing bucket.
  if (SIGNED_ARCHIVE_V1_ENABLED) return archiveCompletedV1(admin, ag, actor);
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
    const folder = ag.application_id ?? `standalone`;
    const path = `${folder}/agreement-${ag.id}.pdf`;
    const up = await admin.storage
      .from("rental-agreements")
      .upload(path, new Blob([pdf as BlobPart], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(`upload: ${up.error.message}`);

    let documentId: string | null = ag.document_id ?? null;
    if (!documentId) {
      const { data: existing } = await admin
        .from("documents").select("id").eq("storage_bucket", "rental-agreements").eq("storage_path", path).maybeSingle();
      documentId = existing?.id ?? null;
    }
    if (!documentId) {
      const { data: doc, error: docErr } = await admin
        .from("documents")
        .insert({
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
      documentId = doc.id;
    }

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

/** An attempt younger than this is treated as still running. */
const ARCHIVE_LOCK_MS = 60_000;

/**
 * Idempotent retry. A conditional update claims the row first, so two
 * concurrent callers (cron + staff button, or a double click) cannot both
 * render, upload and insert — the loser sees the claim and backs off.
 */
export async function retryArchive(admin: any, id: string, actor: Actor | null): Promise<boolean> {
  const { data: cur } = await admin.from("agreements").select("id,status,archive_status").eq("id", id).maybeSingle();
  if (!cur || cur.status !== "signed") throw new Error("Only signed documents can be archived");
  if (cur.archive_status === "archived") {
    if (!SIGNED_ARCHIVE_V1_ENABLED) return true;
    // A post-commit hash failure leaves the row archived and returns false.
    // The next retry must verify the stored bytes instead of reporting success.
    const { data: full, error } = await admin.from("agreements").select(`${DOC_COLS},archive_status,completed_document_id,sha256`).eq("id", id).maybeSingle();
    if (error || !full) throw new Error("Signed PDF record missing");
    return archiveDocument(admin, full, actor);
  }
  const now = new Date();
  const staleBefore = new Date(now.getTime() - ARCHIVE_LOCK_MS).toISOString();
  // failed -> pending claims immediately; a pending row is only re-claimed
  // once its in-flight attempt is stale. Each claim is one conditional UPDATE
  // using plain filters only: PostgREST re-applies or()/and() filters to the
  // returned row (after the update), which made the old single-query claim
  // always return nothing — so every retry silently failed.
  const claim = (f: (b: any) => any) =>
    f(admin.from("agreements").update({ archive_status: "pending", archive_last_attempt_at: now.toISOString() }).eq("id", id).eq("status", "signed"))
      .select(DOC_COLS + ",archive_status")
      .maybeSingle()
      .then((r: any) => r.data);
  const claimed =
    (await claim((b) => b.eq("archive_status", "failed"))) ??
    (await claim((b) => b.eq("archive_status", "pending").is("archive_last_attempt_at", null))) ??
    (await claim((b) => b.eq("archive_status", "pending").lt("archive_last_attempt_at", staleBefore)));
  if (!claimed) {
    const { data: again } = await admin.from("agreements").select("archive_status").eq("id", id).maybeSingle();
    return again?.archive_status === "archived";
  }
  // archiveDocument logs recovery when it started from a failure.
  return archiveDocument(admin, { ...claimed, archive_status: cur.archive_status }, actor);
}

export type ChannelStatus = "sent" | "failed" | "not_attempted";

/**
 * Deliver a signing link over email and SMS and record each channel's real
 * outcome on the document. Delivery never changes the document lifecycle: a
 * failed channel leaves the link valid. The raw link is never logged.
 */
export async function deliverSigningLink(
  admin: any,
  args: {
    id: string;
    url: string;
    email: string | null;
    phone: string | null;
    name: string | null;
    vehicle: string | null;
    applicationId: string | null;
    actor: Actor | null;
  },
): Promise<{ email: ChannelStatus; sms: ChannelStatus; delivered: boolean }> {
  const at = new Date().toISOString();
  let email: ChannelStatus = "not_attempted";
  let emailError: string | null = "No email on file";
  if (args.email) {
    try {
      const { sendAgreementEmail } = await import("@/lib/email.server");
      const r = await sendAgreementEmail({ to: args.email, firstName: args.name, url: args.url, vehicle: args.vehicle });
      email = r.ok ? "sent" : "failed";
      emailError = r.ok ? null : (r.error ?? "Email send failed").slice(0, 300);
    } catch (e) {
      email = "failed";
      emailError = (e instanceof Error ? e.message : "Email send failed").slice(0, 300);
    }
  }

  let sms: ChannelStatus = "not_attempted";
  let smsError: string | null = "No phone on file";
  if (args.phone) {
    try {
      const { sendSms } = await import("@/lib/sms.server");
      const r: any = await sendSms({
        to: args.phone,
        body: `REAL RENTALS: Your rental agreement is ready to sign: ${args.url} Reply STOP to opt out.`,
        kind: "agreement_sent",
        applicationId: args.applicationId ?? undefined,
      });
      if (r.ok) { sms = "sent"; smsError = null; }
      else if (r.skipped) { sms = "not_attempted"; smsError = String(r.reason ?? "skipped").replace(/_/g, " "); }
      else { sms = "failed"; smsError = String(r.error ?? "SMS send failed").slice(0, 300); }
    } catch (e) {
      sms = "failed";
      smsError = (e instanceof Error ? e.message : "SMS send failed").slice(0, 300);
    }
  }

  await admin.from("agreements").update({
    email_status: email, email_error: emailError, email_attempted_at: email === "not_attempted" ? null : at,
    sms_status: sms, sms_error: smsError, sms_attempted_at: sms === "not_attempted" ? null : at,
  }).eq("id", args.id);

  const delivered = email === "sent" || sms === "sent";
  if (!delivered) {
    await logAudit(args.actor, {
      action: "document.delivery_failed",
      summary: "Signing link wasn't delivered",
      entityType: "esign_document",
      entityId: args.id,
      metadata: { email, sms },
    });
  }
  return { email, sms, delivered };
}

export async function voidDocument(admin: any, id: string, actor: Actor | null): Promise<string> {
  const { data, error } = await admin.rpc("esign_void", { _id: id });
  if (error) throw new Error(error.message);
  if (data === "voided") {
    await logAudit(actor, { action: "document.voided", summary: "eSign document voided", entityType: "esign_document", entityId: id });
  }
  return data as string;
}

export async function getCompanySigner(admin: any): Promise<{ name: string; title: string | null }> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "esign_company_signer").maybeSingle();
  const v = (data?.value ?? {}) as { name?: string; title?: string };
  return { name: v.name?.trim() || "REAL RENTALS", title: v.title?.trim() || null };
}

export function requestMeta(req: Request | null | undefined) {
  return {
    ip: req?.headers.get("cf-connecting-ip") || req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    userAgent: req?.headers.get("user-agent") ?? null,
  };
}
