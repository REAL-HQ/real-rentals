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

/**
 * Part 1 is already in: the application is with our team (Yolanda Pino,
 * Nov 27). Statuses "reviewing", or an open status whose wizard step is past
 * Part 1. Used for copy only (the resume email, the profile page): it never
 * changes who gets a link or what the link can do.
 */
const SUBMITTED_STEPS = ["submitted", "documents", "profile_complete", "review", "complete", "confirmation", "done"] as const;

export function isAlreadySubmittedApplication(app: { status?: unknown; current_step?: unknown } | null | undefined): boolean {
  if (!app) return false;
  const status = typeof app.status === "string" ? app.status.trim().toLowerCase() : "";
  if (status === "reviewing") return true;
  if (!isApplicantEditableStatus(status)) return false;
  const step = typeof app.current_step === "string" ? app.current_step.trim().toLowerCase() : "";
  return (SUBMITTED_STEPS as readonly string[]).includes(step);
}

/**
 * Shown under "Welcome Back" when a lead form matched an in-progress
 * application. Same words for every match, so it says nothing about the
 * application's status to whoever typed the form.
 */
export const RETURNING_NO_NEED_TO_REAPPLY =
  "Already applied? You don't need to fill out this form again. Open the link in that email to check your application or add another document. Once your application is in, our team calls or texts you to choose your car and pickup time.";

/** Email copy for a resume link to an application that is already submitted. */
export const RESUME_EMAIL_ALREADY_SUBMITTED =
  "Your application is already with our team, so you don't need to apply again or book online. We'll call or text you to choose your car and pickup time. Use this link to check your application or add another document. Every file you add is kept.";

/**
 * Yolanda Pino (Nov 27): a finished profile only offered "Browse Vehicles",
 * whose "Book This Car" opens the lead form, which emails another link back
 * here. Say plainly that there is nothing left to book or re-apply for, and
 * how to ask about a car.
 */
export const PROFILE_ALL_SET_HEADING = "You're All Set. Your Application Is With Our Team.";
export const PROFILE_ALL_SET_BODY =
  "You don't need to apply again or book online. We'll call or text you to choose your car and pickup time. Need to send another document? Open its section below and tap Add Another File. Nothing you already sent is replaced.";
export const PROFILE_CAR_HINT =
  "Like a car you saw? Call or text (888) 833-8280 and tell us which one. There's no need to fill out the application form again.";
