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
  flat: "Flat",
  lockout: "Lockout",
  tow: "Tow Needed",
};

/** Stored in public.issues.kind. Urgency uses the existing severity value "urgent". */
export const ROADSIDE_TYPES = [
  { kind: "breakdown", label: "Breakdown" },
  { kind: "flat", label: "Flat" },
  { kind: "lockout", label: "Lockout" },
  { kind: "accident", label: "Accident" },
  { kind: "tow", label: "Tow Needed" },
] as const;

export type RoadsideKind = (typeof ROADSIDE_TYPES)[number]["kind"];

const ROADSIDE_KINDS = new Set<string>(ROADSIDE_TYPES.map((t) => t.kind));

export function isPinnedIssue(issue: { kind?: string | null; severity?: string | null }): boolean {
  const kind = String(issue.kind ?? "").trim().toLowerCase();
  const severity = String(issue.severity ?? "").trim().toLowerCase();
  return severity === "urgent" || ROADSIDE_KINDS.has(kind);
}

export function issueAlertBadge(issue: { kind?: string | null; severity?: string | null }): "Roadside" | "Urgent" | null {
  if (!isPinnedIssue(issue)) return null;
  return ROADSIDE_KINDS.has(String(issue.kind ?? "").trim().toLowerCase()) ? "Roadside" : "Urgent";
}

/** Roadside and urgent rows first, newest first inside each group. */
export function pinIssues<T extends { kind: string; severity: string; createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const pin = Number(isPinnedIssue(b)) - Number(isPinnedIssue(a));
    if (pin !== 0) return pin;
    if (a.createdAt === b.createdAt) return 0;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

export function issueAgeLabel(createdAt: string, now = Date.now()): string {
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return "";
  const minutes = Math.max(0, Math.floor((now - t) / 60000));
  if (minutes < 1) return "Just Now";
  if (minutes < 60) return minutes === 1 ? "1 Minute" : `${minutes} Minutes`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 48) {
    const h = hours === 1 ? "1 Hour" : `${hours} Hours`;
    return rem === 0 ? h : `${h} ${rem === 1 ? "1 Minute" : `${rem} Minutes`}`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 Day" : `${days} Days`;
}

/** A roadside report uses kind + severity only. Location and drivable go in the existing body text. */
export function buildRoadsideIssue(input: {
  kind: string;
  location?: string | null;
  drivable: boolean;
  note?: string | null;
}): { title: string; body: string; kind: RoadsideKind; severity: "urgent" } {
  const type = ROADSIDE_TYPES.find((t) => t.kind === input.kind) ?? ROADSIDE_TYPES[0];
  const location = (input.location ?? "").trim();
  const note = (input.note ?? "").trim();
  const lines = [`Location: ${location || "Not Given"}`, `Drivable: ${input.drivable ? "Yes" : "No"}`];
  if (note) lines.push(note);
  return { title: type.label, body: lines.join("\n").slice(0, 2000), kind: type.kind, severity: "urgent" };
}

/** What the staff alert may send. Both flags default off, so a normal call sends nothing. */
export function driverIssueAlertPlan(
  flags: { emailEnabled: boolean; smsEnabled: boolean },
  issue: { kind?: string | null; severity?: string | null },
): { email: boolean; sms: boolean } {
  return {
    email: flags.emailEnabled,
    sms: flags.smsEnabled && isPinnedIssue(issue) && ROADSIDE_KINDS.has(String(issue.kind ?? "").trim().toLowerCase()),
  };
}

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
