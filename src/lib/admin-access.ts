// Back-office role gate. A staff tier comes only from a successful user_roles
// read. Loading and failed reads are their own states: both used to fall
// through `tierFromRoles([])` and render No Access, including a stale token
// right after a deploy (data=null, error ignored).

import { tierFromRoles, type StaffTier } from "./roles";

export type RoleCheckStatus = "loading" | "resolved" | "error";

export type RoleQueryResult = { ok: true; roles: string[] } | { ok: false };

export type AppliedRoleCheck =
  | { status: "resolved"; tier: StaffTier | null }
  | { status: "error"; tier: null };

export type AdminAccessScreen = "loading" | "sign-in" | "check-failed" | "no-access" | "admin";

/** What the back office shows. No Access only after a successful read with no staff role. */
export function adminAccessScreen(input: {
  sessionChecking: boolean;
  hasSession: boolean;
  roleStatus: RoleCheckStatus;
  tier: StaffTier | null;
}): AdminAccessScreen {
  if (input.sessionChecking) return "loading";
  if (!input.hasSession) return "sign-in";
  if (input.roleStatus === "loading") return "loading";
  if (input.roleStatus === "error") return "check-failed";
  if (!input.tier) return "no-access";
  return "admin";
}

/**
 * Interpret one user_roles payload. Null data is a failed read, not an empty
 * grant — aborted and stale-token requests arrive as data=null.
 */
export function rolesFromPayload(data: unknown, error: unknown): RoleQueryResult {
  if (error) return { ok: false };
  if (!Array.isArray(data)) return { ok: false };
  return {
    ok: true,
    roles: data.map((row) => {
      if (row && typeof row === "object" && "role" in row && row.role != null) return String(row.role);
      return "";
    }),
  };
}

/** Strongest staff tier in a successful read. A failed read stays an error. */
export function applyRoleQuery(result: RoleQueryResult): AppliedRoleCheck {
  if (!result.ok) return { status: "error", tier: null };
  return { status: "resolved", tier: tierFromRoles(result.roles) };
}

/**
 * Read staff roles. On failure, refresh the session and try once more.
 * A second failure is an error, never "no role".
 */
export async function loadStaffRoles(args: {
  userId: string;
  queryRoles: (userId: string) => Promise<RoleQueryResult>;
  refreshSession: () => Promise<void>;
}): Promise<RoleQueryResult> {
  const once = async (): Promise<RoleQueryResult> => {
    try {
      return await args.queryRoles(args.userId);
    } catch {
      return { ok: false };
    }
  };
  const first = await once();
  if (first.ok) return first;
  try {
    await args.refreshSession();
  } catch {
    // The refresh itself can fail on a stale token. The query still gets one retry.
  }
  const second = await once();
  if (second.ok) return second;
  return { ok: false };
}

function accessToken(session: unknown): string | null {
  if (!session || typeof session !== "object" || !("access_token" in session)) return null;
  const token = session.access_token;
  return typeof token === "string" && token ? token : null;
}

/** refreshSession first; getSession when that does not yield a session. Returns the access token when one is available. */
export async function refreshAuthSession(auth: {
  refreshSession: () => Promise<{ data: { session?: unknown } | null; error: unknown }>;
  getSession: () => Promise<unknown>;
}): Promise<string | null> {
  try {
    const result = await auth.refreshSession();
    const token = accessToken(result.data?.session);
    if (!result.error && token) return token;
  } catch {
    // Fall through to the stored session, then the one query retry.
  }
  try {
    const stored = await auth.getSession();
    if (stored && typeof stored === "object" && "data" in stored) {
      const data = stored.data;
      if (data && typeof data === "object" && "session" in data) return accessToken(data.session);
    }
  } catch {
    // The retry query reports the failure if the session is still bad.
  }
  return null;
}

/** TOKEN_REFRESHED and SIGNED_IN carry a new credential and must re-read roles. */
export function authEventRechecksRoles(event: string): event is "TOKEN_REFRESHED" | "SIGNED_IN" {
  return event === "TOKEN_REFRESHED" || event === "SIGNED_IN";
}

/** Keep the current screen up while rechecking a user we already resolved. */
export function roleCheckMode(
  event: "TOKEN_REFRESHED" | "SIGNED_IN",
  alreadyResolvedForUser: boolean,
): "blocking" | "quiet" {
  if (alreadyResolvedForUser && (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")) return "quiet";
  return "blocking";
}
