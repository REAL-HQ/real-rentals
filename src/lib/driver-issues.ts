// Display rules for driver-reported issues. No database access.
//
// public.issues already has status (default "open") and does not have a staff
// note. Notes stay off until the proposed SQL is installed; flipping this
// constant alone does not create a column.

export const DRIVER_ISSUE_NOTES_ENABLED = false;

/** Statuses a manager can set. The column is unconstrained text; this is the list the inbox writes. */
export const ISSUE_STATUSES = ["open", "resolved", "closed"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

const CLOSED = new Set<string>(["resolved", "closed"]);

export function isIssueClosed(status: string | null | undefined): boolean {
  return CLOSED.has(String(status ?? "").toLowerCase());
}

const KIND_LABEL: Record<string, string> = {
  vehicle: "Vehicle",
  account: "Account",
  other: "Other",
  accident: "Accident",
  damage: "Damage",
  theft: "Theft",
  vandalism: "Vandalism",
  breakdown: "Breakdown",
  tow: "Tow",
};

export function issueKindLabel(kind: string | null | undefined): string {
  const raw = String(kind ?? "").trim().toLowerCase();
  if (!raw) return "Other";
  if (KIND_LABEL[raw]) return KIND_LABEL[raw];
  return raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, " ");
}

export function issueStatusLabel(status: string | null | undefined): string {
  const raw = String(status ?? "open").trim().toLowerCase();
  if (raw === "resolved") return "Resolved";
  if (raw === "closed") return "Closed";
  if (raw === "open") return "Open";
  return issueKindLabel(raw);
}

/** Incident types the existing Incidents form already offers. Anything else prefills as Other. */
const INCIDENT_TYPES = ["accident", "damage", "theft", "vandalism", "breakdown", "tow", "other"] as const;

export type IssueIncidentSeed = {
  vehicleId: string | null;
  incidentType: (typeof INCIDENT_TYPES)[number];
  description: string;
  occurredAt: string;
};

/** Values for the existing incident form. Does not write an incident. */
export function incidentSeedFromIssue(issue: {
  kind: string | null;
  title: string;
  body: string | null;
  vehicleId: string | null;
  createdAt: string;
}): IssueIncidentSeed {
  const kind = String(issue.kind ?? "").toLowerCase();
  const incidentType = (INCIDENT_TYPES as readonly string[]).includes(kind)
    ? (kind as IssueIncidentSeed["incidentType"])
    : "other";
  const description = [issue.title, issue.body].filter((p) => p && p.trim()).join("\n\n").slice(0, 4000);
  return {
    vehicleId: issue.vehicleId,
    incidentType,
    description,
    occurredAt: issue.createdAt,
  };
}

/** Oct 21, 2026, 1:40 AM ET. Always America/New_York, including the abbreviation. */
export function formatIssueTimeEt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${date}, ${time} ET`;
}
