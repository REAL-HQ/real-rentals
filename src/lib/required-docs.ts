// The "x/4" document count shown next to readiness. One definition, used by
// the Drivers list and the Waitlist so the two can never disagree.
import { REQUIRED_DOC_TYPES, type RequiredDocType } from "@/components/admin/types";

/** Vault category -> the required-document name the list counts. */
export const VAULT_TO_REQUIRED: Record<string, string> = {
  insurance: "insurance_card",
  gig_profile: "driver_profile_screenshot",
};

type DocRow = { lead_id?: string | null; category?: string | null; review_status?: string | null; is_current?: boolean | null };

/**
 * The required-document name a vault row counts as, or null when it does not
 * count. Current and not rejected. The Drivers list, the Waitlist, and the
 * application document gaps all use this so a row cannot be "2/4" in one
 * place and missing in another.
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
