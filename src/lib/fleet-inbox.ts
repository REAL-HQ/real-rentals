// Fleet Inbox — pure, client-safe rules: document vocabulary, source authority,
// vehicle matching and change proposals. No I/O, so the same rules run in the
// analyzer, the apply step (revalidation) and the tests.
import { checkVin, normalizeVin } from "@/lib/vin";
import { normalizeDisplayField } from "@/lib/display-normalize";

export const DOC_GROUPS = [
  { group: "Ownership", classes: ["title", "registration", "bill_of_sale", "purchase_agreement"] },
  { group: "Insurance", classes: ["insurance_card", "insurance_policy", "insurance_renewal"] },
  { group: "Maintenance", classes: ["service_receipt", "repair_invoice", "oil_service", "tires", "brakes", "parts_receipt"] },
  { group: "Inspections", classes: ["inspection"] },
  { group: "Finance", classes: ["purchase_document", "loan_document", "payoff_statement", "lender_statement"] },
  { group: "Payments / Receipts", classes: ["payment_confirmation", "bank_transfer", "vendor_invoice", "expense_receipt", "purchase_payment", "prep_cost_receipt", "registration_fee_receipt", "refund_confirmation", "deposit_receipt"] },
  { group: "Incidents", classes: ["accident_report", "damage_document", "police_report", "tow_receipt"] },
  { group: "Photos / Evidence", classes: ["odometer_photo", "vin_photo", "acquisition_photo", "condition_photo", "repair_photo", "damage_photo"] },
  // Signed renter paperwork: filed to the renter's application, never applied to a vehicle.
  { group: "Renters", classes: ["rental_agreement"] },
  { group: "Other", classes: ["gps_document", "warranty", "other", "unknown"] },
] as const;

export const DOC_CLASSES = DOC_GROUPS.flatMap((g) => g.classes as readonly string[]);
export type DocClass = string;

/**
 * Photographs, as opposed to paperwork.
 *
 * A photo is first-hand evidence of what is visible ON the car — the plate, the
 * colour, the shape, the number on the odometer — and says nothing about what
 * an office recorded: when registration lapses, who holds the title, whether
 * anything is insured. The authority table below encodes that: strong where the
 * camera is the best witness, weak everywhere else.
 */
export const PHOTO_CLASSES = ["odometer_photo", "vin_photo", "acquisition_photo", "condition_photo", "repair_photo", "damage_photo"] as const;
const PHOTO_CLASS_SET = new Set<string>(PHOTO_CLASSES);
export function isPhotoClass(c: string | null | undefined): boolean {
  return PHOTO_CLASS_SET.has(String(c ?? ""));
}

/**
 * Upload channels where a person reviews every field before it is written.
 *
 * Uploads made FROM a vehicle are not a bulk import: the operator is looking at
 * that one car and will accept or reject each value in Vehicle Suggestions. Safe
 * Autofill therefore never runs for them. A channel missing from this set gets
 * Fleet Inbox behaviour, which is the documented default for an unlabelled
 * batch — so every new staff-facing channel must be added HERE, in one place,
 * rather than bolted onto a comparison at the call site.
 */
export const STAFF_REVIEW_CHANNELS = ["vehicle_profile", "vehicle_photo"] as const;
const STAFF_REVIEW_SET = new Set<string>(STAFF_REVIEW_CHANNELS);
export function isStaffReviewChannel(c: string | null | undefined): boolean {
  return STAFF_REVIEW_SET.has(String(c ?? ""));
}

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

/**
 * Paperwork facts. Never taken from a photograph, whatever the model returns —
 * these are office records, and a photo of a car is not evidence of any of them.
 */
export const PHOTO_NEVER_FIELDS = new Set<string>([
  "registration_number", "registration_state", "registration_expires_on",
  "title_number", "title_status",
  "insurance_carrier", "insurance_policy_number", "insurance_effective_on", "insurance_expires_on",
  ...FINANCE_FIELDS,
]);

/**
 * Always need explicit confirmation; never in "Accept Safe Changes".
 *
 * The plate is here because the rule "VIN, plate and mileage need individual
 * approval" was only ever enforced by the review panel: `safe: false` stopped
 * bulk approval, but a request that named the field directly — not one the UI
 * can produce — applied an extracted plate into a blank column with nothing
 * ticked. The apply path is the authorization layer, so the requirement lives
 * here, where both the server check and the confirmation UI read it.
 *
 * Mileage is not in this list because it is never written to the vehicle at
 * all: it becomes a dated, evidence-backed odometer reading and the history
 * decides current mileage.
 */
export const HIGH_RISK = new Set<string>([
  "vin", "license_plate", "title_number", "title_status", ...FINANCE_FIELDS,
]);
/** Identity fields: a differing existing value is a conflict, never an update. */
const IDENTITY = new Set(["vin", "year", "make", "model", "license_plate", "plate_state", "title_number"]);
/** Year/make/model/VIN must never be written from a plate/unit/title-only match. */
export const IDENTITY_CORE = new Set(["vin", "year", "make", "model"]);
/** Match bases that identify a car without a trustworthy exact VIN. */
export const NON_VIN_MATCH_BASES = new Set([
  "plate", "unit_number", "title_number", "registration_number", "vin_near",
]);

/** OCR-confused character pairs (cost 0.5 instead of 1 in near-VIN distance). */
const OCR_PAIRS: Array<[string, string]> = [
  ["B", "8"], ["8", "B"], ["0", "O"], ["O", "0"], ["1", "I"], ["I", "1"],
  ["1", "L"], ["L", "1"], ["I", "L"], ["L", "I"], ["5", "S"], ["S", "5"],
  ["2", "Z"], ["Z", "2"], ["9", "8"], ["8", "9"],
];
const OCR_COST = new Map<string, number>(OCR_PAIRS.map(([a, b]) => [`${a}${b}`, 0.5]));

/** Edit distance with OCR confusions cheaper. Returns Infinity if lengths differ. */
export function vinEditDistance(a: string, b: string): number {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  if (x.length !== y.length) return Number.POSITIVE_INFINITY;
  let d = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue;
    d += OCR_COST.get(`${x[i]}${y[i]}`) ?? 1;
  }
  return d;
}

/**
 * Closest existing VIN within edit distance ≤ 2 (OCR-aware).
 * Never invents a car — returns null when no candidate is close enough.
 */
export function findNearVinMatch(
  vin: string,
  vehicles: ExistingVehicle[],
  maxDistance = 2,
): { vehicle: ExistingVehicle; distance: number } | null {
  const needle = normalizeVin(vin);
  if (needle.length !== 17) return null;
  let best: { vehicle: ExistingVehicle; distance: number } | null = null;
  for (const v of vehicles) {
    const cand = normalizeVin(String(v.vin ?? ""));
    if (cand.length !== 17) continue;
    if (cand === needle) continue; // exact is handled elsewhere
    const d = vinEditDistance(needle, cand);
    if (d > maxDistance) continue;
    if (!best || d < best.distance) best = { vehicle: v, distance: d };
  }
  return best;
}

/** Server + client: refuse identity mutation when the match was not an exact VIN. */
export function identityMutationBlocked(matchBasis: string | null | undefined, field: string): boolean {
  if (!matchBasis || !NON_VIN_MATCH_BASES.has(matchBasis)) return false;
  return IDENTITY_CORE.has(field);
}

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

/**
 * What an ordinary photograph is worth, per field, when the table above has no
 * entry for that photo class.
 *
 * Deliberately below every paperwork source — a registration card scores 80-100
 * for these — so a photo can fill a blank but can never win an argument with a
 * document. The two cases where a photo IS the best witness are in AUTH itself
 * and keep their 100: a VIN plate in vin_photo, an odometer in odometer_photo.
 * Fields absent here fall through to 10: a mileage number glimpsed in a
 * condition photo is context, not a reading.
 */
const PHOTO_AUTH: Record<string, number> = {
  license_plate: 35, plate_state: 35, color: 35, body_type: 35, make: 35, model: 30, trim: 30, year: 30,
};

export function authorityOf(field: string, docClass: string | null | undefined): number {
  const table = AUTH[field] ?? DEFAULT_AUTH;
  const listed = table[docClass ?? ""];
  if (listed != null) return listed;
  if (isPhotoClass(docClass) && PHOTO_AUTH[field] != null) return PHOTO_AUTH[field];
  return 10;
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
  // Compare only: ignore case/spacing and equivalent standardized values (e.g. DMV "SIL" = "Silver").
  const k = (v: unknown) => up(String(normalizeDisplayField(field, norm(field, String(v))))).replace(/\s+/g, " ").trim();
  return k(a) === k(b);
}

/**
 * Deterministic identity hierarchy: exact VIN → unit number → plate (+state) →
 * title / registration number → near VIN (edit distance ≤ 2). Year/make/model
 * are never sufficient on their own.
 */
export function matchVehicle(
  f: Record<string, ExtractedField>, vehicles: ExistingVehicle[],
  opts?: { allowNearVin?: boolean },
): { vehicle: ExistingVehicle | null; basis: string | null; vinConflict: ExistingVehicle | null; nearDistance?: number } {
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
  if (opts?.allowNearVin !== false && vin.length === 17) {
    const near = findNearVinMatch(vin, vehicles);
    if (near) {
      return {
        vehicle: near.vehicle,
        basis: "vin_near",
        // Differing VIN is always a conflict — human must approve; never auto-create.
        vinConflict: near.vehicle.vin && up(near.vehicle.vin) !== vin ? near.vehicle : near.vehicle,
        nearDistance: near.distance,
      };
    }
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
  // Fleet Inbox: only a 17-char VIN with a valid check digit is trusted for
  // exact match / create. Garbage OCR (e.g. a 7-char date fragment) is ignored.
  let vinExact = false;
  let vinNearCandidate = false;
  if (vin) {
    const c = checkVin(vin);
    vinCheck = { formatValid: c.formatValid, checkDigitValid: c.checkDigitValid, problem: c.problem };
    if (!c.formatValid) {
      issues.push(`VIN "${vinRaw}" is not valid: ${c.problem}`);
    } else if (c.checkDigitValid !== true) {
      issues.push("VIN check digit does not match — will near-match an existing car if close, never create from it.");
      vinNearCandidate = true;
    } else {
      vinExact = true;
    }
  }
  const identity = { year: f.year?.value, make: f.make?.value, model: f.model?.value, unit: f.unit_number?.value };

  // Exact VIN only when check digit is valid. Near-VIN still sees the raw VIN.
  const forExact = vinExact ? f : { ...f, vin: undefined as any };
  let { vehicle, basis, vinConflict, nearDistance } = matchVehicle(forExact, vehicles, { allowNearVin: false });
  if (!vehicle && vin && vin.length === 17 && !vinExact) {
    const near = matchVehicle({ ...f, vin: { value: vin, confidence: f.vin?.confidence ?? "medium" } }, vehicles, { allowNearVin: true });
    if (near.basis === "vin_near" && near.vehicle) {
      vehicle = near.vehicle;
      basis = near.basis;
      vinConflict = near.vinConflict;
      nearDistance = near.nearDistance;
    }
  }
  const changes: Change[] = [];

  if (!vehicle) {
    if (!vinExact) {
      issues.push(vin ? "Cannot identify the vehicle: the VIN is unreadable or invalid." : "No VIN or other identifier found.");
      return { kind: "unidentified", vin, vinRaw, vinCheck, matchVehicleId: null, matchBasis: null, identity, changes: proposedFills(f, docClass, null, prov), issues };
    }
    if (f.vin && f.vin.confidence === "low") issues.push("VIN read with low confidence.");
    return { kind: "new", vin, vinRaw, vinCheck, matchVehicleId: null, matchBasis: null, identity, changes: proposedFills(f, docClass, null, prov), issues };
  }

  changes.push(...proposedFills(f, docClass, vehicle, prov[vehicle.id] ? { [vehicle.id]: prov[vehicle.id] } : {}));
  const gated = gateIdentityChanges(changes, basis, issues);
  if (basis === "vin_near") {
    issues.push(
      `Near-VIN match${nearDistance != null ? ` (distance ${nearDistance})` : ""}: confirm this is the right car — never auto-created.`,
    );
  }
  if (vinConflict) {
    issues.push(`VIN conflict: vehicle on file has ${vinConflict.vin}, document says ${vin}.`);
  }
  const conflict = !!vinConflict || basis === "vin_near" || gated.some((c) => c.kind === "conflict");
  if (gated.some((c) => c.field === "current_odometer" && Number(c.proposed) < Number(c.current ?? 0))) {
    issues.push("Mileage is lower than the value on file — it will be checked against the reading dates.");
  }
  return {
    kind: conflict ? "conflict" : "match", vin, vinRaw, vinCheck,
    matchVehicleId: vehicle.id, matchBasis: basis, identity, changes: gated, issues,
  };
}

/** Plate/unit/title/near-VIN matches never propose year/make/model/VIN writes. */
function gateIdentityChanges(changes: Change[], basis: string | null, issues: string[]): Change[] {
  if (!basis || !NON_VIN_MATCH_BASES.has(basis)) return changes;
  let blocked = false;
  const out = changes.map((c) => {
    if (!IDENTITY_CORE.has(c.field)) return c;
    blocked = true;
    return {
      ...c,
      kind: "conflict" as const,
      safe: false,
      note: c.note
        ? `${c.note} Blocked: identity cannot change from a ${basis} match.`
        : `Blocked: identity cannot change from a ${basis} match — confirm manually.`,
    };
  });
  if (blocked) {
    issues.push(`Identity fields (year/make/model/VIN) were not proposed for write — match was by ${basis}, not an exact VIN.`);
  }
  return out;
}

function proposedFills(
  f: Record<string, ExtractedField>, docClass: string, vehicle: ExistingVehicle | null, prov: ProvenanceIndex,
): Change[] {
  const out: Change[] = [];
  const vp = vehicle ? prov[vehicle.id] ?? {} : {};
  const photo = isPhotoClass(docClass);
  for (const field of [...VEHICLE_FIELDS]) {
    // A camera can see the car. It cannot see when the registration lapses, who
    // holds the title or whether anything is insured — and a model asked to
    // read a photo will cheerfully supply all three. Refuse them here, in the
    // rules both the analyzer and the apply-time revalidation run, rather than
    // trusting a prompt to stay polite.
    if (photo && PHOTO_NEVER_FIELDS.has(field)) continue;
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
      else if (field === "current_odometer") { kind = "update"; note = Number(proposed) < Number(current) ? "Lower than current mileage — kept in mileage history by its date; current mileage only changes if this reading is newer." : "Recorded in mileage history."; }
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

/**
 * Soft suggestion: when a condition photo in a batch has no identifier, prefer
 * the batch's already-matched vehicle if every matched item in the batch
 * points at the same car. Never auto-applies.
 */
export function suggestBatchVehicle(
  matchedVehicleIds: Array<string | null | undefined>,
): string | null {
  const ids = [...new Set(matchedVehicleIds.filter((x): x is string => !!x))];
  return ids.length === 1 ? ids[0] : null;
}
