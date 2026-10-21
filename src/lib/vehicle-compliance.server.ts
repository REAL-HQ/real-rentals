/**
 * Read-only. The flag is checked again here so a direct call returns before
 * the role check and before load(). Amounts and statuses come from
 * buildVehicleCompliance. This module does not write.
 */
import { tierAllows, type StaffTier } from "./roles";
import { loadVehicleDocPresence } from "./vehicle-doc-presence.server";
import {
  COMPLIANCE_DISABLED,
  COMPLIANCE_UNAVAILABLE,
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

    const vehicleRows = vehicles.rows.map(asVehicle).filter((row): row is ComplianceVehicle => row != null);
    const documents: ComplianceDocument[] = [];
    let documentsIncomplete = false;
    const docs = docClient(reader);
    for (const vehicle of vehicleRows) {
      try {
        // includeFinance is false: coordinators must not receive finance kinds.
        // The loader merges direct documents and document_vehicle_links.
        const presence = await loadVehicleDocPresence(docs, vehicle.id, false);
        for (const doc of [...presence.direct, ...presence.linked]) {
          documents.push({ vehicle_id: vehicle.id, kind: String(doc.kind ?? ""), expires_at: doc.expires_at ?? null });
        }
      } catch {
        documentsIncomplete = true;
      }
    }
    const due = await readInspectionTable(reader, "maintenance_due_v1");
    const log = await readInspectionTable(reader, "maintenance_log_v1");

    const inspectionInstalled = due.installed || log.installed;
    const inspectionDegraded = due.degraded || log.degraded;
    return {
      failed: false,
      vehicles: vehicleRows,
      documents,
      inspections: inspectionDegraded ? [] : [...due.rows, ...log.rows],
      inspectionInstalled,
      inspectionDegraded,
      documentsIncomplete,
      truncated: vehicles.truncated || due.truncated || log.truncated,
    };
  } catch {
    return empty;
  }
}

async function readInspectionTable(
  reader: ComplianceReader,
  table: "maintenance_due_v1" | "maintenance_log_v1",
): Promise<{ rows: ComplianceInspection[]; installed: boolean; degraded: boolean; truncated: boolean }> {
  // vehicle_id is the primary key. inspection_due_on is the tie-break so a
  // repeated vehicle id cannot make range() skip or repeat a row.
  const page = await readCappedPages((from, to) =>
    reader
      .from(table)
      .select("vehicle_id,inspection_due_on")
      .order("vehicle_id", { ascending: true })
      .order("inspection_due_on", { ascending: true })
      .range(from, to),
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

/**
 * The presence loader awaits the query builder. Replay its filters onto the
 * reader and surface a PostgREST error as a throw so the caller can mark the
 * document read incomplete instead of treating a failure as no documents.
 */
function docClient(reader: ComplianceReader) {
  return {
    from(table: string) {
      let columns = "*";
      const steps: Array<(query: ComplianceQuery) => ComplianceQuery> = [];
      const api = {
        select(next: string) {
          columns = next;
          return api;
        },
        eq(column: string, value: unknown) {
          steps.push((query) => query.eq(column, value));
          return api;
        },
        is(column: string, value: null) {
          steps.push((query) => query.is(column, value));
          return api;
        },
        in(column: string, values: readonly string[]) {
          steps.push((query) => query.in(column, values));
          return api;
        },
        order(column: string, options?: { ascending?: boolean }) {
          steps.push((query) => query.order(column, options));
          return api;
        },
        then(resolve: (value: PageResult) => unknown, reject: (reason: unknown) => unknown) {
          let query = reader.from(table).select(columns);
          for (const step of steps) query = step(query);
          const pending = typeof (query as { then?: unknown }).then === "function"
            ? Promise.resolve(query as unknown as Promise<PageResult>)
            : Promise.resolve(query.limit(10000));
          return pending.then((result) => {
            if (result?.error) throw new Error(result.error.message ?? "document read failed");
            return result;
          }).then(resolve, reject);
        },
      };
      return api;
    },
  };
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

function asInspection(row: unknown): ComplianceInspection | null {
  if (!row || typeof row !== "object") return null;
  const record = row as { vehicle_id?: unknown; inspection_due_on?: unknown };
  if (typeof record.vehicle_id !== "string") return null;
  return { vehicle_id: record.vehicle_id, inspection_due_on: record.inspection_due_on };
}
