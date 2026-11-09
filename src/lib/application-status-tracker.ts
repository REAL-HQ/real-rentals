/**
 * Read-only application status for someone who has not been approved.
 * The flag is a hard constant. The server function throws before any role
 * lookup and before any table read unless this is true.
 *
 * Dates come only from columns the applicant can already read. A blank is
 * listed. Staff comments, identity reviews, and waitlist position are not
 * selected.
 */

import { REQUIRED_DOC_TYPES } from "@/components/admin/types";
import { VAULT_TO_REQUIRED } from "@/lib/required-docs";

export const APPLICATION_STATUS_TRACKER_ENABLED: boolean = false;

export function assertApplicationStatusTrackerEnabled(): void {
  if (APPLICATION_STATUS_TRACKER_ENABLED !== true) {
    throw new Error("Application status tracker is not enabled.");
  }
}

/** Approved people use the driver portal. This tracker is for everyone earlier. */
const APPROVED = new Set(["approved", "active"]);

const REQUIRED_LABEL: Record<string, string> = {
  license_front: "Driver's License (Front)",
  license_back: "Driver's License (Back)",
  insurance_card: "Insurance Card",
  driver_profile_screenshot: "Gig Profile Screenshot",
};

/** Always omitted. Not driver-readable, or a staff comment we do not show. */
export const TRACKER_OMITTED = ["Internal Review Notes", "Identity Review", "Waitlist Position"] as const;

export type TrackerApplication = {
  status: string | null;
  reviewed_at: string | null;
  waitlist_signed_up_at: string | null;
};

export type TrackerDocument = {
  category: string | null;
  created_at: string | null;
  is_current: boolean | null;
};

export type TrackerDocLine = {
  label: string;
  date: string | null;
};

export type TrackerStep = {
  title: string;
  state: "done" | "current" | "waiting";
  date: string | null;
  detail: string | null;
};

export type ApplicationStatusView = {
  steps: TrackerStep[];
  received: TrackerDocLine[];
  stillMissing: string[];
  missing: string[];
  omitted: string[];
  /** Live /apply route. Null when that route is not available. */
  applyHref: "/apply" | null;
  /** No documents route exists for an applicant, so this stays null. */
  documentsHref: null;
};

export function isApprovedStatus(status: string | null | undefined): boolean {
  return APPROVED.has((status ?? "").toLowerCase());
}

/** Timestamps are shown on the Eastern calendar. */
export function formatTrackerDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function canonicalCategory(category: string | null): string {
  const key = (category ?? "").trim();
  return VAULT_TO_REQUIRED[key] ?? key;
}

function latestReceived(docs: TrackerDocument[]): Map<string, string | null> {
  const found = new Map<string, string | null>();
  for (const doc of docs) {
    if (doc.is_current === false) continue;
    const key = canonicalCategory(doc.category);
    if (!REQUIRED_DOC_TYPES.includes(key as (typeof REQUIRED_DOC_TYPES)[number])) continue;
    const previous = found.get(key);
    const next = doc.created_at;
    if (!found.has(key) || (next && (!previous || next > previous))) found.set(key, next ?? previous ?? null);
  }
  return found;
}

type Decision = { title: string; done: boolean; date: string | null; missingDate: string | null };

function decision(app: TrackerApplication): Decision {
  const status = (app.status ?? "").toLowerCase();
  if (status === "declined") return { title: "Declined", done: true, date: null, missingDate: "Declined Date" };
  const waitlisted = formatTrackerDate(app.waitlist_signed_up_at);
  if (waitlisted) return { title: "Waitlisted", done: true, date: waitlisted, missingDate: null };
  if (status === "closed") return { title: "Closed", done: true, date: null, missingDate: "Decision Date" };
  if (status === "suspended") return { title: "Suspended", done: true, date: null, missingDate: "Decision Date" };
  if (status === "duplicate") return { title: "Duplicate", done: true, date: null, missingDate: "Decision Date" };
  return { title: "Approved, Declined, Or Waitlisted", done: false, date: null, missingDate: null };
}

export function buildApplicationStatus(
  app: TrackerApplication,
  documents: TrackerDocument[] | null,
  options: { applyRouteLive: boolean } = { applyRouteLive: true },
): ApplicationStatusView {
  const status = (app.status ?? "").toLowerCase();
  const submitted = status !== "" && status !== "partial";
  const reviewDate = formatTrackerDate(app.reviewed_at);
  const reviewReached = Boolean(reviewDate) || ["reviewing", "declined", "closed", "suspended", "duplicate"].includes(status);
  const outcome = decision(app);
  const missing: string[] = ["Submitted Date"];
  if (reviewReached && !reviewDate) missing.push("Under Review Date");
  if (outcome.missingDate) missing.push(outcome.missingDate);

  let received: TrackerDocLine[] = [];
  let stillMissing: string[] = [];
  let documentsDone = false;
  let documentsDate: string | null = null;
  if (documents == null) {
    missing.push("Documents");
  } else {
    const found = latestReceived(documents);
    const dates: string[] = [];
    for (const key of REQUIRED_DOC_TYPES) {
      const label = REQUIRED_LABEL[key] ?? key;
      if (!found.has(key)) {
        stillMissing.push(label);
        continue;
      }
      const date = formatTrackerDate(found.get(key));
      received.push({ label, date });
      if (date) dates.push(found.get(key) as string);
      else missing.push(`${label} Date`);
    }
    documentsDone = stillMissing.length === 0;
    if (documentsDone && dates.length) {
      dates.sort();
      documentsDate = formatTrackerDate(dates[dates.length - 1]);
    }
  }

  const documentsState: TrackerStep["state"] = documentsDone ? "done" : submitted || received.length ? "current" : "waiting";
  const reviewState: TrackerStep["state"] = reviewReached ? "done" : submitted && documentsDone ? "current" : "waiting";

  missing.push("Documents Link", "Resume Link");

  return {
    steps: [
      { title: "Application Submitted", state: submitted ? "done" : "current", date: null, detail: null },
      {
        title: "Documents Received",
        state: documentsState,
        date: documentsDate,
        detail: stillMissing.length ? `Still missing: ${stillMissing.join(", ")}` : null,
      },
      { title: "Under Review", state: reviewState, date: reviewDate, detail: null },
      { title: outcome.title, state: outcome.done ? "done" : reviewReached ? "current" : "waiting", date: outcome.date, detail: null },
    ],
    received,
    stillMissing,
    missing,
    omitted: [...TRACKER_OMITTED],
    applyHref: options.applyRouteLive ? "/apply" : null,
    documentsHref: null,
  };
}
