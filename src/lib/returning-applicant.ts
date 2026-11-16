/**
 * What a lead form does when the email typed matches an application we
 * already have (Dolmar, t316u).
 *
 * Before: always email a link to the matched record. For a closed, declined
 * or merged record that link opened "Your Application Is Already Submitted"
 * with no way forward, and the email greeted them by the old record's name.
 *
 * Now:
 *   resume        the match is still in progress (or our own missing-items
 *                 auto-close, which reopens when they come back): link to it.
 *   fresh         the match is closed or merged away: start a new application
 *                 from what they just typed and email the link for THAT one.
 *   fresh_review  the match was declined: same as fresh, plus an open staff
 *                 review on the new application. Decisions stay with staff.
 *
 * Approved, active and suspended stay "resume": approved/active already get
 * the portal sign-in email instead of the wizard, and a suspended renter is a
 * staff conversation, not a second application.
 *
 * Security is unchanged: the anonymous caller never gets a token. Every path
 * emails a single-use link to the address on the application, which here is
 * the address they typed, so clicking it proves they own that email. The new
 * application holds only what they typed; nothing from the old one is copied.
 *
 * Client-safe: no database, no server imports.
 */
import { isApplicantEditableStatus } from "@/lib/application-edit-status";

export type ReturningAction = "resume" | "fresh" | "fresh_review";

export const FRESH_AFTER_STATUSES = ["closed", "duplicate"] as const;
export const REVIEW_AFTER_STATUSES = ["declined"] as const;

export function returningAction(status: unknown, autoClosedPending = false): ReturningAction {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (isApplicantEditableStatus(s)) return "resume";
  // Our missing-items auto-close reopens the record when they use the link.
  if (s === "closed" && autoClosedPending) return "resume";
  if ((FRESH_AFTER_STATUSES as readonly string[]).includes(s)) return "fresh";
  if ((REVIEW_AFTER_STATUSES as readonly string[]).includes(s)) return "fresh_review";
  return "resume";
}

/** Identity-review kind filed on the new application after a decline. */
export const REAPPLIED_AFTER_DECLINE = "reapplied_after_decline";
