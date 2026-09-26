// What stage is this application actually at?
//
// The dashboard used to decide with `current_step ? "In Wizard" : "New Lead"`,
// which is wrong in both directions. `current_step` is set to "complete" at the
// exact moment the wizard finishes — the moment `status` becomes 'new' — so a
// finished application waiting to be read displayed as "In Wizard", the one
// label that says nobody needs to do anything yet. And every other state
// (reviewing, declined, suspended, closed) collapsed into the same two words.
//
// Status is the lifecycle. current_step is wizard progress within `partial`,
// and nothing else. Client-safe so the dashboard and the drivers list cannot
// drift apart.

export type StageTone = "green" | "amber" | "red" | "neutral";

export type Stage = {
  /** What an operator reads. Never an internal status string. */
  label: string;
  tone: StageTone;
  /** True for states waiting on us rather than on the applicant. */
  needsAttention: boolean;
};

/**
 * Lifecycle states, from public.applications' own CHECK constraint:
 *   partial · new · complete · reviewing · approved · active
 *   suspended · declined · closed · duplicate
 */
export function applicationStage(status: string | null | undefined): Stage {
  switch ((status ?? "").toLowerCase()) {
    case "partial":
      // Started the wizard, has not finished it. Waiting on them, not us.
      return { label: "Pending", tone: "amber", needsAttention: false };
    case "complete":
      // Permitted by the constraint but never written — the finished wizard
      // sets 'new'. Mapped anyway so an old or hand-edited row reads sensibly.
      return { label: "Pending", tone: "amber", needsAttention: true };
    case "new":
      // Wizard finished. This is the one that wants a human.
      return { label: "New", tone: "red", needsAttention: true };
    case "reviewing":
      return { label: "Reviewing", tone: "amber", needsAttention: true };
    case "approved":
      return { label: "Approved", tone: "green", needsAttention: false };
    case "active":
      return { label: "Active", tone: "green", needsAttention: false };
    case "suspended":
      return { label: "Suspended", tone: "red", needsAttention: true };
    case "declined":
      return { label: "Declined", tone: "neutral", needsAttention: false };
    case "closed":
      return { label: "Closed", tone: "neutral", needsAttention: false };
    case "duplicate":
      return { label: "Duplicate", tone: "neutral", needsAttention: false };
    default:
      return { label: "Unknown", tone: "neutral", needsAttention: false };
  }
}

/** How far through the wizard, for a Pending applicant. Empty otherwise. */
export function wizardProgress(
  status: string | null | undefined,
  currentStep: string | null | undefined,
): string {
  if ((status ?? "") !== "partial" || !currentStep) return "";
  const labels: Record<string, string> = {
    eligibility: "Eligibility",
    rental: "Rental",
    gig: "Gig work",
    driver: "Driver details",
    vehicle: "Vehicle",
    review: "Review",
    complete: "Finishing",
  };
  return labels[currentStep] ?? currentStep;
}
