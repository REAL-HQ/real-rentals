/** Presentation only: completion facts are supplied by existing authorized reads. */
export const DRIVER_LIFECYCLE_STAGES = [
  { key: "applied", label: "Applied" },
  { key: "contacted", label: "Contacted" },
  { key: "documents", label: "Documents" },
  { key: "screening", label: "Screening" },
  { key: "docs", label: "License" },
  { key: "profile", label: "Profile" },
  { key: "insurance", label: "Insurance" },
  { key: "approved", label: "Approved" },
  { key: "inspection", label: "Inspection" },
  { key: "agreement", label: "Agreement" },
  { key: "pickup", label: "Pickup" },
  { key: "active", label: "Active" },
] as const;
export type DriverLifecycleKey = typeof DRIVER_LIFECYCLE_STAGES[number]["key"];
export type DriverLifecycleStage = { key: DriverLifecycleKey; label: string; state: "done" | "current" | "upcoming" };

export function driverLifecycle(facts: {
  contacted: boolean; screening: boolean; documents: boolean; profile: boolean; insuranceOnFile: boolean;
  approved: boolean; inspection: boolean; agreement: boolean; rentalActive: boolean;
  /** Saved staff pickup check-off (Yellow); Active still needs a real running rental. */
  pickup?: boolean;
  /** Aggregate receipt of required files, not their verification. */
  documentsReceived?: boolean;
}) {
  const completed: Record<DriverLifecycleKey, boolean> = {
    applied: true, contacted: facts.contacted, documents: facts.documentsReceived === true, screening: facts.screening,
    docs: facts.documents, profile: facts.profile, insurance: facts.insuranceOnFile, approved: facts.approved,
    inspection: facts.inspection, agreement: facts.agreement,
    pickup: facts.rentalActive || facts.pickup === true, active: facts.rentalActive,
  };
  let currentFound = false;
  const stages: DriverLifecycleStage[] = DRIVER_LIFECYCLE_STAGES.map(({ key, label }) => {
    if (completed[key]) return { key, label, state: "done" };
    if (!currentFound) { currentFound = true; return { key, label, state: "current" }; }
    return { key, label, state: "upcoming" };
  });
  const current = stages.find((stage) => stage.state === "current") ?? stages[stages.length - 1];
  return { stages, current, percent: Math.round(stages.filter((stage) => stage.state === "done").length / stages.length * 100) };
}