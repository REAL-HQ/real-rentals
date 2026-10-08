// Experience = which UI a signed-in person is looking at. It is a VIEW choice
// only: it never changes the auth token, roles, RLS or server checks. A
// Manager in "Admin" is still a Manager; an Owner in "Admin" or "Driver" is
// still an Owner on every request.
import type { StaffTier } from "@/lib/roles";

export type Experience = "owner" | "admin" | "driver";

export const EXPERIENCE_LABELS: Record<Experience, string> = {
  owner: "Owner",
  admin: "Admin",
  driver: "Driver",
};

/** Which experiences this account may open (driver preview for Owner/Manager only). */
export function availableExperiences(tier: StaffTier | null, isDriver: boolean): Experience[] {
  if (tier === "owner") return ["owner", "admin", "driver"];
  if (tier === "manager") return ["admin", "driver"];
  if (tier === "coordinator") return ["admin"];
  return isDriver ? ["driver"] : [];
}

export function defaultExperience(tier: StaffTier | null, isDriver: boolean): Experience | null {
  return availableExperiences(tier, isDriver)[0] ?? null;
}

const KEY = "rr-experience";
export function readStoredExperience(): Experience | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(KEY);
  return v === "owner" || v === "admin" || v === "driver" ? v : null;
}
export function storeExperience(e: Experience) {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, e);
}

/** Stored choice if still allowed, else the authorized default. */
export function resolveExperience(tier: StaffTier | null, isDriver: boolean): Experience | null {
  const allowed = availableExperiences(tier, isDriver);
  const s = readStoredExperience();
  return s && allowed.includes(s) ? s : allowed[0] ?? null;
}

/**
 * Tier used only to decide which navigation to DRAW. Owner in Admin view sees
 * the Manager-level layout. Never passed to servers; never broadens.
 */
export function navTierFor(tier: StaffTier | null, exp: Experience | null): StaffTier | null {
  if (tier === "owner" && exp === "admin") return "manager";
  return tier;
}
