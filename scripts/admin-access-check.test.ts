// Admin role gate: loading and a failed read must not look like "no staff role".
// Run: bun test scripts/admin-access-check.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  adminAccessScreen,
  applyRoleQuery,
  authEventRechecksRoles,
  loadStaffRoles,
  refreshAuthSession,
  roleCheckMode,
  rolesFromPayload,
} from "../src/lib/admin-access";

const signedIn = { sessionChecking: false, hasSession: true } as const;

describe("loading", () => {
  test("a role check still in flight is loading, not No Access", () => {
    expect(adminAccessScreen({ ...signedIn, roleStatus: "loading", tier: null })).toBe("loading");
    expect(adminAccessScreen({ sessionChecking: true, hasSession: false, roleStatus: "loading", tier: null })).toBe("loading");
  });
});

describe("success", () => {
  test("a staff role opens the admin and does not refresh", async () => {
    let refreshes = 0;
    const result = await loadStaffRoles({
      userId: "user-1",
      queryRoles: async () => rolesFromPayload([{ role: "admin" }], null),
      refreshSession: async () => {
        refreshes += 1;
      },
    });
    expect(refreshes).toBe(0);
    expect(result).toEqual({ ok: true, roles: ["admin"] });
    const applied = applyRoleQuery(result);
    expect(applied).toEqual({ status: "resolved", tier: "owner" });
    expect(adminAccessScreen({ ...signedIn, roleStatus: applied.status, tier: applied.tier })).toBe("admin");
  });
});

describe("empty roles", () => {
  test("a successful read with no staff role is No Access", () => {
    const empty = applyRoleQuery(rolesFromPayload([], null));
    expect(empty).toEqual({ status: "resolved", tier: null });
    expect(adminAccessScreen({ ...signedIn, roleStatus: empty.status, tier: empty.tier })).toBe("no-access");

    const driver = applyRoleQuery({ ok: true, roles: ["driver", "user"] });
    expect(driver).toEqual({ status: "resolved", tier: null });
    expect(adminAccessScreen({ ...signedIn, roleStatus: driver.status, tier: driver.tier })).toBe("no-access");
  });
});

describe("error then retry", () => {
  test("a null payload is a failed read, not an empty grant", () => {
    expect(rolesFromPayload(null, { message: "JWT expired" })).toEqual({ ok: false });
    expect(rolesFromPayload(null, null)).toEqual({ ok: false });
    const applied = applyRoleQuery({ ok: false });
    expect(applied).toEqual({ status: "error", tier: null });
    expect(adminAccessScreen({ ...signedIn, roleStatus: applied.status, tier: applied.tier })).toBe("check-failed");
  });

  test("refreshes the session and retries once", async () => {
    const calls: string[] = [];
    let attempt = 0;
    const result = await loadStaffRoles({
      userId: "user-1",
      queryRoles: async (userId) => {
        calls.push(`query:${userId}`);
        attempt += 1;
        if (attempt === 1) return rolesFromPayload(null, { message: "JWT expired" });
        return rolesFromPayload([{ role: "team" }], null);
      },
      refreshSession: async () => {
        calls.push("refresh");
      },
    });
    expect(calls).toEqual(["query:user-1", "refresh", "query:user-1"]);
    const applied = applyRoleQuery(result);
    expect(applied).toEqual({ status: "resolved", tier: "manager" });
    expect(adminAccessScreen({ ...signedIn, roleStatus: applied.status, tier: applied.tier })).toBe("admin");
  });

  test("a second failure stays check-failed and never refreshes again", async () => {
    let queries = 0;
    let refreshes = 0;
    const result = await loadStaffRoles({
      userId: "user-1",
      queryRoles: async () => {
        queries += 1;
        throw new Error("aborted");
      },
      refreshSession: async () => {
        refreshes += 1;
        throw new Error("refresh failed");
      },
    });
    expect(queries).toBe(2);
    expect(refreshes).toBe(1);
    expect(result).toEqual({ ok: false });
    const applied = applyRoleQuery(result);
    expect(adminAccessScreen({ ...signedIn, roleStatus: applied.status, tier: applied.tier })).toBe("check-failed");
  });

  test("refreshSession falls back to getSession when it yields no session", async () => {
    const seen: string[] = [];
    const token = await refreshAuthSession({
      refreshSession: async () => {
        seen.push("refreshSession");
        return { data: { session: null }, error: { message: "expired" } };
      },
      getSession: async () => {
        seen.push("getSession");
        return { data: { session: { access_token: "stored-token" } } };
      },
    });
    expect(seen).toEqual(["refreshSession", "getSession"]);
    expect(token).toBe("stored-token");
  });

  test("a successful refreshSession does not also call getSession", async () => {
    let got = 0;
    const token = await refreshAuthSession({
      refreshSession: async () => ({ data: { session: { access_token: "fresh-token" } }, error: null }),
      getSession: async () => {
        got += 1;
      },
    });
    expect(got).toBe(0);
    expect(token).toBe("fresh-token");
  });
});

describe("auth events", () => {
  test("TOKEN_REFRESHED and SIGNED_IN recheck; a resolved user stays on screen", () => {
    expect(authEventRechecksRoles("TOKEN_REFRESHED")).toBe(true);
    expect(authEventRechecksRoles("SIGNED_IN")).toBe(true);
    expect(authEventRechecksRoles("SIGNED_OUT")).toBe(false);
    expect(authEventRechecksRoles("INITIAL_SESSION")).toBe(false);
    expect(roleCheckMode("TOKEN_REFRESHED", true)).toBe("quiet");
    expect(roleCheckMode("SIGNED_IN", true)).toBe("quiet");
    expect(roleCheckMode("SIGNED_IN", false)).toBe("blocking");
  });
});

describe("admin route", () => {
  test("the page gates No Access on a resolved empty read and offers Retry after an error", () => {
    const src = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    expect(src).toContain("adminAccessScreen");
    expect(src).toContain("loadStaffRoles");
    expect(src).toContain("authEventRechecksRoles");
    expect(src).toContain("Couldn't Check Access");
    expect(src).toContain(">Retry<");
    expect(src).toContain(">Sign Out<");
    expect(src).toMatch(/accessScreen === "check-failed"[\s\S]*?<AccessCheckFailed/);
    expect(src).toMatch(/accessScreen === "no-access"[\s\S]*?<NoAccess/);
    expect(src).not.toMatch(/if \(!isAdmin\) return <NoAccess/);
    expect(src).not.toMatch(/text-transform:\s*uppercase/);
  });
});
