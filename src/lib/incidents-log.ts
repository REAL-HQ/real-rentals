/**
 * Read-only incidents and damage claims log. Nothing here writes.
 *
 * What already handles accidents and damage, left in place:
 *
 * Driver issues are public.issues. A renter files one from the portal in
 * src/lib/portal.functions.ts createDriverIssue (line 379), which inserts
 * the row (line 403) and emails managers (line 419). Staff read and close
 * them in src/lib/driver-issues.functions.ts: listDriverIssues (line 44)
 * and updateDriverIssueStatus (line 135) both call requireManager (line 19).
 * incidentSeedForIssue (line 179) calls incidentSeedFromIssue
 * (src/lib/driver-issues.ts line 57), which fills the existing incident
 * form and does not insert an incident. The Incidents tab opens that form
 * from search.issue (src/routes/admin.tsx lines 94 and 804).
 *
 * Inspections and their photos are src/lib/inspections.functions.ts.
 * Phases include damage (line 34). A photo insert writes condition_media
 * (line 273) with an inspection id and does not set incident_id. The
 * migration 20260921200000_charges_incidents_deposits.sql adds
 * condition_media.incident_id (line 137). No live writer fills it.
 *
 * Incidents are src/lib/incidents.functions.ts. assertStaff (line 19) is
 * requireManager. listIncidents (line 64), saveIncident (line 118) and
 * deleteIncident (line 228) all use it. saveIncident can set the vehicle
 * to maintenance (line 218) and enrolls incident_logged only when
 * RENTER_LIFECYCLE_NOTICES_ENABLED is true (line 216). The form is
 * IncidentsPanel (src/components/admin/IncidentsPanel.tsx line 35).
 *
 * Deposits are the same file. getDepositSummary (line 269) offers a
 * driver_responsible_amount as a deduction suggestion (line 325).
 * addDepositDeduction (line 350) inserts deposit_deductions and sets
 * deposit_status to pending_disposition (line 390). settleDeposit
 * (line 412) writes the refund and can email the driver (line 499).
 * PaymentsPanel lists "damage" as a charge type. This log does not call
 * any of those writers, does not insert a payment, and does not read
 * deposit_deductions or driver_responsible_amount.
 *
 * The record shown here is the incidents row that already exists: rental,
 * vehicle, driver, date, type, description, estimated cost, actual cost,
 * claim number, and claim status. Photo links and the recovered amount
 * exist only when proposed/incidents-log-v1.sql has been installed. A
 * missing table leaves those facts unknown. A recovered amount is a
 * recorded number. It is not a charge and it is not a deposit deduction.
 */
import { displayPersonName, displayVehicleWord } from "@/lib/display-normalize";
export const INCIDENT_TYPE_LABELS: Record<string, string> = {
  accident: "Accident",
  damage: "Damage",
  theft: "Theft",
  vandalism: "Vandalism",
  breakdown: "Breakdown",
  tow: "Tow",
  other: "Other",
};

export const CLAIM_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_claim: "In Claim",
  repairing: "Repairing",
  closed: "Closed",
  written_off: "Written Off",
};

export type IncidentLogSource = {
  id: string;
  vehicle_id: string;
  rental_id: string | null;
  application_id: string | null;
  incident_type: string;
  occurred_at: string;
  description: string | null;
  estimated_cost: number | string | null;
  actual_cost: number | string | null;
  claim_number: string | null;
  status: string;
};

export type RecoverySource = {
  incident_id: string;
  amount_recovered: number | string | null;
};

export type PhotoLinkSource = {
  id: string;
  incident_id: string;
  document_id: string | null;
  inspection_id: string | null;
};

export type VehicleLogSource = {
  id: string;
  unit_number: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
};

export type DriverLogSource = {
  id: string;
  full_name: string | null;
};

export type DocumentLinkSource = {
  id: string;
  file_name: string | null;
  category: string | null;
};

export type InspectionLinkSource = {
  id: string;
  inspection_type: string | null;
  status: string | null;
};

export type PhotoLink = {
  id: string;
  kind: "document" | "inspection";
  label: string;
};

export type RecoveredTotal = {
  amount: number | null;
  unknown: number;
};

export type IncidentLogRecord = {
  id: string;
  rentalId: string | null;
  vehicleId: string;
  vehicleLabel: string;
  driverId: string | null;
  driverLabel: string;
  occurredAt: string;
  typeLabel: string;
  description: string | null;
  estimatedCost: number | null;
  actualCost: number | null;
  claimNumber: string | null;
  claimStatusLabel: string;
  amountRecovered: number | null;
  photos: PhotoLink[] | null;
};

export type PartyTotal = {
  id: string;
  label: string;
  incidents: number;
  estimated: number | null;
  actual: number | null;
  recovered: RecoveredTotal;
};

export type IncidentsLogResult = {
  incidents: IncidentLogRecord[];
  vehicleTotals: PartyTotal[];
  driverTotals: PartyTotal[];
  photoLinksInstalled: boolean;
  recoveryInstalled: boolean;
};

export function moneyOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function labelFromMap(value: string | null | undefined, labels: Record<string, string>): string {
  if (!value) return "Unknown";
  return labels[value] ?? value.split(/[_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

function recoveredTotal(amounts: Array<number | null>): RecoveredTotal {
  const known = amounts.filter((amount): amount is number => amount != null);
  return {
    amount: known.length ? known.reduce((sum, amount) => sum + amount, 0) : null,
    unknown: amounts.length - known.length,
  };
}

function costTotal(amounts: Array<number | null>): number | null {
  const known = amounts.filter((amount): amount is number => amount != null);
  return known.length ? known.reduce((sum, amount) => sum + amount, 0) : null;
}

export function buildIncidentsLog(input: {
  incidents: IncidentLogSource[];
  vehicles: VehicleLogSource[];
  drivers: DriverLogSource[];
  recovery: RecoverySource[];
  links: PhotoLinkSource[];
  documents: DocumentLinkSource[];
  inspections: InspectionLinkSource[];
  photoLinksInstalled: boolean;
  recoveryInstalled: boolean;
}): IncidentsLogResult {
  const vehicleById = new Map(input.vehicles.map((row) => [row.id, row]));
  const driverById = new Map(input.drivers.map((row) => [row.id, row]));
  const documentById = new Map(input.documents.map((row) => [row.id, row]));
  const inspectionById = new Map(input.inspections.map((row) => [row.id, row]));
  const recoveryByIncident = new Map(input.recovery.map((row) => [row.incident_id, moneyOrNull(row.amount_recovered)]));
  const linksByIncident = new Map<string, PhotoLinkSource[]>();
  for (const link of input.links) {
    const list = linksByIncident.get(link.incident_id) ?? [];
    list.push(link);
    linksByIncident.set(link.incident_id, list);
  }

  const incidents = [...input.incidents]
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : a.occurred_at > b.occurred_at ? -1 : a.id < b.id ? -1 : 1))
    .map((row): IncidentLogRecord => {
      const vehicle = vehicleById.get(row.vehicle_id);
      const driver = row.application_id ? driverById.get(row.application_id) : undefined;
      const photos = input.photoLinksInstalled
        ? photoLinks(linksByIncident.get(row.id) ?? [], documentById, inspectionById)
        : null;
      return {
        id: row.id,
        rentalId: row.rental_id,
        vehicleId: row.vehicle_id,
        vehicleLabel: vehicleLabel(vehicle, row.vehicle_id),
        driverId: row.application_id,
        driverLabel: row.application_id ? (driver?.full_name?.trim() ? displayPersonName(driver.full_name) : "Name Not On File") : "No Driver",
        occurredAt: row.occurred_at,
        typeLabel: labelFromMap(row.incident_type, INCIDENT_TYPE_LABELS),
        description: row.description?.trim() ? row.description : null,
        estimatedCost: moneyOrNull(row.estimated_cost),
        actualCost: moneyOrNull(row.actual_cost),
        claimNumber: row.claim_number?.trim() ? row.claim_number.trim() : null,
        claimStatusLabel: labelFromMap(row.status, CLAIM_STATUS_LABELS),
        amountRecovered: input.recoveryInstalled ? (recoveryByIncident.get(row.id) ?? null) : null,
        photos,
      };
    });

  return {
    incidents,
    vehicleTotals: partyTotals(incidents, (row) => row.vehicleId, (row) => row.vehicleLabel),
    driverTotals: partyTotals(
      incidents.filter((row) => row.driverId),
      (row) => row.driverId as string,
      (row) => row.driverLabel,
    ),
    photoLinksInstalled: input.photoLinksInstalled,
    recoveryInstalled: input.recoveryInstalled,
  };
}

function photoLinks(
  links: PhotoLinkSource[],
  documents: Map<string, DocumentLinkSource>,
  inspections: Map<string, InspectionLinkSource>,
): PhotoLink[] {
  const photos: PhotoLink[] = [];
  for (const link of links) {
    const hasDocument = Boolean(link.document_id);
    const hasInspection = Boolean(link.inspection_id);
    if (hasDocument === hasInspection) continue;
    if (link.document_id) {
      const document = documents.get(link.document_id);
      if (!document) continue;
      const name = document.file_name?.trim() || labelFromMap(document.category, {});
      photos.push({ id: link.id, kind: "document", label: name === "Unknown" ? "Document" : name });
      continue;
    }
    const inspection = inspections.get(link.inspection_id as string);
    if (!inspection) continue;
    const typeLabel = labelFromMap(inspection.inspection_type, {});
    const statusLabel = labelFromMap(inspection.status, {});
    photos.push({
      id: link.id,
      kind: "inspection",
      label: [typeLabel === "Unknown" ? "Inspection" : typeLabel, statusLabel === "Unknown" ? "" : statusLabel].filter(Boolean).join(" · "),
    });
  }
  return photos;
}

function vehicleLabel(vehicle: VehicleLogSource | undefined, id: string): string {
  if (!vehicle) return "Vehicle Not On File";
  const name = [vehicle.year, vehicle.make ? displayVehicleWord(vehicle.make) : "", vehicle.model ? displayVehicleWord(vehicle.model) : ""]
    .filter((part) => part != null && String(part).trim() !== "")
    .join(" ");
  const unit = vehicle.unit_number?.trim() ? `Unit ${vehicle.unit_number.trim()}` : "";
  return [unit, name].filter(Boolean).join(" · ") || id;
}

function partyTotals(
  rows: IncidentLogRecord[],
  idOf: (row: IncidentLogRecord) => string,
  labelOf: (row: IncidentLogRecord) => string,
): PartyTotal[] {
  const groups = new Map<string, IncidentLogRecord[]>();
  for (const row of rows) {
    const id = idOf(row);
    const list = groups.get(id) ?? [];
    list.push(row);
    groups.set(id, list);
  }
  return [...groups.entries()]
    .map(([id, list]) => ({
      id,
      label: labelOf(list[0]),
      incidents: list.length,
      estimated: costTotal(list.map((row) => row.estimatedCost)),
      actual: costTotal(list.map((row) => row.actualCost)),
      recovered: recoveredTotal(list.map((row) => row.amountRecovered)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || (a.id < b.id ? -1 : 1));
}
