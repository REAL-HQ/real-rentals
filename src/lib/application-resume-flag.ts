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

export function isClosedResumeStatus(status: unknown): boolean {
  const raw = typeof status === "string" ? status.trim().toLowerCase() : "";
  return (CLOSED_RESUME_STATUSES as readonly string[]).includes(raw);
}
