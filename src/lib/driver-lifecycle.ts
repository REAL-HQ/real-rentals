/** Presentation only: completion facts are supplied by existing authorized reads. */
export const DRIVER_LIFECYCLE_STAGES = [
  { key: "applied", label: "Applied" },
  { key: "contacted", label: "Contacted" },
  { key: "documents", label: "Documents" },
  { key: "screening", label: "Screening" },
  { key: "approved", label: "Approved" },
  { key: "agreement", label: "Agreement" },
  { key: "reserved", label: "Reserved" },
  { key: "inspection", label: "Inspection" },
  { key: "pickup", label: "Pickup" },
  { key: "active", label: "Active" },
] as const;
export type DriverLifecycleKey = typeof DRIVER_LIFECYCLE_STAGES[number]["key"];
export type DriverLifecycleStage = { key: DriverLifecycleKey; label: string; state: "done" | "current" | "upcoming" };

export function driverLifecycle(facts: {
  contacted: boolean; screening: boolean;
  approved: boolean; inspection: boolean; agreement: boolean; rentalActive: boolean;
  /** Existing reserved rental with confirmed pickup details; Active also completes this stage. */
  reserved?: boolean;
  /** Saved staff pickup check-off (Yellow); Active still needs a real running rental. */
  pickup?: boolean;
  /** Aggregate receipt of license, gig-profile and income-proof files, not their verification. */
  documentsReceived?: boolean;
  /** Saved interview completion (driver_screenings.interview_completed_at). A
   *  finished call proves we reached them, so Contacted is done even when no
   *  contacted date was ever stamped. */
  interviewComplete?: boolean;
}) {
  const completed: Record<DriverLifecycleKey, boolean> = {
    applied: true,
    contacted: facts.contacted || facts.interviewComplete === true,
    documents: facts.documentsReceived === true,
    screening: facts.screening,
    approved: facts.approved,
    agreement: facts.agreement,
    reserved: facts.rentalActive || facts.reserved === true,
    inspection: facts.inspection,
    pickup: facts.rentalActive || facts.pickup === true,
    active: facts.rentalActive,
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
