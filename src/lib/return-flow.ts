/** Pure helpers for the guided Return (End Rental) flow. */

export const RETURN_FLOW_ENABLED = true as const;

export const RETURN_STEPS = [
  { id: "details", label: "Details" },
  { id: "photos", label: "Photos" },
  { id: "balance", label: "Balance" },
  { id: "invoice", label: "Invoice" },
  { id: "billing", label: "Billing" },
  { id: "done", label: "Done" },
] as const;

export type ReturnStepId = (typeof RETURN_STEPS)[number]["id"];

export type VehicleDestination = "available" | "maintenance";

export type SubscriptionCancelMode = "none" | "period_end" | "now";

export type ReturnBalanceLine = {
  key: string;
  label: string;
  cents: number;
  kind: "rent" | "late" | "toll" | "damage" | "deposit" | "other";
  waived?: boolean;
};

export type ReturnBalanceSummary = {
  lines: ReturnBalanceLine[];
  totalOwedCents: number;
  depositHeldCents: number;
  depositApplyCents: number;
  hasStripeCustomer: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  autopayActive: boolean;
  weeklyRateCents: number | null;
  driverName: string;
  driverPhone: string | null;
  driverEmail: string | null;
  applicationId: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
};

export function moneyCents(cents: number): string {
  const n = Number.isFinite(cents) ? cents : 0;
  return `$${(n / 100).toFixed(2)}`;
}

export function returnStepIndex(id: ReturnStepId): number {
  return RETURN_STEPS.findIndex((s) => s.id === id);
}

export function nextReturnStep(id: ReturnStepId): ReturnStepId | null {
  const i = returnStepIndex(id);
  if (i < 0 || i >= RETURN_STEPS.length - 1) return null;
  return RETURN_STEPS[i + 1].id;
}

export function prevReturnStep(id: ReturnStepId): ReturnStepId | null {
  const i = returnStepIndex(id);
  if (i <= 0) return null;
  return RETURN_STEPS[i - 1].id;
}

/** Past rentals with money still owed stay Closed and show Balance Due. */
export function pastRentalBadge(input: {
  status: string | null | undefined;
  balanceDueCents: number | null | undefined;
}): string | null {
  const s = String(input.status ?? "").toLowerCase();
  const ended = ["ended", "completed", "closed", "returned", "finished"].includes(s);
  if (!ended) return null;
  const due = Number(input.balanceDueCents ?? 0);
  if (due > 0) return "Balance Due";
  return "Completed";
}

export function vehicleDestinationLabel(d: VehicleDestination): string {
  return d === "maintenance" ? "Maintenance" : "Available";
}

/** Map UI "needs inspection" choice onto the installed end_rental_tx statuses. */
export function destinationForComplete(choice: "available" | "maintenance" | "needs_inspection"): VehicleDestination {
  if (choice === "available") return "available";
  return "maintenance";
}

export function normalizeSkipReason(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").trim().slice(0, 500);
  return t || null;
}

export function canSkipPhotos(reason: string | null | undefined): boolean {
  return !!normalizeSkipReason(reason);
}

export function photosReady(input: { photoCount: number; skipReason: string | null | undefined }): boolean {
  return input.photoCount > 0 || canSkipPhotos(input.skipReason);
}

export function detailsReady(input: {
  returnedAtEt: string;
  mileage: string;
  fuelOrCharge: string;
}): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.returnedAtEt.trim())) return false;
  const miles = Number(String(input.mileage).replace(/[^\d]/g, ""));
  if (!Number.isInteger(miles) || miles < 0 || miles > 2_000_000) return false;
  return ["empty", "quarter", "half", "three_quarter", "full"].includes(input.fuelOrCharge);
}

export function sumBalanceCents(lines: ReturnBalanceLine[]): number {
  return lines.reduce((sum, line) => sum + (line.waived ? 0 : Math.max(0, line.cents)), 0);
}

export function finalAmountAfterDeposit(input: {
  owedCents: number;
  depositApplyCents: number;
}): number {
  return Math.max(0, Math.max(0, input.owedCents) - Math.max(0, input.depositApplyCents));
}

export type FinalChargeDraft = {
  label: string;
  cents: number;
  kind: "damage" | "cleaning" | "toll" | "other";
};

export function normalizeFinalCharge(draft: FinalChargeDraft): FinalChargeDraft | null {
  const label = String(draft.label ?? "").trim().slice(0, 120);
  const cents = Math.round(Number(draft.cents));
  if (!label || !Number.isFinite(cents) || cents <= 0) return null;
  return { label, cents, kind: draft.kind };
}

export function previewFinalAmount(input: {
  owedCents: number;
  depositApplyCents: number;
  extraCharges: FinalChargeDraft[];
}): number {
  const extras = input.extraCharges
    .map(normalizeFinalCharge)
    .filter((c): c is FinalChargeDraft => !!c)
    .reduce((s, c) => s + c.cents, 0);
  return finalAmountAfterDeposit({
    owedCents: input.owedCents + extras,
    depositApplyCents: input.depositApplyCents,
  });
}
