/**
 * Driver Portal access opens at pickup (Dolmar, t463u / t466u).
 *
 * Before the renter has picked up the car nobody gets portal login details
 * and nobody can sign in to the portal. Until then the renter uses the secure
 * application link (resume link) to upload or replace documents, and staff
 * keep adding the signed agreement, insurance and receipts to their record so
 * everything is already there when access opens.
 *
 * "Picked up" means a rental for the application has started: the
 * application is active, or a rental exists that is neither an open
 * reservation nor cancelled (active, or closed after a return).
 *
 * Client-safe: no database, no server imports. The readers live in
 * portal-pickup-gate.server.ts.
 */

/** Rental statuses that do NOT mean the car was picked up. */
export const NOT_PICKED_UP_RENTAL_STATUSES = ["reserved", "cancelled", "canceled"] as const;

export function rentalMeansPickedUp(status: unknown): boolean {
  const raw = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (!raw) return false;
  return !(NOT_PICKED_UP_RENTAL_STATUSES as readonly string[]).includes(raw);
}

/** Pure decision: an active application, or any started rental. */
export function pickedUpFrom(applicationStatus: unknown, rentalStatuses: readonly unknown[]): boolean {
  const app = typeof applicationStatus === "string" ? applicationStatus.trim().toLowerCase() : "";
  if (app === "active") return true;
  return rentalStatuses.some(rentalMeansPickedUp);
}

/** Shown on /login and /portal to anyone who has not picked up yet. */
export const PORTAL_OPENS_AT_PICKUP_TITLE = "Your Driver Portal Opens At Pickup";
export const PORTAL_OPENS_AT_PICKUP_MESSAGE =
  "Your driver portal opens once your rental is paid at pickup. Until then, use the secure link we email you to upload or replace documents. Enter your email on the sign-in page and we'll send a fresh one.";
