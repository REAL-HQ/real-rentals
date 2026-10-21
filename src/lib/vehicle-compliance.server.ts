/**
 * Read-only. The flag is checked again here so a direct call returns before
 * the role check and before load(). Amounts and statuses come from
 * buildVehicleCompliance. This module does not write.
 */
import { tierAllows, type StaffTier } from "./roles";
import {
  COMPLIANCE_DISABLED,
  COMPLIANCE_PAGE,
  COMPLIANCE_UNAVAILABLE,
  COMPLIANCE_DOCUMENT_KINDS,
  buildVehicleCompliance,
  complianceNotes,
  readCappedPages,
  type ComplianceDirectory,
  type ComplianceDocument,
  type ComplianceInspection,
  type ComplianceVehicle,
  type VehicleComplianceResponse,
} from "./vehicle-compliance";

export type { ComplianceDirectory };

type PageResult = { data: unknown[] | null; error: { code?: string; message?: string } | null };

export type ComplianceQuery = {
  select: (columns: string) => ComplianceQuery;
  order: (column: string, options?: { ascending?: boolean }) => ComplianceQuery;
  is: (column: string, value: null) => ComplianceQuery;
  not: (column: string, operator: string, value: unknown) => ComplianceQuery;
  eq: (column: string, value: unknown) => ComplianceQuery;
  in: (column: string, values: readonly string[]) => ComplianceQuery;
  range: (from: number, to: number) => PromiseLike<PageResult>;
  limit: (count: number) => PromiseLike<PageResult>;
};

export type ComplianceReader = {
  from: (table: string) => ComplianceQuery;
};

const VEHICLE_COLUMNS = "id,registration_expires_on,insurance_expires_on,plate_expires_on";

export async function runVehicleCompliance(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  today: string;
  load: () => Promise<ComplianceDirectory | null>;
}): Promise<VehicleComplianceResponse> {
  if (!input.enabled) return COMPLIANCE_DISABLED;
  if (!input.userId || !tierAllows(input.tier, "coordinator")) throw new Error("Forbidden");
  let directory: ComplianceDirectory | null = null;
  try {
    directory = await input.load();
  } catch {
    return COMPLIANCE_UNAVAILABLE;
  }
  if (!directory || directory.failed) return COMPLIANCE_UNAVAILABLE;
  return {
    status: "ready",
    reason: null,
    today: input.today,
    truncated: directory.truncated,
    inspectionInstalled: directory.inspectionInstalled,
    rows: buildVehicleCompliance(input.today, directory),
    notes: complianceNotes(directory),
  };
}

export async function loadVehicleCompliance(reader: ComplianceReader): Promise<ComplianceDirectory> {
  const empty: ComplianceDirectory = {
    failed: true,
    vehicles: [],
    documents: [],
    inspections: [],
    inspectionInstalled: false,
    inspectionDegraded: false,
    documentsIncomplete: false,
    truncated: false,
  };
  try {
    const vehicles = await readCappedPages((from, to) =>
      reader.from("vehicles").select(VEHICLE_COLUMNS).order("id", { ascending: true }).range(from, to),
    );
    if (vehicles.failed || vehicles.missing) return empty;

    const direct = await readCappedPages((from, to) =>
      reader
        .from("documents")
        .select("id,vehicle_id,kind,expires_at")
        .not("vehicle_id", "is", null)
        .not("expires_at", "is", null)
        .eq("is_current", true)
        .in("kind", COMPLIANCE_DOCUMENT_KINDS)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const linked = await readCappedPages((from, to) =>
      reader
        .from("documents")
        .select("id,kind,expires_at")
        .is("vehicle_id", null)
        .not("expires_at", "is", null)
        .eq("is_current", true)
        .in("kind", COMPLIANCE_DOCUMENT_KINDS)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const linkRead = await readLinks(reader, linked.rows);
    const due = await readInspectionTable(reader, "maintenance_due_v1");
    const log = await readInspectionTable(reader, "maintenance_log_v1");

    const documents = [
      ...asDocuments(direct.rows, true),
      ...linkRead.documents,
    ];
    const documentsIncomplete = direct.failed || direct.missing || direct.truncated || linked.failed || linked.missing || linked.truncated || linkRead.incomplete;
    const inspectionInstalled = due.installed || log.installed;
    const inspectionDegraded = due.degraded || log.degraded;
    return {
      failed: false,
      vehicles: vehicles.rows.map(asVehicle).filter((row): row is ComplianceVehicle => row != null),
      documents,
      inspections: inspectionDegraded ? [] : [...due.rows, ...log.rows],
      inspectionInstalled,
      inspectionDegraded,
      documentsIncomplete,
      truncated: vehicles.truncated || direct.truncated || linked.truncated || linkRead.truncated || due.truncated || log.truncated,
    };
  } catch {
    return empty;
  }
}

async function readInspectionTable(
  reader: ComplianceReader,
  table: "maintenance_due_v1" | "maintenance_log_v1",
): Promise<{ rows: ComplianceInspection[]; installed: boolean; degraded: boolean; truncated: boolean }> {
  const page = await readCappedPages((from, to) =>
    reader.from(table).select("vehicle_id,inspection_due_on").order("vehicle_id", { ascending: true }).range(from, to),
  );
  if (page.missing) return { rows: [], installed: false, degraded: false, truncated: false };
  if (page.failed) return { rows: [], installed: false, degraded: true, truncated: false };
  return {
    rows: page.rows.map(asInspection).filter((row): row is ComplianceInspection => row != null),
    installed: true,
    degraded: false,
    truncated: page.truncated,
  };
}

async function readLinks(
  reader: ComplianceReader,
  documents: unknown[],
): Promise<{ documents: ComplianceDocument[]; incomplete: boolean; truncated: boolean }> {
  const byId = new Map<string, { kind: string; expires_at: unknown }>();
  for (const row of documents) {
    if (!row || typeof row !== "object") continue;
    const record = row as { id?: unknown; kind?: unknown; expires_at?: unknown };
    if (typeof record.id !== "string") continue;
    byId.set(record.id, { kind: String(record.kind ?? ""), expires_at: record.expires_at });
  }
  const ids = [...byId.keys()];
  if (!ids.length) return { documents: [], incomplete: false, truncated: false };
  const documentsOut: ComplianceDocument[] = [];
  let incomplete = false;
  let truncated = false;
  try {
    for (let index = 0; index < ids.length; index += 100) {
      const chunk = ids.slice(index, index + 100);
      const result = await reader
        .from("document_vehicle_links")
        .select("document_id,vehicle_id")
        .in("document_id", chunk)
        .limit(COMPLIANCE_PAGE + 1);
      if (result.error) return { documents: documentsOut, incomplete: true, truncated };
      const rows = result.data ?? [];
      if (rows.length > COMPLIANCE_PAGE) {
        truncated = true;
        incomplete = true;
      }
      for (const row of rows.slice(0, COMPLIANCE_PAGE)) {
        if (!row || typeof row !== "object") continue;
        const link = row as { document_id?: unknown; vehicle_id?: unknown };
        if (typeof link.document_id !== "string" || typeof link.vehicle_id !== "string") continue;
        const document = byId.get(link.document_id);
        if (!document) continue;
        documentsOut.push({ vehicle_id: link.vehicle_id, kind: document.kind, expires_at: document.expires_at });
      }
    }
  } catch {
    incomplete = true;
  }
  return { documents: documentsOut, incomplete, truncated };
}

function asVehicle(row: unknown): ComplianceVehicle | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Partial<ComplianceVehicle>;
  if (typeof record.id !== "string") return null;
  return {
    id: record.id,
    registration_expires_on: record.registration_expires_on,
    insurance_expires_on: record.insurance_expires_on,
    plate_expires_on: record.plate_expires_on,
  };
}

function asDocuments(rows: unknown[], owned: boolean): ComplianceDocument[] {
  if (!owned) return [];
  const documents: ComplianceDocument[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as { vehicle_id?: unknown; kind?: unknown; expires_at?: unknown };
    if (typeof record.vehicle_id !== "string") continue;
    documents.push({ vehicle_id: record.vehicle_id, kind: String(record.kind ?? ""), expires_at: record.expires_at });
  }
  return documents;
}

function asInspection(row: unknown): ComplianceInspection | null {
  if (!row || typeof row !== "object") return null;
  const record = row as { vehicle_id?: unknown; inspection_due_on?: unknown };
  if (typeof record.vehicle_id !== "string") return null;
  return { vehicle_id: record.vehicle_id, inspection_due_on: record.inspection_due_on };
}
