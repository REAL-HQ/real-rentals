// Filing a signed rental agreement that arrived through Fleet Inbox onto the
// renter's application. Pure rules, client-safe; the server function in
// inbox-agreement.functions.ts performs the guarded write and the audit.
//
// The stored original is never copied, moved or re-encoded: only the document
// row is re-pointed (driver_id, category). The row lands as review_status
// "uploaded"; it counts for activation only after an Owner/Manager verifies
// it through setDocumentReview, which writes the mandatory audit row
// (activation-readiness.ts isAuditedPaperAgreement). Filing never certifies a signature.

export const RENTAL_AGREEMENT_CLASS = "rental_agreement" as const;
/** Classes a historical Fleet Inbox upload may carry when it is really a rental agreement. */
export const FILEABLE_INBOX_CLASSES = ["rental_agreement", "purchase_agreement", "unknown", "other"] as const;
export const AGREEMENT_ROLES = ["original", "swap"] as const;
export type AgreementRole = (typeof AGREEMENT_ROLES)[number];

export type InboxDocFact = {
  id: string; driver_id: string | null; vehicle_id: string | null; category: string | null; source: string | null;
  storage_bucket: string | null; storage_path: string | null; content_sha256: string | null; is_current: boolean | null; file_name: string | null;
};
export type ApplicationFact = { id: string; deleted_at: string | null; purged_at: string | null; full_name: string | null };
export type FiledAgreementFact = { id: string; agreement_role: AgreementRole | null };
export type FilingInput = {
  doc: InboxDocFact | null; app: ApplicationFact | null; role: AgreementRole;
  /** Required for a swap: the original agreement this swap follows. */
  relatedDocumentId?: string | null;
  filed: readonly FiledAgreementFact[];
};
export type FilingPatch = {
  driver_id: string; kind: "agreement"; category: "agreement"; label: string; visibility: string[];
  review_status: "uploaded"; reviewed_at: null; reviewed_by: null; is_current: true;
};
export type FilingPlan = { ok: true; patch: FilingPatch; audit: Record<string, unknown> } | { ok: false; error: string };

export function agreementLabel(role: AgreementRole, relatedDocumentId: string | null): string {
  return role === "swap" ? `Rental Agreement — Swap (follows ${String(relatedDocumentId).slice(0, 8)})` : "Rental Agreement — Original";
}
export function roleFromLabel(label: string | null | undefined): AgreementRole | null {
  if (!label) return null;
  if (/^Rental Agreement — Swap/.test(label)) return "swap";
  return /^Rental Agreement — Original/.test(label) ? "original" : null;
}

export function planAgreementFiling(i: FilingInput): FilingPlan {
  const d = i.doc;
  if (!d) return { ok: false, error: "File not found." };
  if (d.source !== "fleet_inbox") return { ok: false, error: "Only Fleet Inbox files can be filed here." };
  if (d.driver_id) return { ok: false, error: "This file is already filed to a renter." };
  if (!(FILEABLE_INBOX_CLASSES as readonly string[]).includes(String(d.category ?? "unknown")))
    return { ok: false, error: "This file is not a rental agreement candidate." };
  if (!d.storage_bucket || !d.storage_path || !d.content_sha256)
    return { ok: false, error: "The stored original is missing; nothing was filed." };
  if (d.is_current === false) return { ok: false, error: "This file was superseded; nothing was filed." };
  const a = i.app;
  if (!a || a.deleted_at || a.purged_at) return { ok: false, error: "Renter application not found." };
  if (!(AGREEMENT_ROLES as readonly string[]).includes(i.role)) return { ok: false, error: "Choose Original or Swap." };
  let related: string | null = null;
  if (i.role === "swap") {
    related = i.relatedDocumentId ?? null;
    if (!related || !i.filed.some((f) => f.id === related))
      return { ok: false, error: "A swap agreement must name the renter's original agreement, filed first." };
  } else if (i.relatedDocumentId) {
    return { ok: false, error: "An original agreement does not follow another agreement." };
  }
  return {
    ok: true,
    patch: {
      driver_id: a.id, kind: "agreement", category: "agreement", label: agreementLabel(i.role, related),
      // Staff-only until reviewed; the renter portal never shows unverified paper.
      visibility: ["admin"], review_status: "uploaded", reviewed_at: null, reviewed_by: null, is_current: true,
    },
    audit: {
      documentId: d.id, applicationId: a.id, from_category: d.category, to_category: "agreement",
      agreement_role: i.role, related_document_id: related, storage_bucket: d.storage_bucket,
      storage_path: d.storage_path, content_sha256: d.content_sha256, file_name: d.file_name,
      copied_bytes: false, signature_certified: false,
    },
  };
}

/** A Fleet Inbox file looks like a rental agreement (class, or the analyzer's own warning). */
export function looksLikeRentalAgreement(docClass: string | null | undefined, warnings: readonly unknown[] | null | undefined): boolean {
  if (docClass === RENTAL_AGREEMENT_CLASS) return true;
  return (warnings ?? []).some((w) => typeof w === "string" && /rental agreement/i.test(w));
}
