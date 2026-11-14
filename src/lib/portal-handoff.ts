/**
 * After approval, applicants use the Driver Portal (/login), not a resume token.
 * Resume links stay for unfinished drafts only.
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
  status?: string | null;
  email?: string | null;
  user_id?: string | null;
};

/**
 * True when this application should use /login → portal instead of a resume wizard.
 * Status approved/active, or a linked account that already holds the driver role.
 */
export async function shouldHandoffToPortal(
  admin: { from: (table: string) => any },
  app: HandoffApp | null | undefined,
): Promise<boolean> {
  if (!app) return false;
  if (isPortalHandoffStatus(app.status)) return true;
  const userId = typeof app.user_id === "string" ? app.user_id : "";
  if (!userId) return false;
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "driver")
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}
