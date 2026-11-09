/**
 * Portal Pictures IA helpers. Pure — no I/O.
 *
 * DB phases stay fleet-sense (checkout = pickup, checkin = return).
 * UI labels use Pickup / Return / Issues.
 */

export type ConditionPhaseKey = "checkout" | "checkin" | "damage" | "other";
export type ConditionSectionKey = "pickup" | "return" | "during";
export type CapturedByRole = "staff" | "driver";

export const CONDITION_SECTIONS: Array<{
  key: ConditionSectionKey;
  title: string;
  phases: ConditionPhaseKey[];
  /** Default phase when the renter uploads into this section. */
  uploadPhase: ConditionPhaseKey;
  blurb: string;
}> = [
  {
    key: "pickup",
    title: "Pickup",
    phases: ["checkout"],
    uploadPhase: "checkout",
    blurb: "Photos taken before you drive off with the car.",
  },
  {
    key: "return",
    title: "Return",
    phases: ["checkin"],
    uploadPhase: "checkin",
    blurb: "Photos when you bring the car back.",
  },
  {
    key: "during",
    title: "Issues",
    phases: ["damage", "other"],
    uploadPhase: "damage",
    blurb: "Accidents, damage, or other problems with the car.",
  },
];

export function sectionForPhase(phase: string | null | undefined): ConditionSectionKey {
  const p = String(phase ?? "").toLowerCase();
  if (p === "checkout") return "pickup";
  if (p === "checkin") return "return";
  return "during";
}

export function phaseLabel(phase: string | null | undefined): string {
  const p = String(phase ?? "").toLowerCase();
  if (p === "checkout") return "Pickup";
  if (p === "checkin") return "Return";
  if (p === "damage") return "Damage";
  if (p === "other") return "Other";
  return "Photo";
}

export function roleLabel(role: string | null | undefined): string {
  const r = String(role ?? "").toLowerCase();
  if (r === "staff") return "Ours";
  if (r === "driver") return "Yours";
  return "Photo";
}

/** Subsection titles — keep to one word. */
export const ROLE_SUBSECTION = { staff: "Ours", driver: "Yours" } as const;

export function isStaffRole(role: string | null | undefined): boolean {
  return String(role ?? "").toLowerCase() === "staff";
}

export type GroupablePhoto = {
  id: string;
  phase: string | null;
  capturedByRole?: string | null;
};

/** Split one section's photos into Ours vs Yours. */
export function splitByRole<T extends GroupablePhoto>(photos: T[]): { staff: T[]; driver: T[] } {
  const staff: T[] = [];
  const driver: T[] = [];
  for (const p of photos) {
    if (isStaffRole(p.capturedByRole)) staff.push(p);
    else driver.push(p);
  }
  return { staff, driver };
}

/** Group a flat photo list into the three portal sections (damage/other ≠ Return). */
export function groupConditionPhotos<T extends GroupablePhoto>(
  photos: T[],
): Record<ConditionSectionKey, { staff: T[]; driver: T[] }> {
  const buckets: Record<ConditionSectionKey, T[]> = {
    pickup: [],
    return: [],
    during: [],
  };
  for (const p of photos) {
    buckets[sectionForPhase(p.phase)].push(p);
  }
  return {
    pickup: splitByRole(buckets.pickup),
    return: splitByRole(buckets.return),
    during: splitByRole(buckets.during),
  };
}
