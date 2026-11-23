/**
 * Bad renter email addresses (Dolmar, Nov 22 2026). One rule for every
 * renter-facing email and the lead card's "Bad Email" flag, taken from
 * Missing-Items Outreach: a past bounce or complaint, a common misspelling of
 * a big mail domain, or a reserved test domain. Mailing those again only
 * hurts drivereal.com's sender reputation.
 *
 * One refinement over the Missing-Items list: a delivery AFTER the last bounce
 * clears it (a full inbox or a temporary block that recovered). A complaint
 * never clears.
 */

/** Common misspellings of big mail domains, plus reserved test domains. These never deliver. */
export const UNDELIVERABLE_DOMAINS: ReadonlySet<string> = new Set([
  "gkail.com", "gmail.vom", "gmail.con", "gmail.co", "gmial.com", "gmai.com", "gamil.com", "gnail.com", "fmail.com",
  "yaho.com", "yahoo.con", "hotmal.com", "hotmail.con", "outlok.com", "icloud.con",
]);

export function normEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/** Typo or reserved test domain. */
export function undeliverableDomain(raw: unknown): boolean {
  const dom = normEmail(raw).split("@")[1] ?? "";
  if (!dom) return false;
  return UNDELIVERABLE_DOMAINS.has(dom) || dom.endsWith(".invalid") || dom.endsWith(".test");
}

/** Missing-Items Outreach's check, unchanged: past bounce/complaint set, typo domain, test domain. */
export function isSuppressedEmail(raw: unknown, bad: ReadonlySet<string>): boolean {
  const e = normEmail(raw);
  if (!e.includes("@")) return false;
  return bad.has(e) || undeliverableDomain(e);
}

export type DeliveryHistoryRow = { recipient?: string | null; state: string; created_at: string };
export type BadEmailReason = "complained" | "bounced" | "undeliverable";

/** Why this address should not get automated email, or null. `history` is this address's rows (any order). */
export function badEmailReason(raw: unknown, history: readonly DeliveryHistoryRow[]): BadEmailReason | null {
  const e = normEmail(raw);
  if (!e.includes("@")) return null;
  if (undeliverableDomain(e)) return "undeliverable";
  let lastBounce = "";
  let lastDelivered = "";
  for (const r of history) {
    if (r.recipient != null && normEmail(r.recipient) !== e) continue;
    if (r.state === "complained") return "complained";
    if (r.state === "bounced" && r.created_at > lastBounce) lastBounce = r.created_at;
    if (r.state === "delivered" && r.created_at > lastDelivered) lastDelivered = r.created_at;
  }
  return lastBounce && lastBounce > lastDelivered ? "bounced" : null;
}

/**
 * Workflows that still send to a bad address: staff writing by hand, and the
 * sign-in emails a person asks for themselves (they may have fixed the inbox).
 * Internal team notifications are exempt separately (STAFF_WORKFLOWS).
 */
export const BAD_EMAIL_EXEMPT_WORKFLOWS: ReadonlySet<string> = new Set([
  "staff_message", "password_reset", "signup_confirm", "portal_signin",
]);

export const BAD_EMAIL_SUPPRESSED_ERROR = "bad email: this address bounced before; automated email suppressed";
