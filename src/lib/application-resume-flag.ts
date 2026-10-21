/**
 * The only declaration of the application-resume switch. It is a hard false.
 * Other files import this module. They do not copy the constant.
 * This file has no database, email, or wizard code, so a flag-off page can
 * import it without loading the resume feature.
 */
export const APPLICATION_RESUME_ENABLED: boolean = false as boolean;

/** Statuses that are no longer an open draft. A resume token is not minted for these. */
export const CLOSED_RESUME_STATUSES = [
  "approved",
  "active",
  "suspended",
  "declined",
  "closed",
  "duplicate",
  "complete",
] as const;

/**
 * Live portal refusal. While resume is off, openMyApplication uses only these.
 * Approved and complete are not here: Review My Application still opens them.
 */
export const BASE_CLOSED_APPLICATION_STATUSES = ["declined", "closed"] as const;

/** Statuses the portal still opens so Review My Application keeps working. */
const REVIEW_APPLICATION_STATUSES = ["approved", "complete"] as const;

export function isClosedResumeStatus(status: unknown): boolean {
  const raw = typeof status === "string" ? status.trim().toLowerCase() : "";
  return (CLOSED_RESUME_STATUSES as readonly string[]).includes(raw);
}

function applicationStatus(status: unknown): string {
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

/**
 * Whether the portal should refuse to open this application.
 * Flag off: declined and closed only.
 * Flag on: the full resume-closed list, except approved and complete. Those
 * two stay open for Review My Application. The wider list only blocks a resume
 * token for a draft that is no longer open.
 */
export function portalOpenRefused(status: unknown, resumeEnabled: boolean): boolean {
  const raw = applicationStatus(status);
  if ((REVIEW_APPLICATION_STATUSES as readonly string[]).includes(raw)) return false;
  const closed = resumeEnabled ? CLOSED_RESUME_STATUSES : BASE_CLOSED_APPLICATION_STATUSES;
  return (closed as readonly string[]).includes(raw);
}
