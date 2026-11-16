/**
 * What /thank-you says about a resume link.
 *
 * No token is not a failed token. A bare /thank-you asks for an email.
 * A token we were given and could not open keeps the expired wording.
 * An approved/active application sends people to /login instead of the wizard.
 */

export type ThankYouView = "wait" | "missing" | "expired" | "wizard" | "approved";

export function thankYouView(
  token: string | null | undefined,
  portal?: { email: string } | null,
): ThankYouView {
  if (portal) return "approved";
  if (token === undefined) return "wait";
  if (token === null) return "missing";
  if (token === "") return "expired";
  return "wizard";
}

export type SecureLinkKind = "expired" | "missing" | "continue";

export function secureLinkKind(expired: boolean, missing: boolean): SecureLinkKind {
  if (expired) return "expired";
  if (missing) return "missing";
  return "continue";
}

export function secureLinkHeading(kind: SecureLinkKind): string {
  if (kind === "expired") return "Get A New Secure Link";
  if (kind === "missing") return "Get A Secure Link To Your Application";
  return "Check Your Email To Continue";
}

export function secureLinkBody(kind: SecureLinkKind): string {
  if (kind === "expired") {
    return "This link has expired or was already used. Enter your email and, if it matches an application, we'll send a fresh secure link.";
  }
  if (kind === "missing") {
    return "Enter your email and, if it matches an application, we'll send a secure link.";
  }
  return "For your security, we continue applications through a secure link sent to the email on the application.";
}

/**
 * Mask an address the applicant just typed, for display only:
 * "dolmar@gmail.com" -> "d•••@gmail.com". Never used to send.
 */
export function maskEmail(email: string | null | undefined): string {
  const e = String(email ?? "").trim();
  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1) return "your email";
  return `${e[0]}•••@${e.slice(at + 1)}`;
}

/**
 * Returning applicant on a lead form: they typed an email that already has an
 * application, so a secure link went to that same address. They already gave
 * us the email, so we never ask for it again; Resend reuses it.
 *
 * Only used when the submitted email matched the record (statuses sent /
 * recent / failed / requested). A phone-only match ("review") still uses the
 * neutral panel with an email box, because the address on file is different.
 */
export type ReturningStatus = "sent" | "recent" | "failed" | "requested";

export const RETURNING_HEADING = "Welcome Back";

export function returningBody(masked: string, fresh = false): string {
  if (fresh) {
    return `Looks like you've applied with us before. To keep your information safe, we sent a secure link to ${masked}. Open it to start your new application.`;
  }
  return `Looks like you've already started an application with us. We sent a secure link to ${masked} to pick up where you left off.`;
}

export function returningStatusLine(status: ReturningStatus, masked: string): string {
  if (status === "recent") {
    return `We recently sent a link to ${masked}. Please check your inbox, Spam or Promotions folder.`;
  }
  if (status === "failed") {
    return `We couldn't send the email to ${masked} just now. Please try again when the button is ready, or contact us below.`;
  }
  if (status === "requested") {
    return `A new secure link is on its way to ${masked}. It works once and expires in 30 minutes. Check Spam or Promotions too.`;
  }
  return "It works once and expires in 30 minutes. It can take a few minutes, so please check your Spam or Promotions folder too.";
}

/** Show the email-on-file flow (no email box) only when we have the address and it matched. */
export function isReturningPanel(email: string | null | undefined, status: string | null | undefined): boolean {
  return Boolean(email && /^\S+@\S+\.\S+$/.test(email.trim()) && status && status !== "review");
}
