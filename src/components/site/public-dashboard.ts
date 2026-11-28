/**
 * Public-site Dashboard button: where it goes, and when the simplified
 * public header applies. App shells (/admin, /portal, /partner) keep their
 * existing headers, including sign out.
 */

export type PublicDashboardHref = "/admin" | "/partner" | "/portal";

/** Same role routing the public header already used for the account link. */
export function publicDashboardHref(roles: readonly string[]): PublicDashboardHref {
  const isAdmin = roles.includes("admin") || roles.includes("team");
  const isPartner = roles.includes("partner");
  const isDriver = roles.includes("driver");
  if (isAdmin) return "/admin";
  if (isPartner) return "/partner";
  if (isDriver) return "/portal";
  return "/admin";
}

/** Staff back office and renter/partner portals, not public marketing pages. */
export function isAppShellPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return (
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/portal" ||
    path.startsWith("/portal/") ||
    path.startsWith("/portal_") ||
    path === "/partner" ||
    path.startsWith("/partner/")
  );
}

export function isPublicSitePath(pathname: string): boolean {
  return !isAppShellPath(pathname);
}
