/**
 * Renter insurance: the last verified card stays current ("on file") until
 * the team reviews the renter's new upload (PR D, approved by Dolmar).
 *
 * - Renter upload of `insurance`: superseding skips rows already verified,
 *   so both the verified card and the new upload are current.
 * - Team verifies the new upload: every other current insurance row of that
 *   renter is then superseded by it.
 * - Team rejects the new upload while a verified card is still current: the
 *   rejected upload stops being current; the verified card stays on file.
 * Staff uploads keep the old behaviour (replace immediately).
 */
export const HOLD_VERIFIED_CATEGORIES: readonly string[] = [];
/*
 * Insurance used to be the one single-slot category with this hold. Every
 * category except agreements and applications now keeps all its files active
 * (documents.functions.ts MULTI_FILE_CATEGORIES), so a renter's new card no
 * longer supersedes the verified one and nothing is demoted on review. The
 * helpers stay for the single-slot paths and return their no-op answers.
 */

export function holdsVerifiedUntilReview(category: string, uploadedByRole: string | null | undefined): boolean {
  return HOLD_VERIFIED_CATEGORIES.includes(category) && (uploadedByRole ?? "driver") === "driver";
}

/** Apply the supersede filter: the query builder gets `.neq("review_status","verified")` when holding. */
export function supersedeQuery<Q extends { neq: (col: string, v: string) => Q }>(q: Q, hold: boolean): Q {
  return hold ? q.neq("review_status", "verified") : q;
}

export type ReviewFollowUp = "supersede_others" | "demote_rejected" | "none";

export function reviewFollowUp(
  category: string,
  status: "verified" | "rejected" | "uploaded",
  doc: { is_current: boolean },
  otherVerifiedCurrent: boolean,
): ReviewFollowUp {
  if (!HOLD_VERIFIED_CATEGORIES.includes(category)) return "none";
  if (status === "verified" && doc.is_current) return "supersede_others";
  if (status === "rejected" && doc.is_current && otherVerifiedCurrent) return "demote_rejected";
  return "none";
}
