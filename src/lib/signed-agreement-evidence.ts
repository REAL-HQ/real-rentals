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
