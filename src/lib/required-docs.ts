// The "x/4" document count shown next to readiness. One definition, used by
// the Drivers list and the Waitlist so the two can never disagree.
import { REQUIRED_DOC_TYPES, type RequiredDocType } from "@/components/admin/types";

/** Vault category -> the required-document name the list counts. */
export const VAULT_TO_REQUIRED: Record<string, string> = {
  insurance: "insurance_card",
  gig_profile: "driver_profile_screenshot",
};

type DocRow = { lead_id?: string | null; category?: string | null; review_status?: string | null; is_current?: boolean | null };

/** Distinct current, non-rejected required documents per applicant. */
export function requiredDocCounts(rows: readonly DocRow[] | null | undefined): Record<string, number> {
  const seen: Record<string, Set<string>> = {};
  for (const r of rows ?? []) {
    const id = r.lead_id;
    if (!id || r.is_current === false || r.review_status === "rejected") continue;
    const cat = (r.category ?? "").trim();
    const canonical = VAULT_TO_REQUIRED[cat] ?? cat;
    if (!REQUIRED_DOC_TYPES.includes(canonical as RequiredDocType)) continue;
    (seen[id] ?? (seen[id] = new Set())).add(canonical);
  }
  return Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.size]));
}
