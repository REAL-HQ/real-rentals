// The document count shown next to readiness. One definition, used by
// the Drivers list and the Waitlist so the two can never disagree.
import { REQUIRED_DOC_TYPES, type RequiredDocType } from "@/components/admin/types";

/**
 * Vault categories that must be on file before a driver is treated as
 * document-complete. Insurance is not one of them: Real Rentals sets up the
 * policy after the contract is signed. Staff can still file an insurance
 * document; it is optional and does not change this count. Income proof is
 * required for the Documents receipt summary but remains advisory for activation.
 */
export const REQUIRED_VAULT_CATEGORIES = ["license_front", "gig_profile", "income"] as const;
/**
 * Files that count as proof of income. A gig earnings or trip-history
 * screenshot counts (Dolmar, t306s1653), so an applicant who sent one is never
 * asked for income proof again. Counting is receipt only, never verification.
 */
export const INCOME_PROOF_CATEGORIES = ["income", "trip_history"] as const;
/** The required category a vault category satisfies (trip_history -> income), else itself. */
export function requirementCategory(category: string | null | undefined): string {
  const c = String(category ?? "").trim();
  return (INCOME_PROOF_CATEGORIES as readonly string[]).includes(c) ? "income" : c;
}
/** Accepted and stored, never required: only the front of the license is required. */
export const OPTIONAL_VAULT_CATEGORIES = ["license_back"] as const;
export type RequiredVaultCategory = (typeof REQUIRED_VAULT_CATEGORIES)[number];

/** Vault category -> the required-document name the list counts. */
export const VAULT_TO_REQUIRED: Record<string, string> = {
  gig_profile: "driver_profile_screenshot",
  // A trip-history / gig earnings screenshot is income proof (t306s1653).
  trip_history: "income",
};

type DocRow = { lead_id?: string | null; category?: string | null; review_status?: string | null; is_current?: boolean | null };

/**
 * The required-document name a vault row counts as, or null when it does not
 * count. Current and not rejected. requiredDocCounts turns this name into
 * the document count on the Drivers list and the Waitlist.
 */
export function canonicalRequiredDoc(row: {
  category?: string | null;
  review_status?: string | null;
  is_current?: boolean | null;
}): string | null {
  if (row.is_current === false || row.review_status === "rejected") return null;
  const cat = (row.category ?? "").trim();
  if (!cat) return null;
  const canonical = VAULT_TO_REQUIRED[cat] ?? cat;
  if (!REQUIRED_DOC_TYPES.includes(canonical as RequiredDocType)) return null;
  return canonical;
}

/**
 * Like canonicalRequiredDoc, but an optional license back that was uploaded
 * still counts as a file staff can review. Never used for completeness.
 */
export function canonicalReviewDoc(row: {
  category?: string | null;
  review_status?: string | null;
  is_current?: boolean | null;
}): string | null {
  const required = canonicalRequiredDoc(row);
  if (required) return required;
  if (row.is_current === false || row.review_status === "rejected") return null;
  return (row.category ?? "").trim() === "license_back" ? "license_back" : null;
}

/** Distinct current, non-rejected required documents per applicant. */
export function requiredDocCounts(rows: readonly DocRow[] | null | undefined): Record<string, number> {
  const seen: Record<string, Set<string>> = {};
  for (const r of rows ?? []) {
    const id = r.lead_id;
    const canonical = id ? canonicalRequiredDoc(r) : null;
    if (!id || !canonical) continue;
    (seen[id] ?? (seen[id] = new Set())).add(canonical);
  }
  return Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.size]));
}
