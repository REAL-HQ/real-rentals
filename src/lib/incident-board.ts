// Operational incident board. Display and status rules only — no database access.
//
// incidents.status has no CHECK constraint. The allowed values are the column
// comment on the table: open, in_claim, repairing, closed, written_off.
// Anything else is refused. There is no second workflow on top of that list.
//
// Roadside issues live in public.issues. Neither table stores the other's id,
// so a link is Unknown until proposed/incident-board-v1.sql is installed.

import { tierAllows, type StaffTier } from "@/lib/roles";
import { formatIssueTimeEt } from "@/lib/driver-issues";

/** Dark until the owner turns the board on. Server functions refuse while this is false. */
export const INCIDENT_BOARD_ENABLED = false;

export const INCIDENT_BOARD_DISABLED = "Incident Board is disabled pending acceptance";

export const INCIDENT_STATUSES = ["open", "in_claim", "repairing", "closed", "written_off"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Still on the board. Closed and Written Off are finished. */
export const OPEN_INCIDENT_STATUSES = ["open", "in_claim", "repairing"] as const;

export const INCIDENT_TYPES = ["accident", "damage", "theft", "vandalism", "breakdown", "tow", "other"] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

const STATUS_LABEL: Record<IncidentStatus, string> = {
  open: "Open",
  in_claim: "In Claim",
  repairing: "Repairing",
  closed: "Closed",
  written_off: "Written Off",
};

const TYPE_LABEL: Record<IncidentType, string> = {
  accident: "Accident",
  damage: "Damage",
  theft: "Theft",
  vandalism: "Vandalism",
  breakdown: "Breakdown",
  tow: "Tow",
  other: "Other",
};

const SEVERITY_LABEL: Record<string, string> = {
  minor: "Minor",
  moderate: "Moderate",
  major: "Major",
  total_loss: "Total Loss",
};

const FAULT_LABEL: Record<string, string> = {
  driver: "Driver",
  third_party: "Third Party",
  none: "None",
  unknown: "Unknown",
};

const UNKNOWN = "Unknown";

export function assertIncidentBoardEnabled(): void {
  if (!INCIDENT_BOARD_ENABLED) throw new Error(INCIDENT_BOARD_DISABLED);
}

/** Owner, Manager, and Coordinator. A missing tier is refused. */
export function incidentBoardTierAllowed(tier: StaffTier | null): boolean {
  return tierAllows(tier, "coordinator");
}

export function isIncidentStatus(value: string): value is IncidentStatus {
  return (INCIDENT_STATUSES as readonly string[]).includes(value);
}

export function isOpenIncidentStatus(value: string): boolean {
  return (OPEN_INCIDENT_STATUSES as readonly string[]).includes(value);
}

export function incidentStatusLabel(value: string): string {
  return isIncidentStatus(value) ? STATUS_LABEL[value] : UNKNOWN;
}

export function incidentTypeLabel(value: string): string {
  return (INCIDENT_TYPES as readonly string[]).includes(value) ? TYPE_LABEL[value as IncidentType] : UNKNOWN;
}

/**
 * Move to any allowed status, including back to Open. The table does not
 * order these. An unknown value is refused and nothing is written.
 */
export function incidentStatusMove(from: string, to: string): { ok: true; unchanged: boolean } | { ok: false; reason: string } {
  if (!isIncidentStatus(from)) return { ok: false, reason: "That incident status is not one this board can change." };
  if (!isIncidentStatus(to)) return { ok: false, reason: "That is not an incident status." };
  return { ok: true, unchanged: from === to };
}

export function incidentCreateBlockers(input: { vehicleId: string; incidentType: string; occurredAt: string }): string[] {
  const reasons: string[] = [];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.vehicleId)) reasons.push("Choose a vehicle.");
  if (!(INCIDENT_TYPES as readonly string[]).includes(input.incidentType)) reasons.push("That is not an incident type.");
  const when = new Date(input.occurredAt);
  if (!input.occurredAt || Number.isNaN(when.getTime())) reasons.push("Enter when it happened.");
  return reasons;
}

/** Title when the link column is installed and points at an issue. Unknown when the column is absent. None when it is empty. */
export function linkedRoadsideLabel(input: { linkColumn: boolean; issueTitle: string | null }): string {
  if (!input.linkColumn) return UNKNOWN;
  const title = input.issueTitle?.trim();
  return title ? title : "None";
}

export function incidentWhenEt(iso: string | null | undefined): string {
  const shown = formatIssueTimeEt(iso);
  return shown || UNKNOWN;
}

function text(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : UNKNOWN;
}

function yesNo(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return UNKNOWN;
}

export type IncidentBoardSource = {
  id: string;
  incidentType: string;
  occurredAt: string;
  reportedAt: string | null;
  status: string;
  location: string | null;
  description: string | null;
  severity: string | null;
  atFault: string | null;
  injuries: boolean | null;
  drivable: boolean | null;
  policeReportNumber: string | null;
  otherParty: string | null;
  notes: string | null;
  vehicleLabel: string | null;
  driverLabel: string | null;
  linkColumn: boolean;
  issueTitle: string | null;
};

export type IncidentBoardRow = {
  id: string;
  vehicle: string;
  driver: string;
  type: string;
  typeLabel: string;
  occurredEt: string;
  status: string;
  statusLabel: string;
  roadside: string;
  location: string;
  description: string;
  severity: string;
  fault: string;
  injuries: string;
  drivable: string;
  policeReport: string;
  otherParty: string;
  notes: string;
  reportedEt: string;
};

export function toIncidentBoardRow(source: IncidentBoardSource): IncidentBoardRow {
  const severity = source.severity ? SEVERITY_LABEL[source.severity] ?? UNKNOWN : UNKNOWN;
  const fault = source.atFault ? FAULT_LABEL[source.atFault] ?? UNKNOWN : UNKNOWN;
  return {
    id: source.id,
    vehicle: text(source.vehicleLabel),
    driver: text(source.driverLabel),
    type: source.incidentType,
    typeLabel: incidentTypeLabel(source.incidentType),
    occurredEt: incidentWhenEt(source.occurredAt),
    status: source.status,
    statusLabel: incidentStatusLabel(source.status),
    roadside: linkedRoadsideLabel({ linkColumn: source.linkColumn, issueTitle: source.issueTitle }),
    location: text(source.location),
    description: text(source.description),
    severity,
    fault,
    injuries: yesNo(source.injuries),
    drivable: yesNo(source.drivable),
    policeReport: text(source.policeReportNumber),
    otherParty: text(source.otherParty),
    notes: text(source.notes),
    reportedEt: incidentWhenEt(source.reportedAt),
  };
}
