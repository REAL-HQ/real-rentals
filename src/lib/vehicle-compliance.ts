/**
 * Compliance for one vehicle: registration, insurance, plate, and inspection.
 * Dates that already exist are reused. Inspection expiry has no installed
 * column, so that item stays Unknown until a proposed table is present.
 * A stored calendar date is not shifted. "Today" is an Eastern Time day,
 * and day math is UTC so a DST change cannot skip or repeat a date.
 */
import { addCalendarDays, businessToday, parseIsoDate } from "./maintenance-due";
import { isOwnerOnlyDocKind, slotForKind } from "./vehicle-doc-presence";

export const COMPLIANCE_DUE_DAYS = 30;
export const COMPLIANCE_PAGE = 200;
export const COMPLIANCE_MAX_PAGES = 10;

export const complianceToday = businessToday;

export const COMPLIANCE_STATUSES = ["expired", "due_30", "ok", "unknown"] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export const COMPLIANCE_LABEL: Record<ComplianceStatus, string> = {
  expired: "Expired",
  due_30: "Due In 30 Days",
  ok: "OK",
  unknown: "Unknown",
};

const RANK: Record<ComplianceStatus, number> = { expired: 3, due_30: 2, unknown: 1, ok: 0 };

const ITEM_LABEL = {
  registration: "Registration",
  insurance: "Insurance",
  plate: "Plate",
  inspection: "Inspection",
  emissions: "Emissions",
} as const;

export type ComplianceItemKey = keyof typeof ITEM_LABEL;

export type ComplianceItem = {
  key: ComplianceItemKey;
  label: string;
  status: ComplianceStatus;
};

export type ComplianceVehicle = {
  id: string;
  registration_expires_on: unknown;
  insurance_expires_on: unknown;
  plate_expires_on: unknown;
};

export type ComplianceDocument = {
  vehicle_id: string;
  kind: string;
  expires_at: unknown;
};

export type ComplianceInspection = {
  vehicle_id: string;
  inspection_due_on: unknown;
};

export type ComplianceDirectory = {
  failed: boolean;
  vehicles: ComplianceVehicle[];
  documents: ComplianceDocument[];
  inspections: ComplianceInspection[];
  inspectionInstalled: boolean;
  inspectionDegraded: boolean;
  documentsIncomplete: boolean;
  truncated: boolean;
};

export type VehicleComplianceRow = {
  vehicleId: string;
  status: ComplianceStatus;
  items: ComplianceItem[];
};

export type VehicleComplianceResponse =
  | {
      status: "disabled";
      reason: null;
      today: null;
      truncated: false;
      inspectionInstalled: false;
      rows: [];
      notes: [];
    }
  | {
      status: "unavailable";
      reason: string;
      today: null;
      truncated: false;
      inspectionInstalled: false;
      rows: [];
      notes: string[];
    }
  | {
      status: "ready";
      reason: null;
      today: string;
      truncated: boolean;
      inspectionInstalled: boolean;
      rows: VehicleComplianceRow[];
      notes: string[];
    };

export const COMPLIANCE_DISABLED: VehicleComplianceResponse = {
  status: "disabled",
  reason: null,
  today: null,
  truncated: false,
  inspectionInstalled: false,
  rows: [],
  notes: [],
};

export const COMPLIANCE_UNAVAILABLE: VehicleComplianceResponse = {
  status: "unavailable",
  reason: "Compliance Could Not Be Loaded",
  today: null,
  truncated: false,
  inspectionInstalled: false,
  rows: [],
  notes: ["Compliance Could Not Be Loaded"],
};

type PageError = { code?: string; message?: string };

export type PageResult = {
  data: unknown[] | null;
  error: PageError | null;
};

/** A missing proposed table or column. The Vehicles table itself is not optional. */
export function relationMissing(error: PageError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST204") return true;
  const message = error.message ?? "";
  return /does not exist|schema cache/i.test(message) && /maintenance_due_v1|maintenance_log_v1|inspection_due_on/.test(message);
}

/**
 * Inclusive range [from, to] asks for COMPLIANCE_PAGE + 1 rows.
 * The extra row means another page. After COMPLIANCE_MAX_PAGES full pages
 * the read stops and reports truncated. A thrown or failed read does not throw.
 */
export async function readCappedPages(
  load: (from: number, to: number) => PromiseLike<PageResult>,
): Promise<{ rows: unknown[]; truncated: boolean; missing: boolean; failed: boolean }> {
  const rows: unknown[] = [];
  try {
    for (let page = 0; page < COMPLIANCE_MAX_PAGES; page++) {
      const from = page * COMPLIANCE_PAGE;
      const result = await load(from, from + COMPLIANCE_PAGE);
      if (result.error) {
        const missing = relationMissing(result.error);
        return { rows, truncated: false, missing, failed: !missing };
      }
      const chunk = result.data ?? [];
      const more = chunk.length > COMPLIANCE_PAGE;
      rows.push(...chunk.slice(0, COMPLIANCE_PAGE));
      if (!more) return { rows, truncated: false, missing: false, failed: false };
    }
    return { rows, truncated: true, missing: false, failed: false };
  } catch {
    return { rows, truncated: false, missing: false, failed: true };
  }
}

/** Expired is before today. Today through day 30 is Due In 30 Days. A date column is not shifted. */
export function complianceStatus(today: string, expiresOn: unknown): ComplianceStatus {
  const todayDate = parseIsoDate(today);
  const date = parseIsoDate(expiresOn);
  if (!todayDate || !date) return "unknown";
  if (date < todayDate) return "expired";
  const dueThrough = addCalendarDays(todayDate, COMPLIANCE_DUE_DAYS);
  if (!dueThrough || date <= dueThrough) return "due_30";
  return "ok";
}

export function worstStatus(statuses: ComplianceStatus[]): ComplianceStatus {
  if (!statuses.length) return "unknown";
  return statuses.reduce((best, status) => (RANK[status] > RANK[best] ? status : best));
}

export function complianceNotes(directory: Pick<ComplianceDirectory, "truncated" | "inspectionInstalled" | "inspectionDegraded" | "documentsIncomplete">): string[] {
  const notes: string[] = [];
  if (directory.truncated) notes.push("Compliance Is Truncated");
  if (directory.inspectionDegraded) notes.push("Inspection Expiry Could Not Be Fully Read");
  else if (!directory.inspectionInstalled) notes.push("Inspection Expiry Is Not On Record");
  if (directory.documentsIncomplete) notes.push("Document Expiry Could Not Be Fully Read");
  return notes;
}

type DocBucket = "registration" | "insurance" | "inspection" | "emissions";

/** Current document kinds whose expiry is operational. Title, lien, and purchase stay out. */
export const COMPLIANCE_DOCUMENT_KINDS = [
  "registration",
  "insurance_card",
  "insurance_policy",
  "insurance_renewal",
  "inspection_cert",
  "inspection",
  "emissions",
] as const;

function docBucket(kind: string): DocBucket | null {
  if (isOwnerOnlyDocKind(kind)) return null;
  const slot = slotForKind(kind);
  if (slot === "registration" || slot === "insurance_card" || slot === "inspection_cert" || slot === "emissions") {
    return slot === "insurance_card" ? "insurance" : slot === "inspection_cert" ? "inspection" : slot;
  }
  return null;
}

function statusFromDates(today: string, dates: unknown[], required: boolean): ComplianceStatus | "skip" {
  const known = dates.map((date) => parseIsoDate(date)).filter((date): date is string => date != null);
  if (!known.length) return required ? "unknown" : "skip";
  return worstStatus(known.map((date) => complianceStatus(today, date)));
}

export function buildVehicleCompliance(today: string, directory: ComplianceDirectory): VehicleComplianceRow[] {
  const documents = new Map<string, ComplianceDocument[]>();
  for (const document of directory.documents) {
    const list = documents.get(document.vehicle_id) ?? [];
    list.push(document);
    documents.set(document.vehicle_id, list);
  }
  const inspections = new Map<string, unknown[]>();
  if (directory.inspectionInstalled && !directory.inspectionDegraded) {
    for (const row of directory.inspections) {
      const list = inspections.get(row.vehicle_id) ?? [];
      list.push(row.inspection_due_on);
      inspections.set(row.vehicle_id, list);
    }
  }

  return directory.vehicles.map((vehicle) => {
    const buckets: Record<DocBucket | "plate", unknown[]> = {
      registration: [vehicle.registration_expires_on],
      insurance: [vehicle.insurance_expires_on],
      plate: [vehicle.plate_expires_on],
      inspection: inspections.get(vehicle.id) ?? [],
      emissions: [],
    };
    for (const document of documents.get(vehicle.id) ?? []) {
      const bucket = docBucket(document.kind);
      if (bucket) buckets[bucket].push(document.expires_at);
    }

    const items: ComplianceItem[] = [];
    for (const key of ["registration", "insurance", "plate"] as const) {
      const status = statusFromDates(today, buckets[key], true);
      items.push({ key, label: ITEM_LABEL[key], status: status === "skip" ? "unknown" : status });
    }
    const inspection = directory.inspectionDegraded ? "unknown" : statusFromDates(today, buckets.inspection, true);
    items.push({ key: "inspection", label: ITEM_LABEL.inspection, status: inspection === "skip" ? "unknown" : inspection });
    const emissions = statusFromDates(today, buckets.emissions, false);
    if (emissions !== "skip") items.push({ key: "emissions", label: ITEM_LABEL.emissions, status: emissions });

    let status = worstStatus(items.map((item) => item.status));
    if (directory.documentsIncomplete && status === "ok") status = "unknown";
    return { vehicleId: vehicle.id, status, items };
  });
}
