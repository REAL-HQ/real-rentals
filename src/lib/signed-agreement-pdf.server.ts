/**
 * The signed agreement PDF as an email attachment (Dolmar, t445u): the staff
 * "Signed Agreement" email and the renter's "Agreement Signed" email carry
 * the stored signed PDF. Read-only. Never throws: a missing, still-archiving
 * or oversized PDF returns null and the email goes out without it.
 */
import type { EmailAttachment } from "@/lib/email.server";

type Admin = any;

/** Resend accepts 40 MB per email after base64; stay well under it. */
export const SIGNED_PDF_ATTACH_MAX_BYTES = 10 * 1024 * 1024;

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function signedAgreementFileName(agreementId: string): string {
  return `REAL-RENTALS-Rental-Agreement-${String(agreementId).slice(0, 8)}.pdf`;
}

export async function loadSignedAgreementAttachment(
  admin: Admin,
  agreementId: string,
  opts: { maxBytes?: number } = {},
): Promise<EmailAttachment | null> {
  try {
    const { data: ag } = await admin
      .from("agreements")
      .select("id,status,document_id,archive_status")
      .eq("id", agreementId)
      .maybeSingle();
    if (!ag || ag.status !== "signed" || !ag.document_id || ag.archive_status !== "archived") return null;
    const { data: doc } = await admin
      .from("documents")
      .select("storage_bucket,storage_path")
      .eq("id", ag.document_id)
      .maybeSingle();
    if (!doc?.storage_bucket || !doc?.storage_path) return null;
    const { data: file, error } = await admin.storage.from(doc.storage_bucket as string).download(doc.storage_path as string);
    if (error || !file) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length || bytes.length > (opts.maxBytes ?? SIGNED_PDF_ATTACH_MAX_BYTES)) return null;
    return { filename: signedAgreementFileName(agreementId), content: bytesToBase64(bytes), contentType: "application/pdf" };
  } catch (e) {
    console.error("[agreement] signed PDF attachment unavailable", String((e as Error)?.message ?? e));
    return null;
  }
}
