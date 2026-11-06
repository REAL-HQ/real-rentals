/**
 * What /thank-you says about a resume link.
 *
 * No token is not a failed token. A bare /thank-you asks for an email.
 * A token we were given and could not open keeps the expired wording.
 */

export type ThankYouView = "wait" | "missing" | "expired" | "wizard";

export function thankYouView(token: string | null | undefined): ThankYouView {
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
