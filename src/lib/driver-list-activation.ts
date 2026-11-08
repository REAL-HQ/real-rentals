import { applicationStatusMenu } from "./application-status";
import type { StaffTier } from "./roles";
import type { ActivationBlocker } from "./activation-readiness";

// An action, never an application status. The lifecycle writer still refuses Active.
export const ACTIVATE_FROM_LIST = "__activate_rental__";
export function driverListStatusMenu(current: string | null, tier: StaffTier, hasRental: boolean) {
  return [
    ...applicationStatusMenu(current, tier).filter((choice) => choice.value !== "active"),
    { value: ACTIVATE_FROM_LIST, label: "Active", disabled: hasRental || (tier !== "owner" && tier !== "manager") },
  ];
}

export type ActivationResolution = "email" | "documents" | "insurance" | "interview" | "approval" | "agreement" | "inspection" | "vehicle" | "payments";
// Resolve prerequisites before approval and signature, not an endless Approve / rejected loop.
const RESOLUTIONS = [
  ["no_email", "email", "Add Email"],
  ["missing_documents", "documents", "Review License Documents"],
  ["insurance_not_verified", "insurance", "Verify Insurance"],
  ["no_interview", "interview", "Complete Interview"],
  ["vehicle_not_ready", "vehicle", "Complete Vehicle Details"],
  ["not_approved", "approval", "Approve Application"],
  ["no_signed_agreement", "agreement", "Review Rental Agreement"],
  ["no_passed_inspection", "inspection", "Complete Pre-Delivery Inspection"],
] as const;
export function nextActivationResolution(blockers: readonly ActivationBlocker[]) {
  if (blockers.some((b) => b.code === "already_active")) return null;
  for (const [code, key, label] of RESOLUTIONS) {
    if (blockers.some((b) => b.code === code)) return { key, label };
  }
  return null;
}

export type ActivationDraft = {
  vehicleId: string; weeklyRate: number; depositAmount: number; startDate: string; endDate: string | null;
};
/** Contract preparation must use the same chosen car, rate and dates as this draft. */
export function activationAgreementPatch(draft: ActivationDraft) {
  if (!draft.vehicleId || !Number.isFinite(draft.weeklyRate) || draft.weeklyRate <= 0) throw new Error("Choose a vehicle and enter a weekly rate above $0 first.");
  if (!Number.isFinite(draft.depositAmount) || draft.depositAmount < 0) throw new Error("Enter a valid deposit amount.");
  const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
  if (!validDay(draft.startDate) || (draft.endDate && (!validDay(draft.endDate) || draft.endDate <= draft.startDate))) throw new Error("Check the rental dates. The end date must be after the start date.");
  return { vehicle_id: draft.vehicleId, weekly_rent: draft.weeklyRate, deposit_amount: draft.depositAmount,
    contract_start_date: draft.startDate, contract_end_date: draft.endDate };
}
