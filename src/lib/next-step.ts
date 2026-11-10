// One next step for a renter profile, decided from the SERVER's activation
// readiness (getActivationReadiness) when it is loaded. Nothing here enables,
// verifies or activates anything: it only picks which existing section or
// dialog to open. activateRental re-checks every requirement on submit.
import type {
  ActivationEntryState,
  ActivationReadiness,
  ActivationRequirementKey,
  PrimaryStep,
} from "@/lib/activation-readiness";

/** Where a fix lives on the profile: an existing tab plus the card inside it. */
export type FixTarget =
  | { kind: "section"; tab: "documents" | "screening" | "application" | "rental"; anchor: string }
  | { kind: "interview" }
  | { kind: "record_call" }
  | { kind: "approve" }
  | { kind: "activate" }
  | { kind: "reserve" }
  | { kind: "return" };

export type Blocker = { key: ActivationRequirementKey | "local"; label: string; detail?: string; fix: string; target: FixTarget };

export type NextStep = {
  /** The one primary button. */
  label: string;
  target: FixTarget | { kind: "rental" } | { kind: "none" };
  busy: boolean;
  /** Hard requirements the server says are unmet, in the order to fix them. */
  blockers: Blocker[];
  /** Whether and how the Activate Rental entry is shown. Never hidden while a rental can start. */
  activation: "ready" | "blocked" | "checking" | "unknown" | "manager_only" | "rental_active";
  /** One sentence for the card. */
  note: string;
};

const FIX: Partial<Record<ActivationRequirementKey, { fix: string; target: FixTarget }>> = {
  interview: { fix: "Call Complete", target: { kind: "record_call" } },
  license_documents: { fix: "Review Documents", target: { kind: "section", tab: "documents", anchor: "profile-documents" } },
  insurance_verified: { fix: "Verify Insurance", target: { kind: "section", tab: "screening", anchor: "profile-insurance" } },
  insurance_document: { fix: "Open Insurance", target: { kind: "section", tab: "screening", anchor: "profile-insurance" } },
  approved: { fix: "Approve", target: { kind: "approve" } },
  signed_agreement: { fix: "Open Agreement", target: { kind: "section", tab: "documents", anchor: "profile-agreements" } },
  inspection: { fix: "Choose Vehicle", target: { kind: "section", tab: "rental", anchor: "profile-vehicle" } },
};
/** Fix order: what must happen first comes first (approval sends the agreement). */
const ORDER: ActivationRequirementKey[] = ["interview", "license_documents", "gig_profile", "insurance_verified", "approved", "inspection", "signed_agreement", "pickup", "rental_active"];

const LOCAL: Record<Exclude<PrimaryStep, "activate" | "view_rental">, Blocker> = {
  interview: { key: "local", label: "Interview not complete", ...FIX.interview! },
  documents: { key: "local", label: "Documents incomplete", ...FIX.license_documents! },
  insurance: { key: "local", label: "Insurance not verified", ...FIX.insurance_verified! },
  approve: { key: "local", label: "Not approved yet", ...FIX.approved! },
};

export function nextStep(input: {
  step: PrimaryStep;
  entry: ActivationEntryState;
  readiness: ActivationReadiness | null;
  loading: boolean;
  failed: boolean;
  /** Approved (or active) with no open rental — offer Reserved. */
  canReserve?: boolean;
  /** Soft hold already on file. */
  hasReservation?: boolean;
}): NextStep {
  const { step, entry, readiness, loading, failed } = input;
  const canReserve = input.canReserve === true && input.hasReservation !== true;
  if (entry === "rental_active") {
    return { label: "Return", target: { kind: "return" }, busy: false, blockers: [], activation: "rental_active", note: "Rental is active. Use Return to record the car back, balances, and stop billing." };
  }
  // Coordinator: the server refuses them readiness and activation, so the
  // profile's own checklist decides the step and activation is explained.
  if (entry === "manager_only") {
    const local = step in LOCAL ? LOCAL[step as keyof typeof LOCAL] : null;
    return local
      ? { label: local.fix, target: local.target, busy: false, blockers: [local], activation: "manager_only", note: "Only a Manager or Owner can start a rental." }
      : { label: "View Rental", target: { kind: "rental" }, busy: false, blockers: [], activation: "manager_only", note: "Ready for a Manager or Owner to start the rental." };
  }
  if (!readiness) {
    // Until the server answers, the profile's own checklist leads (never Activate).
    const local = step in LOCAL ? LOCAL[step as keyof typeof LOCAL] : null;
    if (loading) return { label: local?.fix ?? "Checking…", target: local?.target ?? { kind: "none" }, busy: !local, blockers: local ? [local] : [], activation: "checking", note: "Checking what's needed to start a rental…" };
    // Failure: say so, keep Activate Rental reachable (it re-checks on open).
    return { label: local?.fix ?? "Activate Rental", target: local?.target ?? { kind: "activate" }, busy: false, blockers: local ? [local] : [], activation: "unknown", note: failed ? "Couldn't check readiness. Retry, or open Activate Rental to re-check." : "Readiness not checked yet." };
  }
  const unmet = readiness.requirements.filter((r) => r.met === false && r.enforcement === "hard");
  unmet.sort((a, b) => rank(a.key) - rank(b.key));
  const blockers: Blocker[] = unmet.map((r) => {
    const f = FIX[r.key] ?? { fix: "Review", target: { kind: "activate" } as FixTarget };
    return { key: r.key, label: r.label, detail: r.detail, fix: f.fix, target: f.target };
  });
  // Unfinished interview is overridable at activation, but it is still the
  // first thing to do, as before.
  if (step === "interview") blockers.unshift(LOCAL.interview);
  if (blockers.length) {
    const first = blockers[0];
    return { label: first.fix, target: first.target, busy: false, blockers, activation: "blocked", note: `${unmet.length || 1} item${(unmet.length || 1) === 1 ? "" : "s"} before this renter can start a rental.` };
  }
  if (canReserve) {
    return { label: "Reserved", target: { kind: "reserve" }, busy: false, blockers: [], activation: "ready", note: "Approved — confirm the pickup appointment and reserve a car. Account login details are sent when Reserved is saved." };
  }
  return { label: "Activate Rental", target: { kind: "activate" }, busy: false, blockers: [], activation: "ready", note: "Required items are complete. A driver becomes Active only when a rental starts; Activate Rental re-checks everything first." };
}

function rank(k: ActivationRequirementKey) {
  const i = ORDER.indexOf(k);
  return i === -1 ? ORDER.length : i;
}
