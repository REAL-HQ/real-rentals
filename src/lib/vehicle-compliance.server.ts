/**
 * Read-only. The flag is checked again here so a direct call returns before
 * the role check and before load(). Amounts and statuses come from
 * buildVehicleCompliance. This module does not write.
 */
import { tierAllows, type StaffTier } from "./roles";
import { isFinanceKind, type PresenceDoc } from "./vehicle-doc-presence";
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
/** Ids per `.in` filter. Same width as the other compliance id batches. */
export const DOC_ID_CHUNK = 100;
/**
 * Document reads share a Workers invocation with the vehicle pages
 * (COMPLIANCE_MAX_PAGES is 10) and two inspection reads. The free plan
 * allows 50 subrequests. 10 + 2 + 32 = 44, under that limit.
 */
export const DOC_SUBREQUEST_CAP = 32;

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
    const documentLoad = await loadComplianceDocuments(reader, vehicleRows.map((vehicle) => vehicle.id));
    const documents = documentLoad.documents;
    const documentsIncomplete = documentLoad.incomplete;
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

function idChunks(ids: readonly string[], size: number): string[][] {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}

async function readDocQuery(
  reader: ComplianceReader,
  table: string,
  columns: string,
  refine: (query: ComplianceQuery) => ComplianceQuery,
): Promise<Record<string, unknown>[]> {
  const query = refine(reader.from(table).select(columns));
  const pending = typeof (query as { then?: unknown }).then === "function"
    ? Promise.resolve(query as unknown as Promise<PageResult>)
    : Promise.resolve(query.limit(10000));
  const result = await pending;
  if (result?.error) throw new Error(result.error.message ?? "document read failed");
  return Array.isArray(result?.data) ? (result.data as Record<string, unknown>[]) : [];
}

function asPresenceDoc(row: Record<string, unknown>): PresenceDoc | null {
  if (typeof row.id !== "string" || typeof row.kind !== "string") return null;
  return {
    id: row.id,
    kind: row.kind,
    file_name: row.file_name == null ? null : String(row.file_name),
    expires_at: row.expires_at == null ? null : String(row.expires_at),
    created_at: row.created_at == null ? undefined : String(row.created_at),
  };
}

/**
 * One pair of `.in` reads per vehicle-id chunk, then one pair per linked
 * document-id chunk. includeFinance is false: coordinators must not receive
 * finance kinds. A PostgREST error or a subrequest cap marks the read
 * incomplete instead of treating the failure as no documents.
 */
async function loadComplianceDocuments(
  reader: ComplianceReader,
  vehicleIds: string[],
): Promise<{ documents: ComplianceDocument[]; incomplete: boolean }> {
  const documents: ComplianceDocument[] = [];
  let incomplete = false;
  let used = 0;
  const vehicleChunks = idChunks(vehicleIds, DOC_ID_CHUNK);
  for (const ids of vehicleChunks) {
    if (used + 2 > DOC_SUBREQUEST_CAP) {
      incomplete = true;
      break;
    }
    const allowed = new Set(ids);
    let own: Record<string, unknown>[] = [];
    let links: Record<string, unknown>[] = [];
    try {
      [own, links] = await Promise.all([
        readDocQuery(reader, "documents", "id,vehicle_id,kind,file_name,expires_at,created_at", (query) =>
          query.in("vehicle_id", ids).eq("is_current", true).is("driver_id", null),
        ),
        readDocQuery(reader, "document_vehicle_links", "document_id,vehicle_id", (query) => query.in("vehicle_id", ids)),
      ]);
      used += 2;
    } catch {
      used += 2;
      incomplete = true;
      continue;
    }
    const direct = new Map<string, PresenceDoc[]>();
    const linkIds = new Map<string, string[]>();
    for (const id of ids) {
      direct.set(id, []);
      linkIds.set(id, []);
    }
    for (const row of own) {
      const vehicleId = typeof row.vehicle_id === "string" ? row.vehicle_id : "";
      const doc = asPresenceDoc(row);
      if (!allowed.has(vehicleId) || !doc) continue;
      direct.get(vehicleId)?.push(doc);
    }
    const linkedDocIds: string[] = [];
    for (const row of links) {
      const vehicleId = typeof row.vehicle_id === "string" ? row.vehicle_id : "";
      const documentId = typeof row.document_id === "string" ? row.document_id : "";
      if (!allowed.has(vehicleId) || !documentId) continue;
      linkIds.get(vehicleId)?.push(documentId);
      linkedDocIds.push(documentId);
    }
    const docChunks = idChunks(linkedDocIds, DOC_ID_CHUNK);
    if (used + docChunks.length * 2 > DOC_SUBREQUEST_CAP) {
      incomplete = true;
      break;
    }
    const linkedDocs = new Map<string, PresenceDoc>();
    const shareCount: Record<string, number> = {};
    let linkReadFailed = false;
    for (const docIds of docChunks) {
      try {
        const [docs, shares] = await Promise.all([
          readDocQuery(reader, "documents", "id,kind,file_name,expires_at,created_at", (query) =>
            query.in("id", docIds).eq("is_current", true).is("driver_id", null),
          ),
          readDocQuery(reader, "document_vehicle_links", "document_id", (query) => query.in("document_id", docIds)),
        ]);
        used += 2;
        const wanted = new Set(docIds);
        for (const row of docs) {
          const doc = asPresenceDoc(row);
          if (doc && wanted.has(doc.id)) linkedDocs.set(doc.id, doc);
        }
        for (const row of shares) {
          const documentId = typeof row.document_id === "string" ? row.document_id : "";
          if (!wanted.has(documentId)) continue;
          shareCount[documentId] = (shareCount[documentId] ?? 0) + 1;
        }
      } catch {
        used += 2;
        linkReadFailed = true;
        incomplete = true;
      }
    }
    if (linkReadFailed) continue;
    // Every current direct and linked document, with finance kinds removed.
    // includeFinance is false. Slot winners are not substituted for that list.
    const keep = (doc: PresenceDoc) => !isFinanceKind(doc.kind);
    for (const vehicleId of ids) {
      const linked = (linkIds.get(vehicleId) ?? [])
        .map((documentId) => linkedDocs.get(documentId))
        .filter((doc): doc is PresenceDoc => doc != null)
        .map((doc) => ({ ...doc, relatedVehicles: shareCount[doc.id] ?? 1 }));
      for (const doc of [...(direct.get(vehicleId) ?? []).filter(keep), ...linked.filter(keep)]) {
        documents.push({ vehicle_id: vehicleId, kind: String(doc.kind ?? ""), expires_at: doc.expires_at ?? null });
      }
    }
  }
  return { documents, incomplete };
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
