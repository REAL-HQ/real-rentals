// Insurance verification authority. Client-safe.
//
// The final insurance verification decision is driver_screenings.insurance_verified and its
// insurance_verified_at / insurance_verified_by stamps. Only a Manager or Owner makes it, through
// setInsuranceVerification (server, requireManager) and public.set_insurance_verification
// (database, private.is_manager(), audited in the same transaction). Coordinators may still enter
// and update the insurance information fields, and may request verification.

/** The decision columns. Never sent from the browser: client writes strip them. */
export const INSURANCE_DECISION_FIELDS = [
  "insurance_verified",
  "insurance_verified_at",
  "insurance_verified_by",
] as const;

/** A copy of a screening row/patch without the decision columns, for direct client writes. */
export function withoutInsuranceDecision<T extends Record<string, unknown>>(
  row: T,
): Omit<T, (typeof INSURANCE_DECISION_FIELDS)[number]> {
  const copy: Record<string, unknown> = { ...row };
  for (const k of INSURANCE_DECISION_FIELDS) delete copy[k];
  return copy as Omit<T, (typeof INSURANCE_DECISION_FIELDS)[number]>;
}

/** Normalised policy number reference for audit: last 4 characters only, never the full number. */
export function policyNumberLast4(policy: string | null | undefined): string | null {
  const p = String(policy ?? "")
    .replace(/\s/g, "")
    .toUpperCase();
  return p ? p.slice(-4) : null;
}
