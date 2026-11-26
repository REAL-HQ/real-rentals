/**
 * After pickup, renters use the Driver Portal (/login), not a resume token.
 * Before pickup (approved included) the secure link stays their way in for
 * documents (t466u).
 */

import { isPortalHandoffStatus } from "@/lib/application-resume-flag";
import { publicAppUrl } from "@/lib/public-app-url";

/** Public sign-in URL, optionally with the email prefilled. No auto-login. */
export function portalLoginUrl(email?: string | null): string {
  const base = publicAppUrl("/login");
  const trimmed = String(email ?? "").trim().toLowerCase();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return base;
  return `${base}?email=${encodeURIComponent(trimmed)}`;
}

export type HandoffApp = {
  id?: string | null;
  status?: string | null;
  email?: string | null;
  user_id?: string | null;
};

/**
 * True when this application should use /login → portal instead of the
 * secure link: only once the renter has picked up the car (t466u). Status
 * active, or a started rental on the application.
 *
 * A linked login or the driver role no longer counts on its own: Reserved
 * creates the login (rentals need a driver id) well before pickup, and that
 * renter still uses the secure link for documents until pickup.
 */
export async function shouldHandoffToPortal(
  admin: { from: (table: string) => any },
  app: HandoffApp | null | undefined,
): Promise<boolean> {
  if (!app) return false;
  if (isPortalHandoffStatus(app.status)) return true;
  const id = typeof app.id === "string" ? app.id : "";
  if (!id) return false;
  const { applicationPickedUp } = await import("@/lib/portal-pickup-gate.server");
  return applicationPickedUp(admin, id, app.status ?? null);
}
