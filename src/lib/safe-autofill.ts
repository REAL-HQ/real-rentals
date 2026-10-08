// Safe Autofill — pure rules (no I/O). Decides which blank, non-sensitive vehicle
// fields may be filled from a document without a human click. Everything else
// stays a suggestion. An exact VIN match does NOT make every field trustworthy:
// each field must pass its own confidence, format and compatibility checks.
import { checkVin, normalizeVin } from "@/lib/vin";
import { normalizeDisplayField } from "@/lib/display-normalize";

/** The only fields autofill may ever write (and only when blank). */
export const AUTO_FIELDS = ["trim", "body_type", "color", "fuel_type", "seats"] as const;
/** Approved policy also names Engine and Drivetrain; the vehicle profile has no columns for them yet, so they are never written. */
export const AUTO_FIELDS_NOT_STORED = ["engine", "drivetrain"] as const;
/** Fields that always need a person, whatever the evidence says. */
export const MANUAL_ONLY_FIELDS = [
  "vin", "license_plate", "plate_state", "current_odometer", "year", "make", "model",
  "weekly_rate", "monthly_rate", "daily_rate", "deposit_amount", "status",
  "title_number", "title_status", "legal_owner", "lienholder", "purchase_price", "purchase_date", "payoff_amount", "loan_reference", "monthly_payment",
  "insurance_carrier", "insurance_policy_number", "insurance_effective_on", "insurance_expires_on",
  "registration_number", "registration_state", "registration_expires_on",
] as const;
/** Document classes trusted for specs. A manufacturer window sticker would qualify, but there is no such class yet. */
export const AUTO_SOURCES = ["title", "registration"] as const;

export type AutofillSettings = { enabled: boolean; daily_cap: number; paused_reason?: string | null; paused_at?: string | null };
export const DEFAULT_AUTOFILL_SETTINGS: AutofillSettings = { enabled: false, daily_cap: 50, paused_reason: null, paused_at: null };
export function readAutofillSettings(v: unknown): AutofillSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const cap = Number(o.daily_cap);
  return {
    enabled: o.enabled === true,
    daily_cap: Number.isFinite(cap) && cap >= 1 && cap <= 500 ? Math.floor(cap) : DEFAULT_AUTOFILL_SETTINGS.daily_cap,
    paused_reason: typeof o.paused_reason === "string" ? o.paused_reason : null,
    paused_at: typeof o.paused_at === "string" ? o.paused_at : null,
  };
}

// ---- Body type --------------------------------------------------------------
const BODY_WORDS: Record<string, string> = {
  SEDAN: "sedan", SD: "sedan", "4S": "sedan",
  SUV: "suv", "SPORT UTILITY": "suv", UT: "suv", UTIL: "suv", UTILITY: "suv",
  WAGON: "wagon", SW: "wagon", "STATION WAGON": "wagon",
  HATCHBACK: "hatchback", HB: "hatchback",
  CONVERTIBLE: "convertible", CV: "convertible",
  COUPE: "coupe", CP: "coupe",
  PICKUP: "truck", PK: "truck", TRUCK: "truck",
  MINIVAN: "minivan", VAN: "van", VN: "van",
};
/**
 * "4D" only says four doors. It means Sedan only for nameplates whose
 * four-door body is sold solely as a sedan (their hatchbacks/wagons are 5D,
 * coupes 2D). Anything not listed stays for review.
 */
const FOUR_DOOR_SEDAN_MODELS = new Set([
  "FUSION", "TAURUS", "CAMRY", "AVALON", "COROLLA", "ACCORD", "CIVIC", "ALTIMA", "MAXIMA", "SENTRA", "VERSA",
  "MALIBU", "IMPALA", "CRUZE", "SONATA", "ELANTRA", "OPTIMA", "K5", "FORTE", "CHARGER", "300", "PASSAT", "JETTA", "LEGACY",
]);
export function normalizeBodyType(raw: string, model: string | null | undefined): string | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return null;
  if (BODY_WORDS[s]) return BODY_WORDS[s];
  if (/^4\s?D(R|OOR)?$/.test(s) || s === "SEDAN 4D" || s === "4D SEDAN") {
    const m = String(model ?? "").trim().toUpperCase().split(/\s+/)[0];
    return FOUR_DOOR_SEDAN_MODELS.has(m) ? "sedan" : null;
  }
  return null;
}

const COLORS = new Set(["Black", "White", "Silver", "Gray", "Grey", "Red", "Blue", "Green", "Brown", "Beige", "Gold", "Yellow", "Orange", "Purple", "Maroon", "Tan", "Burgundy"]);
const FUELS: Record<string, string> = { GAS: "Gas", GASOLINE: "Gas", G: "Gas", DIESEL: "Diesel", D: "Diesel", HYBRID: "Hybrid", H: "Hybrid", ELECTRIC: "Electric", E: "Electric", EV: "Electric", FLEX: "Flex Fuel", "FLEX FUEL": "Flex Fuel", FFV: "Flex Fuel" };

/** Normalize one extracted value; null = not safe to store automatically. */
export function normalizeAutoValue(field: string, raw: string, vehicle: { model?: string | null; body_type?: string | null }): string | number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  switch (field) {
    case "body_type": return normalizeBodyType(v, vehicle.model);
    case "color": { const c = normalizeDisplayField("color", v); return COLORS.has(String(c)) ? (c === "Grey" ? "Gray" : String(c)) : null; }
    case "fuel_type": return FUELS[v.toUpperCase()] ?? null;
    case "seats": {
      if (!/^\d{1,2}$/.test(v)) return null;
      const n = Number(v);
      if (n < 2 || n > 15) return null;
      // Compatible with known specs: sedans/coupes never seat more than 6.
      if (["sedan", "coupe", "convertible"].includes(String(vehicle.body_type ?? "")) && n > 6) return null;
      return n;
    }
    case "trim": return /^[A-Za-z0-9][A-Za-z0-9 .\-/+]{0,29}$/.test(v) ? normalizeDisplayField("trim", v) : null;
    default: return null;
  }
}

export type AutofillVehicle = { id: string; vin: string | null; model: string | null; body_type?: string | null } & Record<string, unknown>;
export type AutofillField = { value: string; confidence: string; raw?: string };
export type AutofillCandidate = { field: string; value: string | number; raw: string; confidence: string };
export type AutofillSkip = { field: string; reason: string };

const isBlank = (x: unknown) => x == null || (typeof x === "string" && x.trim() === "");

/**
 * Decide what may be filled. `otherEvidence` = the same field from every other
 * document naming this VIN; any disagreement blocks the fill.
 */
export function evaluateAutofill(input: {
  vehicle: AutofillVehicle; docClass: string | null; proposalVin: string | null;
  fields: Record<string, AutofillField>; otherEvidence: Record<string, string[]>;
}): { fill: AutofillCandidate[]; skipped: AutofillSkip[] } {
  const fill: AutofillCandidate[] = []; const skipped: AutofillSkip[] = [];
  const { vehicle, docClass, fields } = input;
  if (!AUTO_SOURCES.includes((docClass ?? "") as any)) return { fill, skipped: [{ field: "*", reason: "Source is not a title or registration" }] };
  const pv = normalizeVin(input.proposalVin ?? "");
  const vv = normalizeVin(vehicle.vin ?? "");
  if (!pv || pv !== vv || !checkVin(pv).formatValid) return { fill, skipped: [{ field: "*", reason: "No exact, valid VIN match" }] };
  for (const field of AUTO_FIELDS) {
    const f = fields[field];
    if (!f || isBlank(f.value)) continue;
    if (f.confidence !== "high") { skipped.push({ field, reason: "Not high confidence" }); continue; }
    if (!isBlank(vehicle[field])) { skipped.push({ field, reason: "Field already has a value" }); continue; }
    const value = normalizeAutoValue(field, f.value, vehicle);
    if (value == null) { skipped.push({ field, reason: "Value format not verified" }); continue; }
    const others = (input.otherEvidence[field] ?? []).map((o) => normalizeAutoValue(field, o, vehicle));
    if (others.some((o) => o == null || String(o) !== String(value))) { skipped.push({ field, reason: "Other documents disagree" }); continue; }
    fill.push({ field, value, raw: f.raw ?? f.value, confidence: f.confidence });
  }
  return { fill, skipped };
}
