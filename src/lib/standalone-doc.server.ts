// Staff upload of a third-party PDF, the stamp applied when the renter signs,
// and the insurer email that follows. Signing, voiding and the claim stay in
// esign.server.ts. This module does not import that file at load time.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { checkPaperPdf, sha256Hex as paperSha } from "@/lib/paper-agreements";
import { appendCertificateOfCompletion, createMarkDrawer, pdfSafeText, sha256Hex } from "@/lib/esign-pdf.server";
import { logAudit } from "@/lib/audit.server";
import type { Actor } from "@/lib/roles.server";
import type { Adoption } from "@/lib/signature-adoption";
import {
  STANDALONE_BUCKET,
  SOURCE_URL_TTL_SECONDS,
  deliverTo,
  refuseStandaloneLink,
  resendSkipsRentalMerge,
  signedDateLabel,
  sourcePdfAllowed,
  standaloneBody,
  standaloneSignedPath,
  standaloneSourcePath,
  validateFields,
  type DeliverTo,
  type PageSize,
  type SourcePdfClient,
  type StandaloneField,
} from "@/lib/standalone-doc";

export { resendSkipsRentalMerge };

export type PdfInspection =
  | { ok: false; reason: string }
  | { ok: true; sha256: string; pages: number; sizes: PageSize[]; fallback: boolean; fallbackReason: string | null };

/** Validate the bytes and ask pdf-lib whether it can stamp them. */
export async function inspectStandalonePdf(bytes: Uint8Array): Promise<PdfInspection> {
  const check = checkPaperPdf(bytes);
  if (!check.ok) return { ok: false, reason: check.reason };
  const sha = await paperSha(bytes);
  try {
    const doc = await PDFDocument.load(bytes);
    const sizes = doc.getPages().map((p) => {
      const s = p.getSize();
      return { width: s.width, height: s.height };
    });
    if (!sizes.length) return { ok: false, reason: "This PDF has no pages." };
    return { ok: true, sha256: sha, pages: sizes.length, sizes, fallback: false, fallbackReason: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const encrypted = /encrypt/i.test(msg);
    return {
      ok: true,
      sha256: sha,
      pages: 0,
      sizes: [],
      fallback: true,
      fallbackReason: encrypted
        ? "This PDF is encrypted. A signature page will be added after the renter signs, and the original file is kept unchanged."
        : "This PDF could not be opened for editing. A signature page will be added after the renter signs, and the original file is kept unchanged.",
    };
  }
}

function decodePdfBase64(b64: string): Uint8Array {
  const clean = b64.replace(/^data:application\/pdf;base64,/i, "").replace(/\s/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function putImmutable(admin: any, path: string, bytes: Uint8Array, sha: string): Promise<void> {
  const bucket = admin.storage.from(STANDALONE_BUCKET);
  const existing = await bucket.download(path);
  if (!existing.error && existing.data) {
    const got = new Uint8Array(await existing.data.arrayBuffer());
    if ((await sha256Hex(got)) !== sha) throw new Error("Stored PDF does not match its SHA-256");
    return;
  }
  const up = await bucket.upload(path, new Blob([bytes as BlobPart], { type: "application/pdf" }), {
    contentType: "application/pdf",
    upsert: false,
  });
  if (up.error) {
    const again = await bucket.download(path);
    if (!again.error && again.data) {
      const got = new Uint8Array(await again.data.arrayBuffer());
      if ((await sha256Hex(got)) === sha) return;
    }
    throw new Error(`upload: ${up.error.message}`);
  }
}

export type CreateStandaloneArgs = {
  applicationId: string;
  title: string;
  pdfBase64: string;
  fields: StandaloneField[];
  insurerEmail: string;
  cc?: string[];
  copyRenter?: boolean;
  actor: Actor;
};

export type CreateStandaloneResult = {
  id: string;
  url: string;
  fallback: boolean;
  fallbackReason: string | null;
  delivery: { email: string; sms: string; delivered: boolean };
};

/** Staff only. Stores the original immutably, then sends the signing link. */
export async function createStandaloneDocument(admin: any, args: CreateStandaloneArgs): Promise<CreateStandaloneResult> {
  if (args.actor.tier !== "owner" && args.actor.tier !== "manager") throw new Error("Forbidden");
  const title = args.title.trim();
  if (!title || title.length > 160) throw new Error("Enter a document title.");
  const bytes = decodePdfBase64(args.pdfBase64);
  const inspected = await inspectStandalonePdf(bytes);
  if (!inspected.ok) throw new Error(inspected.reason);
  const fieldError = validateFields(args.fields, inspected.sizes, inspected.fallback);
  if (fieldError) throw new Error(fieldError);
  const plan = deliverTo({ insurerEmail: args.insurerEmail, cc: args.cc, copyRenter: args.copyRenter });

  const { data: app, error: appErr } = await admin
    .from("applications")
    .select("id,full_name,email,phone,deleted_at")
    .eq("id", args.applicationId)
    .maybeSingle();
  if (appErr || !app || app.deleted_at) throw new Error("Driver not found");
  if (!app.email) throw new Error("This driver has no email on file");

  const agreementId = crypto.randomUUID();
  const path = standaloneSourcePath(agreementId, inspected.sha256);
  await putImmutable(admin, path, bytes, inspected.sha256);

  const { randomToken, hashToken, getCompanySigner } = await import("@/lib/esign.server");
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const company = await getCompanySigner(admin);
  const now = new Date().toISOString();
  const metadata = {
    source_pdf: { path, sha256: inspected.sha256, pages: inspected.pages },
    fields: inspected.fallback ? [] : args.fields,
    page_sizes: inspected.sizes,
    deliver_to: plan,
    signature_page_fallback: inspected.fallback,
  };
  const { error: insErr } = await admin.from("agreements").insert({
    id: agreementId,
    source: "standalone",
    application_id: args.applicationId,
    title,
    body: standaloneBody(title, inspected.sha256, inspected.pages, inspected.fallback),
    merge_data: { driver_name: app.full_name ?? null, driver_email: app.email },
    metadata,
    status: "sent",
    token_hash: tokenHash,
    token_expires_at: expires,
    sent_at: now,
    signer_email: app.email,
    created_by: args.actor.userId,
    company_signer_name: company.name,
    company_signer_title: company.title,
  });
  if (insErr) throw new Error(insErr.message);

  const { data: recipient, error: recErr } = await admin.from("esign_recipients").insert({
    document_id: agreementId,
    name: (app.full_name as string | null) ?? null,
    email: app.email,
    phone: (app.phone as string | null) ?? null,
    role: "signer",
    signing_order: 1,
    status: "sent",
    sent_at: now,
    token_hash: tokenHash,
    token_expires_at: expires,
  }).select("id").single();
  if (recErr || !recipient) {
    await admin.from("agreements").update({ status: "voided", voided_at: new Date().toISOString(), token_hash: null }).eq("id", agreementId);
    throw new Error(recErr?.message ?? "Could not add the signer");
  }
  const { rememberSigningToken } = await import("@/lib/agreement-resend.server");
  await rememberSigningToken(admin, recipient.id as string, token);
  await logAudit(args.actor, {
    action: "document.created",
    summary: "Standalone document created for signature",
    entityType: "esign_document",
    entityId: agreementId,
    metadata: { sha256: inspected.sha256, fallback: inspected.fallback, insurer_email: plan.insurer_email },
  });
  await logAudit(args.actor, {
    action: "document.sent",
    summary: "Standalone document sent for signature",
    entityType: "esign_document",
    entityId: agreementId,
  });

  const { publicAppOrigin } = await import("@/lib/public-app-url");
  const url = `${publicAppOrigin()}/sign/${token}`;
  const { deliverSigningLink } = await import("@/lib/esign.server");
  const delivery = await deliverSigningLink(admin, {
    id: agreementId,
    url,
    email: app.email as string,
    phone: (app.phone as string | null) ?? null,
    name: (app.full_name as string | null) ?? null,
    vehicle: null,
    applicationId: args.applicationId,
    actor: args.actor,
  });
  return { id: agreementId, url, fallback: inspected.fallback, fallbackReason: inspected.fallbackReason, delivery };
}

type Meta = {
  source_pdf?: { path?: string; sha256?: string; pages?: number };
  fields?: StandaloneField[];
  page_sizes?: PageSize[];
  deliver_to?: DeliverTo;
  signature_page_fallback?: boolean;
  signature?: { adoption?: Adoption; sha256?: string };
};

function metaOf(ag: any): Meta {
  const m = ag?.metadata;
  return m && typeof m === "object" ? (m as Meta) : {};
}

async function drawSignaturePage(pdf: PDFDocument, ag: any, adoption: Adoption, originalSha: string): Promise<void> {
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.07, 0.08);
  const muted = rgb(0.45, 0.45, 0.5);
  page.drawText(pdfSafeText(ag.title || "Document"), { x: 60, y: 730, size: 16, font: bold, color: ink });
  page.drawText("Signature", { x: 60, y: 690, size: 11, font: bold, color: ink });
  const draw = await createMarkDrawer(pdf);
  await draw(page, adoption.signature, 60, 630, 280, 48);
  page.drawText(pdfSafeText(`Printed name: ${ag.signer_name || ""}`), { x: 60, y: 600, size: 12, font, color: ink });
  page.drawText(pdfSafeText(`Date: ${signedDateLabel(ag.signed_at)}`), { x: 60, y: 578, size: 12, font, color: ink });
  page.drawText("The original PDF is attached unchanged because it could not be stamped in place.", { x: 60, y: 540, size: 10, font, color: muted });
  page.drawText(pdfSafeText(`Original PDF SHA-256: ${originalSha}`), { x: 60, y: 522, size: 8, font, color: muted });
}

async function stampFields(pdf: PDFDocument, ag: any, fields: StandaloneField[], adoption: Adoption): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let draw: Awaited<ReturnType<typeof createMarkDrawer>> | null = null;
  const pages = pdf.getPages();
  const date = signedDateLabel(ag.signed_at);
  const name = String(ag.signer_name || "");
  for (const f of fields) {
    const page = pages[f.page - 1];
    if (!page) throw new Error("A signature box is on a page that does not exist");
    if (f.type === "signature") {
      draw ??= await createMarkDrawer(pdf);
      await draw(page, adoption.signature, f.x, f.y, f.w, f.h);
      continue;
    }
    const text = f.type === "date" ? date : name;
    const safe = pdfSafeText(text);
    let size = Math.min(f.h * 0.72, 14);
    while (size > 6 && font.widthOfTextAtSize(safe, size) > f.w - 2) size -= 0.5;
    page.drawText(safe, {
      x: f.x + 1,
      y: f.y + Math.max(0, (f.h - size) / 2),
      size,
      font,
      color: rgb(0.07, 0.07, 0.08),
    });
  }
}

/**
 * Re-check the original's SHA-256, draw the adopted signature into the boxes
 * (or append a signature page when the PDF cannot be loaded), then append the
 * Certificate of Completion. Uploads the signed file and inserts its documents row.
 * The agreement finalization stays with archiveDocument.
 */
export async function stampStandalonePdf(admin: any, ag: any): Promise<{ fileSha: string; bodySha: string; documentId: string; pdf: Uint8Array }> {
  const meta = metaOf(ag);
  const src = meta.source_pdf;
  if (!src?.path || !src.path.startsWith("standalone-src/") || !src.sha256) throw new Error("Original PDF record is missing");
  const file = await admin.storage.from(STANDALONE_BUCKET).download(src.path);
  if (file.error || !file.data) throw new Error("Original PDF unavailable");
  const original = new Uint8Array(await file.data.arrayBuffer());
  const got = await sha256Hex(original);
  if (got !== src.sha256) throw new Error("Original PDF hash does not match the stored SHA-256");

  const adoption = meta.signature?.adoption;
  if (!adoption?.signature) throw new Error("Signature evidence is missing");
  const bodySha = await sha256Hex(String(ag.body ?? ""));
  let pdfDoc: PDFDocument;
  let inPlace = false;
  if (meta.signature_page_fallback) {
    pdfDoc = await PDFDocument.create();
  } else {
    try {
      pdfDoc = await PDFDocument.load(original);
      inPlace = true;
    } catch {
      pdfDoc = await PDFDocument.create();
    }
  }
  const fixed = new Date(ag.signed_at || Date.now());
  if (!Number.isNaN(fixed.getTime())) {
    pdfDoc.setCreationDate(fixed);
    pdfDoc.setModificationDate(fixed);
  }
  pdfDoc.setTitle(pdfSafeText(ag.title || "Signed document"));
  pdfDoc.setProducer("REAL RENTALS eSign");
  if (!inPlace) {
    try {
      await pdfDoc.attach(original, "original.pdf", {
        mimeType: "application/pdf",
        description: "Original uploaded PDF, unchanged",
        creationDate: fixed,
        modificationDate: fixed,
      });
    } catch (e) {
      console.error("[esign] could not attach the original PDF", e instanceof Error ? e.message : e);
    }
    await drawSignaturePage(pdfDoc, ag, adoption, src.sha256);
  } else {
    await stampFields(pdfDoc, ag, Array.isArray(meta.fields) ? meta.fields : [], adoption);
  }
  await appendCertificateOfCompletion(pdfDoc, {
    id: ag.id,
    title: ag.title,
    body: ag.body ?? "",
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
    adoption,
    adoptionSha256: meta.signature?.sha256 ?? null,
    originalSha256: src.sha256,
    note: inPlace ? null : "The original PDF could not be stamped in place. A signature page was added and the original file is attached unchanged.",
  });
  const pdf = await pdfDoc.save({ useObjectStreams: false });
  const fileSha = await sha256Hex(pdf);
  const path = standaloneSignedPath(ag.id, fileSha);
  await putImmutable(admin, path, pdf, fileSha);

  let documentId: string | null = ag.document_id ?? null;
  if (!documentId) {
    const { data: existing } = await admin.from("documents").select("id").eq("storage_bucket", STANDALONE_BUCKET).eq("storage_path", path).maybeSingle();
    documentId = existing?.id ?? null;
  }
  if (!documentId) {
    const { data: doc, error: docErr } = await admin.from("documents").insert({
      content_sha256: fileSha,
      driver_id: ag.application_id,
      kind: "rental_agreement",
      category: "agreement",
      label: ag.title,
      storage_bucket: STANDALONE_BUCKET,
      storage_path: path,
      visibility: ["driver", "admin"],
      file_name: `signed-document-${String(ag.id).slice(0, 8)}.pdf`,
      mime_type: "application/pdf",
      uploaded_by_role: "system",
    }).select("id").single();
    if (docErr || !doc) throw new Error(`documents: ${docErr?.message ?? "no row"}`);
    documentId = doc.id as string;
  }
  return { fileSha, bodySha, documentId, pdf };
}

/** archiveDocument's standalone branch: stamp, then the same finalized columns. */
export async function archiveStandaloneDocument(admin: any, ag: any, actor: Actor | null): Promise<boolean> {
  const wasFailed = ag.archive_status === "failed";
  try {
    const stamped = await stampStandalonePdf(admin, ag);
    const { error: finErr } = await admin.from("agreements").update({
      archive_status: "archived",
      archive_error: null,
      archive_attempts: (ag.archive_attempts ?? 0) + 1,
      archive_last_attempt_at: new Date().toISOString(),
      document_id: stamped.documentId,
      completed_document_id: stamped.documentId,
      sha256: stamped.fileSha,
      body_sha256: stamped.bodySha,
    }).eq("id", ag.id);
    if (finErr) throw new Error(`finalize: ${finErr.message}`);
    if (wasFailed) {
      await logAudit(actor, { action: "document.archive_recovered", summary: "Signed document archived after retry", entityType: "esign_document", entityId: ag.id });
    }
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[esign] standalone archive failed", ag.id, msg);
    await admin.from("agreements").update({
      archive_status: "failed",
      archive_error: msg.slice(0, 500),
      archive_attempts: (ag.archive_attempts ?? 0) + 1,
      archive_last_attempt_at: new Date().toISOString(),
    }).eq("id", ag.id);
    await logAudit(actor, { action: "document.archive_failed", summary: "Signed document could not be archived", entityType: "esign_document", entityId: ag.id, metadata: { error: msg.slice(0, 200) } });
    return false;
  }
}

/** Short-lived URL for the unsigned original. Refused once the link is voided, signed, or expired. */
export async function sourcePdfForClient(admin: any, ag: any): Promise<SourcePdfClient | null> {
  if (!sourcePdfAllowed(ag)) return null;
  try { refuseStandaloneLink(ag); } catch { return null; }
  const meta = metaOf(ag);
  const path = meta.source_pdf?.path;
  if (!path || !path.startsWith("standalone-src/")) return null;
  const signed = await admin.storage.from(STANDALONE_BUCKET).createSignedUrl(path, SOURCE_URL_TTL_SECONDS);
  const url = signed?.data?.signedUrl as string | undefined;
  if (signed?.error || !url) return null;
  return {
    url,
    pages: Number(meta.source_pdf?.pages) || 0,
    fields: Array.isArray(meta.fields) ? meta.fields : [],
    fallback: meta.signature_page_fallback === true,
    page_sizes: Array.isArray(meta.page_sizes) ? meta.page_sizes : [],
  };
}

async function blocked(admin: any, email: string, applicationId: string | null): Promise<string | null> {
  const { isBlacklistSuppressed, BLACKLIST_SUPPRESSED_ERROR } = await import("@/lib/blacklist.server");
  if (await isBlacklistSuppressed(admin, { email, applicationId })) return BLACKLIST_SUPPRESSED_ERROR;
  const { badEmailForAddress } = await import("@/lib/email-suppression.server");
  const { BAD_EMAIL_SUPPRESSED_ERROR } = await import("@/lib/email-suppression");
  if (await badEmailForAddress(admin, email)) return BAD_EMAIL_SUPPRESSED_ERROR;
  return null;
}

/**
 * After a standalone document is signed: insurer To, team@ Cc, renter copied.
 * A suppressed renter does not stop the insurer email. Nothing is thrown;
 * the signature is already recorded.
 */
export async function deliverSignedStandalone(
  admin: any,
  agreementId: string,
  send?: (args: {
    to: string;
    cc?: string[];
    title: string;
    signerName: string;
    copyFor: "insurer" | "renter";
    attachment?: { filename: string; content: string; contentType?: string } | null;
  }) => Promise<{ ok: boolean }>,
): Promise<{ insurer: string; renter: string }> {
  const outcome = { insurer: "skipped", renter: "skipped" };
  try {
    const { data: ag } = await admin.from("agreements").select("id,title,source,application_id,signer_email,signer_name,metadata,status,document_id,archive_status").eq("id", agreementId).maybeSingle();
    if (!ag || ag.source !== "standalone") return outcome;
    const plan = metaOf(ag).deliver_to;
    if (!plan?.insurer_email) return outcome;
    const { loadSignedAgreementAttachment } = await import("@/lib/signed-agreement-pdf.server");
    const loaded = await loadSignedAgreementAttachment(admin, agreementId);
    const attachment = loaded
      ? { ...loaded, filename: `REAL-RENTALS-Signed-Document-${String(agreementId).slice(0, 8)}.pdf` }
      : null;
    const sendMail = send ?? (await import("@/lib/email.server")).sendSignedDocumentEmail;
    const insurerBlock = await blocked(admin, plan.insurer_email, null);
    if (insurerBlock) outcome.insurer = "blocked";
    else {
      const cc = (plan.cc ?? []).filter((e) => e && e !== plan.insurer_email);
      const sent = await sendMail({
        to: plan.insurer_email,
        cc,
        title: ag.title as string,
        signerName: (ag.signer_name as string | null) ?? "The renter",
        copyFor: "insurer",
        attachment,
      });
      outcome.insurer = sent.ok ? "sent" : "failed";
    }
    const renter = String(ag.signer_email ?? "").trim();
    if (plan.copy_renter && renter && renter.toLowerCase() !== plan.insurer_email) {
      const renterBlock = await blocked(admin, renter, ag.application_id as string | null);
      if (renterBlock) outcome.renter = "blocked";
      else {
        const sent = await sendMail({
          to: renter,
          title: ag.title as string,
          signerName: (ag.signer_name as string | null) ?? "The renter",
          copyFor: "renter",
          attachment,
        });
        outcome.renter = sent.ok ? "sent" : "failed";
      }
    } else if (!plan.copy_renter) outcome.renter = "off";
    await logAudit(null, {
      action: outcome.insurer === "sent" ? "document.standalone_delivered" : "document.delivery_failed",
      summary: outcome.insurer === "sent" ? "Signed document emailed to the insurer" : "Signed document was not emailed to the insurer",
      entityType: "esign_document",
      entityId: agreementId,
      metadata: { insurer: outcome.insurer, renter: outcome.renter },
    });
  } catch (e) {
    console.error("[esign] standalone delivery failed", e instanceof Error ? e.message : e);
  }
  return outcome;
}
