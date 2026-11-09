import { isHardBlocker, MIN_OVERRIDE_REASON, type ActivationReadiness } from "@/lib/activation-readiness";

/** Presentation of the dialog's existing gates; never authorizes an activation. */
export function activationSubmitIssues(input: {
  readiness: ActivationReadiness | null;
  checking: boolean;
  vehicleId: string;
  rate: number;
  pickupMileage: number | null;
  startDate: string;
  acknowledged: boolean;
  overrideReason: string;
  insuranceAcknowledged: boolean;
}): { key: string; message: string }[] {
  const issues: { key: string; message: string }[] = [];
  if (input.checking) return [{ key: "checking", message: "Checking Rental Requirements…" }];
  if (!input.readiness) return [{ key: "readiness", message: "Requirements Could Not Be Checked. Retry Before Activating." }];
  if (!input.vehicleId) issues.push({ key: "vehicle", message: "Choose A Vehicle." });
  if (!(input.rate > 0)) issues.push({ key: "rate", message: "Enter A Positive Weekly Rate." });
  if (input.pickupMileage == null || !(input.pickupMileage >= 0)) issues.push({ key: "mileage", message: "Enter Pickup Mileage Below (Odometer At Handover)." });
  if (!input.startDate) issues.push({ key: "date", message: "Choose A Start Date." });
  for (const blocker of input.readiness.blockers.filter((b) => isHardBlocker(b.code))) issues.push({ key: blocker.code, message: blocker.message });
  const insurance = input.readiness.insurance;
  if (insurance.status !== "verified" && insurance.exceptionAllowed && !input.insuranceAcknowledged) issues.push({ key: "insurance_ack", message: "Acknowledge The Separate Insurance Warning." });
  const soft = input.readiness.blockers.some((b) => !isHardBlocker(b.code));
  if (soft && (!input.acknowledged || input.overrideReason.trim().length < MIN_OVERRIDE_REASON)) issues.push({ key: "reason", message: `Acknowledge The Exception And Enter A Reason (${MIN_OVERRIDE_REASON} Characters Minimum).` });
  return issues;
}