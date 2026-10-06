// Fleet Inbox — pure, client-safe rules: document vocabulary, source authority,
// vehicle matching and change proposals. No I/O, so the same rules run in the
// analyzer, the apply step (revalidation) and the tests.
import { checkVin, normalizeVin } from "@/lib/vin";

export const DOC_GROUPS = [
  { group: "Ownership", classes: ["title", "registration", "bill_of_sale", "purchase_agreement"] },
  { group: "Insurance", classes: ["insurance_card", "insurance_policy", "insurance_renewal"] },
  { group: "Maintenance", classes: ["service_receipt", "repair_invoice", "oil_service", "tires", "brakes", "parts_receipt"] },
  { group: "Inspections", classes: ["inspection"] },
  { group: "Finance", classes: ["purchase_document", "loan_document", "payoff_statement", "lender_statement"] },
  { group: "Incidents", classes: ["accident_report", "damage_document", "police_report", "tow_receipt"] },
  { group: "Photos / Evidence", classes: ["odometer_photo", "vin_photo", "acquisition_photo", "condition_photo", "repair_photo", "damage_photo"] },
  { group: "Other", classes: ["gps_document", "warranty", "other", "unknown"] },
] as const;

export const DOC_CLASSES = DOC_GROUPS.flatMap((g) => g.classes as readonly string[]);
export type DocClass = string;

export function docClassLabel(c: string | null | undefined): string {
  if (!c) return "Unknown";
  return c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
export function docGroupOf(c: string | null | undefined): string {
  // Legacy vehicle-doc kinds map into the same groups.
  const legacy: Record<string, string> = {
    lien_release: "Ownership", purchase: "Finance", inspection_cert: "Inspections", emissions: "Inspections",
  };
  if (c && legacy[c]) return legacy[c];
  return DOC_GROUPS.find((g) => (g.classes as readonly string[]).includes(c ?? ""))?.group ?? "Other";
}

/** Fields restricted to the vehicle_finance boundary (Manager+). */
export const FINANCE_FIELDS = [
  "legal_owner", "lienholder", "purchase_price", "purchase_date", "payoff_amount", "loan_reference", "monthly_payment",
] as const;
export function isFinanceField(f: string) {
  return (FINANCE_FIELDS as readonly string[]).includes(f);
}

/** Extracted field -> canonical vehicles column (non-finance only). */
export const VEHICLE_FIELDS = [
  "vin", "year", "make", "model", "trim", "color", "body_type", "license_plate", "plate_state",
  "title_number", "title_status", "registration_number", "registration_state", "registration_expires_on",
  "insurance_carrier", "insurance_policy_number", "insurance_effective_on", "insurance_expires_on",
  "current_odometer",
] as const;
export type VehicleField = (typeof VEHICLE_FIELDS)[number];

export const FIELD_LABELS: Record<string, string> = {
  vin: "VIN", year: "Year", make: "Make", model: "Model", trim: "Trim", color: "Color", body_type: "Body type",
  license_plate: "Plate", plate_state: "Plate state", title_number: "Title number", title_status: "Title status",
  registration_number: "Registration number", registration_state: "Registration state",
  registration_expires_on: "Registration expiry", insurance_carrier: "Insurance carrier",
  insurance_policy_number: "Policy number", insurance_effective_on: "Insurance effective",
  insurance_expires_on: "Insurance expiration", current_odometer: "Mileage",
  legal_owner: "Legal owner", lienholder: "Lienholder", purchase_price: "Purchase price",
  purchase_date: "Purchase date", payoff_amount: "Payoff amount", loan_reference: "Loan reference",
  monthly_payment: "Monthly payment",
};

/** Always need explicit confirmation; never in "Accept Safe Changes". */
export const HIGH_RISK = new Set<string>([
  "vin", "title_number", "title_status", ...FINANCE_FIELDS,
]);
/** Identity fields: a differing existing value is a conflict, never an update. */
const IDENTITY = new Set(["vin", "year", "make", "model", "license_plate", "plate_state", "title_number"]);

// Source authority: higher wins. Unlisted class for a field = 10 (context only).
const A = (m: Record<string, number>) => m;
const AUTH: Record<string, Record<string, number>> = {
  vin: A({ title: 100, vin_photo: 100, registration: 80, insurance_card: 60, insurance_policy: 60, insurance_renewal: 60, purchase_agreement: 50, bill_of_sale: 50, service_receipt: 40, repair_invoice: 40, oil_service: 40, inspection: 45 }),
  legal_owner: A({ title: 100, registration: 80, purchase_agreement: 60, bill_of_sale: 60, insurance_card: 40, insurance_policy: 40 }),
  lienholder: A({ title: 100, loan_document: 80, payoff_statement: 80, lender_statement: 80, registration: 60 }),
  current_odometer: A({ odometer_photo: 100, inspection: 80, service_receipt: 60, repair_invoice: 60, oil_service: 60, tires: 60, brakes: 60, title: 50 }),
  purchase_price: A({ purchase_agreement: 100, bill_of_sale: 90, purchase_document: 80 }),
  insurance_carrier: A({ insurance_policy: 100, insurance_renewal: 100, insurance_card: 90 }),
  insurance_policy_number: A({ insurance_policy: 100, insurance_renewal: 100, insurance_card: 90 }),
  insurance_effective_on: A({ insurance_policy: 100, insurance_renewal: 100, insurance_card: 90 }),
  insurance_expires_on: A({ insurance_policy: 100, insurance_renewal: 100, insurance_card: 90 }),
  registration_number: A({ registration: 100, title: 60 }),
  registration_expires_on: A({ registration: 100 }),
  license_plate: A({ registration: 100, title: 60, insurance_card: 40 }),
  title_number: A({ title: 100, registration: 50 }),
};
const DEFAULT_AUTH = A({ title: 90, registration: 80, purchase_agreement: 70, bill_of_sale: 70, insurance_card: 60, insurance_policy: 60, inspection: 55, service_receipt: 50, repair_invoice: 50 });
export const STAFF_AUTHORITY = 70; // manual staff entry without a document

export function authorityOf(field: string, docClass: string | null | undefined): number {
  const table = AUTH[field] ?? DEFAULT_AUTH;
  return table[docClass ?? ""] ?? 10;
}

export type Confidence = "high" | "medium" | "low";
export type ExtractedField = { value: string; confidence: Confidence; raw?: string; note?: string };
export type ExtractedEntry = { page?: number | null; fields: Record<string, ExtractedField> };

export type ExistingVehicle = {
  id: string; vin: string | null; unit_number: string | null; license_plate: string | null; plate_state: string | null;
  title_number: string | null; registration_number: string | null; year: number | null; make: string | null; model: string | null;
  [k: string]: unknown;
};

/** Current authority recorded for (vehicle, field). Absent = staff-entered or blank. */
export type ProvenanceIndex = Record<string, Record<string, number>>;

export type Change = {
  field: string; label: string; current: string | null; proposed: string; confidence: Confidence;
  authority: number; currentAuthority: number | null; risk: "high" | "normal";
  kind: "fill" | "update" | "conflict"; safe: boolean; note?: string;
};

export type ProposalDraft = {
  kind: "new" | "match" | "conflict" | "unidentified";
  vin: string | null; vinRaw: string | null;
  vinCheck: { formatValid: boolean; checkDigitValid: boolean | null; problem: string | null } | null;
  matchVehicleId: string | null; matchBasis: string | null;
  identity: { year?: string; make?: string; model?: string; unit?: string };
  changes: Change[]; issues: string[];
};

const up = (s: unknown) => String(s ?? "").trim().toUpperCase();
function norm(field: string, v: string): string {
  const s = String(v ?? "").trim();
  if (field === "vin") return normalizeVin(s);
  if (field === "license_plate" || field === "plate_state" || field === "registration_state") return s.toUpperCase().replace(/\s+/g, "");
  if (field === "year" || field === "current_odometer") return s.replace(/[^0-9]/g, "");
  return s;
}
function same(field: string, a: unknown, b: unknown) {
  if (a == null || a === "") return false;
  return up(norm(field, String(a))) === up(norm(field, String(b)));
}

/**
 * Deterministic identity hierarchy: VIN → unit number → plate (+state) →
 * title / registration number. Year/make/model are never sufficient on their own.
 */
export function matchVehicle(
  f: Record<string, ExtractedField>, vehicles: ExistingVehicle[],
): { vehicle: ExistingVehicle | null; basis: string | null; vinConflict: ExistingVehicle | null } {
  const vin = f.vin?.value ? normalizeVin(f.vin.value) : "";
  if (vin.length === 17) {
    const v = vehicles.find((x) => up(x.vin) === vin);
    if (v) return { vehicle: v, basis: "vin", vinConflict: null };
  }
  const tryKey = (key: keyof ExistingVehicle, val?: string, basis?: string) => {
    if (!val) return null;
    const n = up(norm(String(key), val));
    if (!n) return null;
    const hits = vehicles.filter((x) => up(norm(String(key), String(x[key] ?? ""))) === n);
    return hits.length === 1 ? { v: hits[0], basis: basis ?? String(key) } : null;
  };
  const hit =
    tryKey("unit_number", f.unit_number?.value, "unit_number") ??
    tryKey("license_plate", f.license_plate?.value, "plate") ??
    tryKey("title_number", f.title_number?.value, "title_number") ??
    tryKey("registration_number", f.registration_number?.value, "registration_number");
  if (hit) {
    // Matched by another identifier but VINs disagree → conflict, never merge.
    const conflict = vin && hit.v.vin && up(hit.v.vin) !== vin ? hit.v : null;
    return { vehicle: hit.v, basis: hit.basis, vinConflict: conflict };
  }
  return { vehicle: null, basis: null, vinConflict: null };
}

export function buildProposal(
  entry: ExtractedEntry, docClass: string, vehicles: ExistingVehicle[], prov: ProvenanceIndex = {},
): ProposalDraft {
  const f = entry.fields ?? {};
  const issues: string[] = [];
  const vinRaw = f.vin?.raw ?? f.vin?.value ?? null;
  const vin = f.vin?.value ? normalizeVin(f.vin.value) : null;
  let vinCheck: ProposalDraft["vinCheck"] = null;
  let vinUsable = false;
  if (vin) {
    const c = checkVin(vin);
    vinCheck = { formatValid: c.formatValid, checkDigitValid: c.checkDigitValid, problem: c.problem };
    if (!c.formatValid) issues.push(`VIN "${vinRaw}" is not valid: ${c.problem}`);
    else if (c.checkDigitValid === false) issues.push("VIN check digit does not match — verify against the document.");
    vinUsable = c.formatValid;
  }
  const identity = { year: f.year?.value, make: f.make?.value, model: f.model?.value, unit: f.unit_number?.value };

  const { vehicle, basis, vinConflict } = matchVehicle(vinUsable ? f : { ...f, vin: undefined as any }, vehicles);
  const changes: Change[] = [];

  if (!vehicle) {
    if (!vinUsable) {
      issues.push(vin ? "Cannot identify the vehicle: the VIN is unreadable or invalid." : "No VIN or other identifier found.");
      return { kind: "unidentified", vin, vinRaw, vinCheck, matchVehicleId: null, matchBasis: null, identity, changes: proposedFills(f, docClass, null, prov), issues };
    }
    if (f.vin && f.vin.confidence === "low") issues.push("VIN read with low confidence.");
    return { kind: "new", vin, vinRaw, vinCheck, matchVehicleId: null, matchBasis: null, identity, changes: proposedFills(f, docClass, null, prov), issues };
  }

  changes.push(...proposedFills(f, docClass, vehicle, prov[vehicle.id] ? { [vehicle.id]: prov[vehicle.id] } : {}));
  if (vinConflict) {
    issues.push(`VIN conflict: vehicle on file has ${vinConflict.vin}, document says ${vin}.`);
  }
  const conflict = !!vinConflict || changes.some((c) => c.kind === "conflict");
  if (changes.some((c) => c.field === "current_odometer" && c.kind === "conflict")) {
    issues.push("Possible odometer or extraction issue: mileage is lower than the value on file.");
  }
  return {
    kind: conflict ? "conflict" : "match", vin, vinRaw, vinCheck,
    matchVehicleId: vehicle.id, matchBasis: basis, identity, changes, issues,
  };
}

function proposedFills(
  f: Record<string, ExtractedField>, docClass: string, vehicle: ExistingVehicle | null, prov: ProvenanceIndex,
): Change[] {
  const out: Change[] = [];
  const vp = vehicle ? prov[vehicle.id] ?? {} : {};
  for (const field of [...VEHICLE_FIELDS]) {
    const ef = f[field];
    if (!ef?.value) continue;
    const proposed = norm(field, ef.value);
    if (!proposed) continue;
    const curRaw = vehicle ? vehicle[field] : null;
    const current = curRaw == null || curRaw === "" ? null : String(curRaw);
    if (current != null && same(field, current, proposed)) continue;
    const authority = authorityOf(field, docClass);
    const currentAuthority = current == null ? null : vp[field] ?? STAFF_AUTHORITY;
    const risk = HIGH_RISK.has(field) ? "high" : "normal";
    let kind: Change["kind"] = current == null ? "fill" : "update";
    let note: string | undefined;
    if (current != null) {
      if (IDENTITY.has(field)) { kind = "conflict"; note = "Differs from the identity on file."; }
      else if (field === "current_odometer" && Number(proposed) < Number(current)) { kind = "conflict"; note = "Lower than the mileage on file."; }
      else if (currentAuthority != null && authority < currentAuthority) { kind = "conflict"; note = "Current value comes from a higher-authority source."; }
    }
    const safe = kind !== "conflict" && risk === "normal" && ef.confidence !== "low";
    out.push({ field, label: FIELD_LABELS[field] ?? field, current, proposed, confidence: ef.confidence, authority, currentAuthority, risk, kind, safe, note });
  }
  return out;
}

/** Default weekly rate for a newly created vehicle, by body type. */
export function defaultWeeklyRate(bodyType: string | null | undefined): number {
  const b = (bodyType ?? "").toLowerCase();
  if (b === "suv") return 375;
  if (b === "minivan" || b === "xl" || b === "van") return 400;
  return 350;
}
