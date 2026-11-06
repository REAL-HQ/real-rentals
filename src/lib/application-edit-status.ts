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

export function isApplicantEditableStatus(status: unknown): boolean {
  const raw = typeof status === "string" ? status.trim().toLowerCase() : "";
  return (APPLICANT_EDITABLE_STATUSES as readonly string[]).includes(raw);
}
