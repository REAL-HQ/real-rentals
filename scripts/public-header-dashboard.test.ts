import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  isAppShellPath,
  isPublicSitePath,
  publicDashboardHref,
} from "../src/components/site/public-dashboard";

const nav = readFileSync(new URL("../src/components/site/Nav.tsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
const portal = readFileSync(new URL("../src/routes/portal.tsx", import.meta.url), "utf8");
const partner = readFileSync(new URL("../src/routes/partner.tsx", import.meta.url), "utf8");

describe("publicDashboardHref role routing", () => {
  test("staff with admin or team go to the back office", () => {
    expect(publicDashboardHref(["admin"])).toBe("/admin");
    expect(publicDashboardHref(["team"])).toBe("/admin");
    expect(publicDashboardHref(["admin", "driver"])).toBe("/admin");
    expect(publicDashboardHref(["team", "partner"])).toBe("/admin");
  });

  test("partners without staff roles go to the partner portal", () => {
    expect(publicDashboardHref(["partner"])).toBe("/partner");
    expect(publicDashboardHref(["partner", "driver"])).toBe("/partner");
  });

  test("drivers without staff or partner roles go to the driver portal", () => {
    expect(publicDashboardHref(["driver"])).toBe("/portal");
  });

  test("owner, manager, coordinator, or unknown roles fall back to the back office", () => {
    expect(publicDashboardHref(["owner"])).toBe("/admin");
    expect(publicDashboardHref(["manager"])).toBe("/admin");
    expect(publicDashboardHref(["coordinator"])).toBe("/admin");
    expect(publicDashboardHref([])).toBe("/admin");
  });
});

describe("public vs app-shell paths", () => {
  test("marketing and homepage paths use the public header", () => {
    for (const path of ["/", "/fleet", "/fleet/abc", "/how-it-works", "/faq", "/partners", "/contact", "/privacy", "/terms", "/sms-consent", "/miami"]) {
      expect(isPublicSitePath(path)).toBe(true);
      expect(isAppShellPath(path)).toBe(false);
    }
  });

  test("back office and portals keep their own headers", () => {
    for (const path of ["/admin", "/admin/", "/admin/x", "/portal", "/portal/", "/partner", "/partner/"]) {
      expect(isAppShellPath(path)).toBe(true);
      expect(isPublicSitePath(path)).toBe(false);
    }
  });

  test("/partners is the marketing page, not the partner portal", () => {
    expect(isAppShellPath("/partners")).toBe(false);
    expect(isPublicSitePath("/partners")).toBe(true);
  });
});

describe("public Nav when logged in", () => {
  test("uses the role helper and a Dashboard button in the public header branch", () => {
    expect(nav).toContain('import { isPublicSitePath, publicDashboardHref } from "./public-dashboard"');
    expect(nav).toContain("const publicHeader = isPublicSitePath(location.pathname)");
    expect(nav).toContain("const accountHref = publicDashboardHref(roles)");
    expect(nav).toMatch(/publicHeader \? \([\s\S]*?<Link to=\{accountHref\}[\s\S]*?>\s*Dashboard\s*<\/Link>/);
  });

  test("Dashboard uses the same red header button style as Book Now", () => {
    expect(nav).toContain('headerCtaClass');
    expect(nav).toContain('bg-real-red px-4 text-[13px] font-medium text-white');
    expect(nav).toMatch(/<Link to=\{accountHref\} className=\{headerCtaClass\}>/);
    expect(nav).toMatch(/to="\/apply"\s+className=\{headerCtaClass\}/);
  });

  test("logged-in public header keeps the site hamburger to the right of Dashboard", () => {
    expect(nav).toContain("const showSiteMenu = !isCityPage && (!session || publicHeader)");
    const rightCluster = nav.slice(nav.indexOf('className="flex items-center gap-3"'));
    const publicStart = rightCluster.indexOf("publicHeader ?");
    const appStart = rightCluster.indexOf(") : (", publicStart);
    const publicBranch = rightCluster.slice(publicStart, appStart);
    expect(publicBranch).toContain("Dashboard");
    expect(publicBranch).not.toContain("MessageSquare");
    expect(publicBranch).not.toContain("Bell");
    expect(publicBranch).not.toContain('aria-label="Profile"');
    expect(publicBranch).not.toContain("Sign Out");
    expect(rightCluster.indexOf("Dashboard")).toBeLessThan(rightCluster.indexOf("{showSiteMenu &&"));
  });

  test("logged-out public header is unchanged", () => {
    expect(nav).toContain("Log In");
    expect(nav).toContain("Book Now");
    expect(nav).toContain('to="/admin"');
    expect(nav).toContain('to="/apply"');
    expect(nav).toContain('aria-label="Menu"');
  });

  test("app-shell Nav still has messages, notifications, profile, and sign out", () => {
    const appBranch = nav.slice(nav.indexOf("publicHeader ?"), nav.indexOf(") : !session"));
    // The non-public signed-in branch is the else of publicHeader
    expect(appBranch).toContain("MessageSquare");
    expect(appBranch).toContain("Bell");
    expect(appBranch).toContain('aria-label="Profile"');
    expect(appBranch).toContain("Sign Out");
    expect(appBranch).toContain("handleSignOut");
  });
});

describe("back-office and portal headers are not rewritten", () => {
  test("admin chrome still has its own Log Out control", () => {
    expect(admin).toContain("Log Out");
    expect(admin).toContain("async function signOut()");
  });

  test("driver and partner portals still have their own Sign Out controls", () => {
    expect(portal).toContain("Sign Out");
    expect(partner).toContain("Sign Out");
  });
});
