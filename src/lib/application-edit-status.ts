/**
 * Which applications an applicant may still change through a resume link.
 *
 * A resume token proves who is holding the link, not that the application is
 * still theirs to edit. Before this rule only the status promotion was
 * guarded, so a live token could rewrite an approved or active application —
 * including the licence and insurance file pointers staff had already
 * reviewed. Once the team has decided (approved, active, suspended, declined,
 * closed, duplicate) the applicant asks us to make changes instead.
 *
 * The same set as OPEN_APPLICATION_STATUSES in application-doc-gaps.ts ("still
 * an application"); scripts/application-edit-lock.test.mjs pins the two
 * together. Kept as its own module so the public wizard can import it without
 * loading a dark-flag module.
 *
 * Client-safe: no database, no server imports.
 */
export const APPLICANT_EDITABLE_STATUSES = ["partial", "new", "complete", "reviewing"] as const;

/** Shown by the wizard. Generic on purpose: it does not say which decision was made. */
export const APPLICATION_LOCKED_MESSAGE =
  "This application is already being processed — contact us to make changes.";

/**
 * The way forward from that screen (t316u): it used to be a dead end. Same
 * words for every decision; starting again emails a fresh link to the
 * address they type, so nothing here reveals or unlocks the old application.
 */
export const APPLICATION_LOCKED_NEXT_STEP =
  "Want to rent with us again? Start a new application and we'll email you a secure link to continue.";

export function isApplicantEditableStatus(status: unknown): boolean {
  const raw = typeof status === "string" ? status.trim().toLowerCase() : "";
  return (APPLICANT_EDITABLE_STATUSES as readonly string[]).includes(raw);
}

/**
 * Statuses whose secure link may still upload or replace documents.
 *
 * The editable statuses (minus "complete", which never took uploads), plus
 * "approved": the Driver Portal now opens only at pickup (t466u), so between
 * approval and pickup the secure link is the renter's only way to re-send a
 * blurry license or a new insurance card. Approved renters get documents
 * only — every other field stays locked (replaceApplicantDocument), and the
 * server also refuses once a rental has started.
 */
export const DOCUMENT_UPLOAD_STATUSES = ["partial", "new", "reviewing", "approved"] as const;

export function canUploadBeforePickupStatus(status: unknown): boolean {
  const raw = typeof status === "string" ? status.trim().toLowerCase() : "";
  return (DOCUMENT_UPLOAD_STATUSES as readonly string[]).includes(raw);
}

/** Approved, not picked up: the secure link opens a documents-only page. */
export function isDocumentsOnlyStatus(status: unknown): boolean {
  const raw = typeof status === "string" ? status.trim().toLowerCase() : "";
  return raw === "approved";
}
