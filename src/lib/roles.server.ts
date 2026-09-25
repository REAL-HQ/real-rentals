// Server-side role checks, in one place.
//
// Every panel used to carry its own copy of `assertStaff`, each querying
// user_roles with its own hardcoded list of role names. That worked while
// there were two roles; with three tiers it is how a Coordinator ends up
// reading the ledger because one file's list was never updated.
//
// The database is still the real boundary — RLS gates every table by
// private.is_staff() / is_manager() / is_owner(). These helpers exist because
// server functions run through supabaseAdmin (the service role), which
// bypasses RLS entirely. Anything reached that way must check for itself, and
// should check the same way everywhere.

// The vocabulary itself lives in roles.ts so routes can import it without
// dragging the service-role client into the browser bundle.
import { TIER_BY_ROLE, TIER_RANK, TIER_LABELS, TIER_SUMMARY, type StaffTier } from "@/lib/roles";

export type { StaffTier };

export type Actor = {
  userId: string;
  email: string | null;
  role: string;
  tier: StaffTier;
};

/**
 * Resolve the signed-in user's staff tier, or null if they have none.
 * Reads through the service role so it works from any server function.
 */
export async function getActor(userId: string): Promise<Actor | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: rows } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  const roles = (rows ?? []).map((r: any) => String(r.role));
  // Somebody may hold more than one grant; the strongest one wins.
  const role =
    roles.find((r) => r === "admin") ??
    roles.find((r) => r === "team") ??
    roles.find((r) => r === "coordinator");
  if (!role) return null;

  let email: string | null = null;
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    email = data?.user?.email ?? null;
  } catch {
    // The tier is what callers gate on; a missing email only costs us a
    // nicer audit entry.
  }

  return { userId, email, role, tier: TIER_BY_ROLE[role] };
}

/**
 * Require at least `minimum`. Returns the actor so callers can attribute the
 * action in the audit log without a second lookup.
 */
export async function requireTier(userId: string, minimum: StaffTier): Promise<Actor> {
  const actor = await getActor(userId);
  if (!actor) throw new Error("Forbidden");
  if (TIER_RANK[actor.tier] < TIER_RANK[minimum]) throw new Error("Forbidden");
  return actor;
}

/** Back-office access of any kind. */
export const requireStaff = (userId: string) => requireTier(userId, "coordinator");
/** Anything involving money. */
export const requireManager = (userId: string) => requireTier(userId, "manager");
/** Team management and settings. */
export const requireOwner = (userId: string) => requireTier(userId, "owner");

export { TIER_LABELS, TIER_SUMMARY };
