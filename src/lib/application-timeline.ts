/**
 * Application Status Timeline for a signed-in applicant who is not approved
 * and not renting.
 *
 * The labels are driver-facing. Internal statuses (declined, suspended,
 * pending, failed) are not returned. Staff notes are not read.
 *
 * APPLICATION_TIMELINE_ENABLED is false until an owner turns it on. While it
 * is false the portal does not render the timeline and the read does not run.
 */

export const APPLICATION_TIMELINE_ENABLED: boolean = false;

export type TimelineState = "done" | "current" | "upcoming";

export type TimelineStep = {
  key: "submitted" | "documents" | "review" | "decision";
  label: string;
  state: TimelineState;
};

export type MissingItem = {
  key: "license" | "insurance" | "identity";
  label: string;
};

export type ApplicationTimeline = {
  show: boolean;
  steps: TimelineStep[];
  missing: MissingItem[];
};

const HIDDEN = new Set(["approved", "active"]);
const TERMINAL = new Set(["declined", "closed", "suspended", "duplicate"]);

/** Both identity checks passed. Anything else is still open, without naming why. */
export function identityClear(background: string | null | undefined, mvr: string | null | undefined): boolean {
  return background === "passed" && mvr === "passed";
}

export function buildApplicationTimeline(input: {
  status: string | null;
  hasActiveRental: boolean;
  licenseOnFile: boolean;
  insuranceOnFile: boolean;
  identityClear: boolean;
}): ApplicationTimeline {
  const status = (input.status ?? "").trim().toLowerCase();
  if (!status || HIDDEN.has(status) || input.hasActiveRental) {
    return { show: false, steps: [], missing: [] };
  }

  const missing: MissingItem[] = [];
  if (!input.licenseOnFile) missing.push({ key: "license", label: "Driver License" });
  if (!input.insuranceOnFile) missing.push({ key: "insurance", label: "Insurance" });
  if (!input.identityClear) missing.push({ key: "identity", label: "Identity Review" });

  const submitted = status !== "partial";
  const docsDone = input.licenseOnFile && input.insuranceOnFile;
  const terminal = TERMINAL.has(status);
  const needsInfo = missing.length > 0 || terminal;

  let current: TimelineStep["key"] = "review";
  if (!submitted) current = "submitted";
  else if (!docsDone) current = "documents";
  else if (terminal) current = "decision";
  else current = "review";

  const state = (key: TimelineStep["key"], done: boolean): TimelineState => {
    if (current === key) return "current";
    return done ? "done" : "upcoming";
  };

  return {
    show: true,
    missing,
    steps: [
      { key: "submitted", label: "Submitted", state: state("submitted", submitted) },
      { key: "documents", label: "Documents Received", state: state("documents", submitted && docsDone) },
      {
        key: "review",
        label: "Under Review",
        state: state("review", submitted && docsDone && (status === "reviewing" || terminal)),
      },
      {
        key: "decision",
        label: needsInfo ? "Needs Info" : "Approved",
        state: state("decision", false),
      },
    ],
  };
}
