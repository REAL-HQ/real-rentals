// Field-aware display normalization for vehicle presentation fields.
//
// Source documents often print "FORD FUSION". The UI shows "Ford Fusion".
// Only descriptive words are touched — identifiers (VIN, plate, policy,
// title or registration numbers, unit numbers) are never passed through here.
// The original extracted text stays in vehicle_field_provenance.raw_value.

/** Fields that may be re-cased for display. Everything else is left alone. */
export const NORMALIZED_FIELDS = new Set(["make", "model", "trim", "color"]);

// Real acronyms / model codes that must stay upper-case.
const KEEP_UPPER = new Set([
  "BMW", "GMC", "VW", "AMG", "GT", "GTI", "SE", "LE", "XLE", "SEL", "SL", "SLE", "SLT", "LT", "LS", "LTZ",
  "EX", "LX", "DX", "XL", "XLT", "SUV", "AWD", "FWD", "RWD", "4WD", "2WD", "RS", "SS", "ST", "SV", "SR", "SR5",
  "TRD", "HD", "EV", "RX", "NX", "ES", "IS", "GX", "LX", "CX", "MX", "QX", "FX", "II", "III", "IV",
]);

function caseWord(w: string): string {
  if (!w) return w;
  if (/\d/.test(w) || KEEP_UPPER.has(w)) return w; // CX-5, F-150, SR5
  return w
    .split("-")
    .map((part) => (KEEP_UPPER.has(part) || /\d/.test(part) ? part : part.charAt(0) + part.slice(1).toLowerCase()))
    .join("-");
}

/** "FORD FUSION" → "Ford Fusion". Mixed-case input is assumed intentional and returned unchanged. */
export function normalizeDisplayText(value: string): string {
  const s = value.trim().replace(/\s+/g, " ");
  if (!/[A-Z]/.test(s) || s !== s.toUpperCase()) return s;
  return s.split(" ").map(caseWord).join(" ");
}

export function normalizeDisplayField<T>(field: string, value: T): T {
  if (typeof value !== "string" || !NORMALIZED_FIELDS.has(field)) return value;
  return normalizeDisplayText(value) as unknown as T;
}

/** Display-only title for cards: also fixes all-lowercase input ("ford fusion" → "Ford Fusion"). Never used for identifiers. */
export function displayVehicleWord(value: string): string {
  const s = value.trim();
  if (s && s === s.toLowerCase() && /[a-z]/.test(s)) return normalizeDisplayText(s.toUpperCase());
  return normalizeDisplayText(s);
}

/** Display-only person name: "khalique branch" → "Khalique Branch". Mixed-case input is assumed intentional. Never used for identifiers. */
export function displayPersonName(value: string): string {
  const s = value.trim().replace(/\s+/g, " ");
  if (s && s === s.toLowerCase() && /[a-z]/.test(s)) {
    return s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return s;
}
