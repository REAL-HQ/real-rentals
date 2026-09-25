// Role vocabulary shared by client and server.
//
// Kept apart from roles.server.ts because that file imports the service-role
// Supabase client — pulling it into a route would drag the admin key into the
// browser bundle. Only names and ordering live here; every actual decision is
// made server-side and in RLS.

export type StaffTier = "owner" | "manager" | "coordinator";

export const TIER_RANK: Record<StaffTier, number> = {
  coordinator: 1,
  manager: 2,
  owner: 3,
};

/** Database role name -> tier. Roles absent here are not staff. */
export const TIER_BY_ROLE: Record<string, StaffTier> = {
  admin: "owner",
  team: "manager",
  coordinator: "coordinator",
};

export const TIER_LABELS: Record<StaffTier, string> = {
  owner: "Owner",
  manager: "Manager",
  coordinator: "Coordinator",
};

export const TIER_SUMMARY: Record<StaffTier, string> = {
  owner: "Full access, including team management, settings and money.",
  manager:
    "Everything operational, including rent, deposits, charges and expenses. Cannot manage the team.",
  coordinator:
    "Applicants, drivers, vehicles, inspections and documents. Cannot see or touch money.",
};

/** Does `have` meet `need`? */
export function tierAllows(have: StaffTier | null, need: StaffTier): boolean {
  if (!have) return false;
  return TIER_RANK[have] >= TIER_RANK[need];
}

/** Strongest tier among a set of granted role names, or null if none apply. */
export function tierFromRoles(roles: string[]): StaffTier | null {
  let best: StaffTier | null = null;
  for (const r of roles) {
    const t = TIER_BY_ROLE[r];
    if (!t) continue;
    if (!best || TIER_RANK[t] > TIER_RANK[best]) best = t;
  }
  return best;
}
