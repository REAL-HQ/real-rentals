import { z } from "zod";

/** Pure proposed verification input. This never posts or verifies a live payment. */
export const PICKUP_PAYMENT_VERIFICATION_ENABLED = false;
export const pickupPaymentDraft = z.object({
  applicationId: z.string().uuid(), vehicleId: z.string().uuid(), obligationId: z.string().uuid(),
  method: z.enum(["stripe", "zelle_bank", "cash_app_venmo", "cash", "other"]),
  otherMethod: z.string().trim().max(100).nullable(),
  amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  paidAt: z.string().datetime({ offset: true }), payer: z.string().trim().min(1).max(200),
  reference: z.string().trim().min(1).max(200),
  evidenceReference: z.string().uuid(), note: z.string().trim().min(3).max(1000),
}).strict().superRefine((value, ctx) => {
  if (value.method === "other" && !value.otherMethod) ctx.addIssue({ code: "custom", path: ["otherMethod"], message: "Actual Payment Method Required" });
  if (value.method !== "other" && value.otherMethod !== null) ctx.addIssue({ code: "custom", path: ["otherMethod"], message: "Unexpected Other Method" });
});
export type PickupPaymentDraft = z.infer<typeof pickupPaymentDraft>;
export type PickupPaymentFact = {
  id: string; applicationId: string; vehicleId: string; obligationId: string;
  method: PickupPaymentDraft["method"]; sourceAccountReference: string;
  reference: string; evidenceReference: string;
  amountCents: number | null; status: "proposed" | "verified" | "refunded" | "voided";
};

/** Diagnostic only: final authorization, provider and RLS checks remain unimplemented. */
export function pickupPaymentDraftIssues(input: unknown, scope: {
  applicationId: string; vehicleId: string; obligationId: string;
  sourceAccountReference: string; currentFacts: readonly PickupPaymentFact[];
}): string[] {
  const parsed = pickupPaymentDraft.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => issue.message);
  const draft = parsed.data;
  const issues: string[] = [];
  if (draft.applicationId !== scope.applicationId || draft.vehicleId !== scope.vehicleId || draft.obligationId !== scope.obligationId) issues.push("Payment Does Not Match This Handoff");
  if (!scope.sourceAccountReference.trim()) issues.push("Payment Source Account Required");
  // Query scope must include all authorized payment identities, not just this renter.
  if (scope.currentFacts.some((fact) => fact.evidenceReference === draft.evidenceReference ||
    (fact.sourceAccountReference === scope.sourceAccountReference && fact.reference === draft.reference))) issues.push("Payment Evidence Already Recorded; Review Existing Payment");
  return issues;
}

/** Exact cents; blank, negative, extra decimals and unknown values stay unavailable. */
export function pickupAmountCents(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole = "", fraction = ""] = text.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}