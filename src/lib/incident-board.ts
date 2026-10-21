// Operational incident board. Display and status rules only — no database access.
//
// incidents.status has no CHECK constraint. The allowed values are the column
// comment on the table: open, in_claim, repairing, closed, written_off.
// Anything else is refused. There is no second workflow on top of that list.
//
// Roadside issues live in public.issues. Neither table stores the other's id,
// so a link is Unknown until proposed/incident-board-v1.sql is installed.
//
// Claim columns from the incidents log (estimated cost, actual cost, claim
// number, amount recovered, photo links) are folded onto this board. Money is
// integer cents. Null is not recorded, never zero. Recovery and photo links
// exist only when proposed/incident-board-claims-v1.sql is installed. A missing
// table is only Postgres 42P01 or PostgREST PGRST205. Coordinators do not
// receive the claim fields.

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

/** Claim costs stay with Owner and Manager. Coordinators keep the operational board. */
export function incidentBoardShowsClaims(tier: StaffTier | null): boolean {
  return tierAllows(tier, "manager");
}

/** Postgres undefined_table, or PostgREST's schema-cache miss for a table. Nothing else. */
export function proposedTableMissing(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code;
  return code === "42P01" || code === "PGRST205";
}

/** Non-negative source dollars with at most two decimal places, as integer cents. */
export function incidentCostCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole ?? "0") * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

export function formatCents(cents: number | null): string {
  if (cents == null || !Number.isSafeInteger(cents)) return "Not Recorded";
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const fraction = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}$${whole}.${fraction}`;
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
  vehicleId?: string | null;
  driverId?: string | null;
  rentalId?: string | null;
  rentalLabel?: string | null;
  vehicleOnFile?: boolean;
  claims?: IncidentClaimFacts | null;
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
  vehicleId: string;
  driverId: string | null;
  vehicleOnFile: boolean;
  rental: string;
  rentalHref: string | null;
  claims: IncidentClaimFacts | null;
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
    vehicleId: source.vehicleId?.trim() ? source.vehicleId.trim() : "",
    driverId: source.driverId?.trim() ? source.driverId.trim() : null,
    vehicleOnFile: source.vehicleOnFile ?? Boolean(source.vehicleLabel?.trim()),
    rental: rentalText(source.rentalId, source.rentalLabel),
    rentalHref: incidentRentalHref(source.rentalId),
    claims: source.claims ?? null,
  };
}

export function incidentRentalHref(rentalId: string | null | undefined): string | null {
  const id = rentalId?.trim();
  if (!id) return null;
  return `/admin?tab=bookings&id=${encodeURIComponent(id)}`;
}

export function incidentRentalLabel(input: { status?: string | null; startDate?: string | null } | null): string {
  if (!input) return "Rental Not On File";
  const status = titled(input.status, "");
  const day = input.startDate?.trim().slice(0, 10) ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
  return [status, date].filter(Boolean).join(" · ") || "Rental";
}

function rentalText(rentalId: string | null | undefined, rentalLabel: string | null | undefined): string {
  if (!rentalId?.trim()) return "No Rental";
  const label = rentalLabel?.trim();
  return label || "Rental Not On File";
}

function titled(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return trimmed
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export type IncidentCostSource = {
  id: string;
  estimated_cost: unknown;
  actual_cost: unknown;
  claim_number: string | null;
};

export type IncidentRecoverySource = {
  incident_id: string;
  amount_recovered: unknown;
};

export type IncidentPhotoLinkSource = {
  id: string;
  incident_id: string;
  document_id: string | null;
  inspection_id: string | null;
};

export type IncidentDocumentSource = {
  id: string;
  file_name: string | null;
  category: string | null;
  driver_id?: string | null;
};

export type IncidentInspectionSource = {
  id: string;
  inspection_type: string | null;
  status: string | null;
  vehicle_id?: string | null;
};

export type IncidentClaimPhoto = {
  id: string;
  kind: "document" | "inspection";
  label: string;
  href: string | null;
};

export type IncidentClaimFacts = {
  claimNumber: string | null;
  estimatedCostCents: number | null;
  actualCostCents: number | null;
  amountRecoveredCents: number | null;
  photos: IncidentClaimPhoto[] | null;
};

export type IncidentClaimTotal = {
  id: string;
  label: string;
  incidents: number;
  estimatedCostCents: number | null;
  actualCostCents: number | null;
  estimatedUnknown: number;
  actualUnknown: number;
  recoveredCostCents: number | null;
  recoveredUnknown: number;
};

/** Shown when the full incident scan passes the page cap or a cent sum overflows. */
export const OPEN_INCIDENT_TOTALS_LABEL = "Open Incidents (Latest 200)";
export const INCIDENT_CLAIM_PAGE = 1000;
export const INCIDENT_CLAIM_MAX_PAGES = 100;

export type IncidentBoardList = {
  rows: IncidentBoardRow[];
  claimsVisible: boolean;
  recoveryInstalled: boolean | null;
  photoLinksInstalled: boolean | null;
  vehicleTotals: IncidentClaimTotal[] | null;
  driverTotals: IncidentClaimTotal[] | null;
  totalsCapped: boolean;
  totalsLabel: string | null;
  totalsReason: "page_cap" | "overflow" | null;
};

export function incidentMoneyText(cents: number | null, unknown: number): string {
  if (cents == null || !Number.isSafeInteger(cents)) return "Not Recorded";
  if (unknown <= 0) return formatCents(cents);
  return `${formatCents(cents)} · ${unknown} Not Recorded`;
}

export function incidentClaimFacts(input: {
  ids: string[];
  costs: IncidentCostSource[];
  recoveryInstalled: boolean;
  photoLinksInstalled: boolean;
  recovery: IncidentRecoverySource[];
  links: IncidentPhotoLinkSource[];
  documents: IncidentDocumentSource[];
  inspections: IncidentInspectionSource[];
}): Map<string, IncidentClaimFacts> {
  const costById = new Map(input.costs.map((row) => [row.id, row]));
  const recoveryById = new Map<string, number | null>();
  if (input.recoveryInstalled) {
    for (const row of input.recovery) recoveryById.set(row.incident_id, incidentCostCents(row.amount_recovered));
  }
  const linksById = new Map<string, IncidentPhotoLinkSource[]>();
  if (input.photoLinksInstalled) {
    for (const link of input.links) {
      const list = linksById.get(link.incident_id) ?? [];
      list.push(link);
      linksById.set(link.incident_id, list);
    }
  }
  const documents = new Map(input.documents.map((row) => [row.id, row]));
  const inspections = new Map(input.inspections.map((row) => [row.id, row]));
  const byId = new Map<string, IncidentClaimFacts>();
  for (const id of input.ids) {
    const cost = costById.get(id);
    byId.set(id, {
      claimNumber: cost?.claim_number?.trim() ? cost.claim_number.trim() : null,
      estimatedCostCents: cost ? incidentCostCents(cost.estimated_cost) : null,
      actualCostCents: cost ? incidentCostCents(cost.actual_cost) : null,
      amountRecoveredCents: input.recoveryInstalled ? (recoveryById.get(id) ?? null) : null,
      photos: input.photoLinksInstalled ? claimPhotos(linksById.get(id) ?? [], documents, inspections) : null,
    });
  }
  return byId;
}

type ClaimTotalRow = Pick<IncidentBoardRow, "vehicleId" | "vehicle" | "vehicleOnFile" | "driverId" | "driver" | "claims">;

export function incidentClaimTotals(rows: ClaimTotalRow[]): {
  vehicleTotals: IncidentClaimTotal[];
  driverTotals: IncidentClaimTotal[];
  overflow: boolean;
} {
  const claimed = rows.filter((row) => row.claims);
  const vehicle = groupClaimTotals(claimed, vehicleGroupId, vehicleGroupLabel);
  const driver = groupClaimTotals(
    claimed.filter((row) => row.driverId),
    (row) => row.driverId as string,
    (row) => row.driver,
  );
  return {
    vehicleTotals: vehicle.rows,
    driverTotals: driver.rows,
    overflow: vehicle.overflow || driver.overflow,
  };
}

export function chooseIncidentTotals(input: {
  capped: boolean;
  allRows: ClaimTotalRow[] | null;
  openRows: ClaimTotalRow[];
}): {
  vehicleTotals: IncidentClaimTotal[];
  driverTotals: IncidentClaimTotal[];
  totalsCapped: boolean;
  totalsLabel: string | null;
  totalsReason: "page_cap" | "overflow" | null;
} {
  if (!input.capped && input.allRows) {
    const all = incidentClaimTotals(input.allRows);
    if (!all.overflow) {
      return {
        vehicleTotals: all.vehicleTotals,
        driverTotals: all.driverTotals,
        totalsCapped: false,
        totalsLabel: null,
        totalsReason: null,
      };
    }
    const open = incidentClaimTotals(input.openRows);
    return {
      vehicleTotals: open.vehicleTotals,
      driverTotals: open.driverTotals,
      totalsCapped: true,
      totalsLabel: OPEN_INCIDENT_TOTALS_LABEL,
      totalsReason: "overflow",
    };
  }
  const open = incidentClaimTotals(input.openRows);
  return {
    vehicleTotals: open.vehicleTotals,
    driverTotals: open.driverTotals,
    totalsCapped: true,
    totalsLabel: OPEN_INCIDENT_TOTALS_LABEL,
    totalsReason: "page_cap",
  };
}

function vehicleGroupId(row: ClaimTotalRow): string {
  if (!row.vehicleId) return "vehicle:blank";
  if (!row.vehicleOnFile) return "vehicle:unknown";
  return row.vehicleId;
}

function vehicleGroupLabel(row: ClaimTotalRow): string {
  if (!row.vehicleId) return "No Vehicle";
  if (!row.vehicleOnFile) return "Unknown Vehicle";
  return row.vehicle;
}

function claimLabel(value: string | null | undefined, fallback: string): string {
  return titled(value, fallback);
}

function claimPhotos(
  links: IncidentPhotoLinkSource[],
  documents: Map<string, IncidentDocumentSource>,
  inspections: Map<string, IncidentInspectionSource>,
): IncidentClaimPhoto[] {
  const photos: IncidentClaimPhoto[] = [];
  for (const link of links) {
    const hasDocument = Boolean(link.document_id);
    const hasInspection = Boolean(link.inspection_id);
    if (hasDocument === hasInspection) continue;
    if (link.document_id) {
      const document = documents.get(link.document_id);
      if (!document) continue;
      const name = document.file_name?.trim();
      photos.push({
        id: link.id,
        kind: "document",
        label: name || claimLabel(document.category, "Document"),
        href: incidentDocumentHref(document.driver_id),
      });
      continue;
    }
    const inspection = inspections.get(link.inspection_id as string);
    if (!inspection) continue;
    const typeLabel = claimLabel(inspection.inspection_type, "Inspection");
    const statusLabel = claimLabel(inspection.status, "");
    photos.push({
      id: link.id,
      kind: "inspection",
      label: [typeLabel, statusLabel].filter(Boolean).join(" · "),
      href: incidentInspectionHref(inspection.vehicle_id),
    });
  }
  return photos;
}

export function incidentDocumentHref(driverId: string | null | undefined): string | null {
  const id = driverId?.trim();
  if (!id) return null;
  return `/admin?tab=drivers&id=${encodeURIComponent(id)}`;
}

export function incidentInspectionHref(vehicleId: string | null | undefined): string | null {
  const id = vehicleId?.trim();
  if (!id) return null;
  return `/admin?tab=inspections&id=${encodeURIComponent(id)}`;
}

function sumKnownCents(values: Array<number | null>): { total: number | null; overflow: boolean } {
  let total = 0;
  let known = false;
  for (const value of values) {
    if (value == null) continue;
    known = true;
    const next = total + value;
    if (!Number.isSafeInteger(next)) return { total: null, overflow: true };
    total = next;
  }
  return { total: known ? total : null, overflow: false };
}

function groupClaimTotals<T extends { claims: IncidentClaimFacts | null }>(
  rows: T[],
  idOf: (row: T) => string,
  labelOf: (row: T) => string,
): { rows: IncidentClaimTotal[]; overflow: boolean } {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = idOf(row);
    const list = groups.get(id) ?? [];
    list.push(row);
    groups.set(id, list);
  }
  let overflow = false;
  const totals = [...groups.entries()].map(([id, list]) => {
    const estimated = list.map((row) => row.claims?.estimatedCostCents ?? null);
    const actual = list.map((row) => row.claims?.actualCostCents ?? null);
    const recovered = list.map((row) => row.claims?.amountRecoveredCents ?? null);
    const estimatedSum = sumKnownCents(estimated);
    const actualSum = sumKnownCents(actual);
    const recoveredSum = sumKnownCents(recovered);
    overflow = overflow || estimatedSum.overflow || actualSum.overflow || recoveredSum.overflow;
    return {
      id,
      label: labelOf(list[0]),
      incidents: list.length,
      estimatedCostCents: estimatedSum.total,
      actualCostCents: actualSum.total,
      estimatedUnknown: estimated.filter((value) => value == null).length,
      actualUnknown: actual.filter((value) => value == null).length,
      recoveredCostCents: recoveredSum.total,
      recoveredUnknown: recovered.filter((value) => value == null).length,
    };
  });
  return {
    rows: totals.sort((a, b) => a.label.localeCompare(b.label) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    overflow,
  };
}
