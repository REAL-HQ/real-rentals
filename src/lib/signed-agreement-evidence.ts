/**
 * Signed-agreement evidence is never deleted through the document vault.
 *
 * deleteDocument used to remove the storage object and then the row for any
 * document, so one Owner click destroyed a signed rental agreement's PDF and
 * — through agreements.document_id's ON DELETE SET NULL — quietly cut the
 * agreement loose from its archive. Retention of signed evidence is a separate,
 * authorised review (see refuseArchiveDeletion in
 * signed-archive-protection.server.ts, whose bucket and path rule this
 * mirrors), not a vault button.
 *
 * This is the row-shape half of the rule. deleteDocument also refuses any
 * document an agreements row points at (document_id or completed_document_id),
 * which needs a database read and so lives there.
 *
 * Client-safe: the vault uses the same function to hide its Delete button.
 */
export const SIGNED_AGREEMENT_BUCKET = "rental-agreements";

export const SIGNED_AGREEMENT_DELETE_REFUSED =
  "Signed agreements are permanent records and can't be deleted from the document vault.";

export function isSignedAgreementEvidence(doc: {
  kind?: string | null;
  category?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
}): boolean {
  if (doc.kind === "rental_agreement") return true;
  if (doc.category === "agreement") return true;
  if (doc.storage_bucket === SIGNED_AGREEMENT_BUCKET) return true;
  // Content-addressed signed archives, wherever they are filed.
  return /^(immutable|completed)-v1\//.test(doc.storage_path ?? "");
}

/*
 * Replace and Needs New. Signed-agreement evidence is immutable in the vault:
 * an upload that would supersede it, and a "Needs New" review that would ask
 * for a replacement of it, are refused on the server (documents.functions.ts).
 * A wrong or changed agreement is voided and re-sent through eSign
 * (esign.server.ts); it is never overwritten or superseded here.
 * See docs/esign/SIGNED-AGREEMENT-IMMUTABILITY.md.
 */
export const SIGNED_AGREEMENT_REPLACE_REFUSED =
  "Signed agreements are permanent records and can't be replaced. To correct one, void it and send a new agreement through eSign.";

export const SIGNED_AGREEMENT_NEEDS_NEW_REFUSED =
  "Signed agreements are permanent records and can't be marked Needs New. To correct one, void it and send a new agreement through eSign.";

export const SIGNED_AGREEMENT_DRIVER_UPLOAD_REFUSED =
  "Signed agreements come from eSign and can't be uploaded from the portal.";

/**
 * True when a current row in this category is signed-agreement evidence, so
 * a new upload there would supersede it. The vault hides Replace and Needs New
 * on that card; the server refuses both regardless.
 */
export function signedAgreementLocked(
  rows: ReadonlyArray<{ category: string; is_current?: boolean | null; signed_agreement: boolean }>,
  category: string,
): boolean {
  return rows.some((r) => r.is_current !== false && r.category === category && r.signed_agreement);
}
