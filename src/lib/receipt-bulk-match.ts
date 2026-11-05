/**
 * Bulk receipt/invoice upload: decide which car(s) a file belongs to from
 * its filename and (for PDFs) its text layer. Pure, browser + tests.
 *
 * Signals, strongest first:
 *   full VIN (17 chars, no I/O/Q)         -> exact vehicle
 *   "VIN ... last 6/8"                    -> vehicles whose VIN ends with it
 *   plate (compact, >= 5 chars, token)    -> vehicles with that plate
 *   car number ("unit 12", "car #12", "#12") -> vehicles with that unit_number
 * Exactly one vehicle => auto-assign. Zero or several => the team picks.
 */
export type MatchVehicle = { id: string; vin?: string | null; license_plate?: string | null; unit_number?: string | null };

export type MatchBasis = "vin" | "vin_suffix" | "plate" | "unit";
export type FileMatch =
  | { kind: "auto"; vehicleId: string; basis: MatchBasis }
  | { kind: "ambiguous"; candidates: string[]; basis: MatchBasis }
  | { kind: "unmatched" };

const compact = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/g;

export function textTokens(text: string): Set<string> {
  return new Set(text.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
}

/** Filename without extension, with separators turned into spaces. */
export function filenameText(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_\-.]+/g, " ");
}

export function matchFileToVehicles(text: string, vehicles: MatchVehicle[]): FileMatch {
  const upper = text.toUpperCase();

  // 1. Full VINs.
  const vins = new Set((upper.match(VIN_RE) ?? []).filter((v) => /[A-Z]/.test(v) && /\d/.test(v)));
  const byVin = vehicles.filter((v) => v.vin && vins.has(compact(v.vin)));
  const r1 = decide(byVin, "vin");
  if (r1) return r1;

  // 2. VIN suffix next to the word VIN.
  const suffixes = Array.from(upper.matchAll(/\bVIN\b[^A-Z0-9]{0,6}(?:ENDING\s+(?:IN\s+)?|LAST\s*\d\s*)?([A-HJ-NPR-Z0-9]{6,8})\b/g)).map((m) => m[1]);
  const bySuffix = vehicles.filter((v) => {
    const vin = compact(v.vin);
    return vin.length === 17 && suffixes.some((s) => vin.endsWith(s));
  });
  const r2 = decide(bySuffix, "vin_suffix");
  if (r2) return r2;

  // 3. Plates, as a whole token or a compacted run (e.g. "ABC 1234").
  const tokens = textTokens(upper);
  const squashed = compact(upper);
  const byPlate = vehicles.filter((v) => {
    const p = compact(v.license_plate);
    if (p.length < 5) return false;
    if (tokens.has(p)) return true;
    // spaced plate: every token sequence joined; require p made of >1 token present in order
    const spaced = new RegExp(`(^|[^A-Z0-9])${p.split("").join("[\\s-]?")}([^A-Z0-9]|$)`);
    return /\d/.test(p) && /[A-Z]/.test(p) && spaced.test(upper) && squashed.includes(p);
  });
  const r3 = decide(byPlate, "plate");
  if (r3) return r3;

  // 4. Car / unit numbers.
  const units = new Set(
    Array.from(upper.matchAll(/(?:\bUNIT|\bCAR|\bTRUCK|#)\s*(?:NO\.?|NUMBER)?\s*#?\s*([A-Z]?\d{1,5}[A-Z]?)\b/g)).map((m) => compact(m[1])),
  );
  const byUnit = vehicles.filter((v) => v.unit_number && units.has(compact(v.unit_number)));
  const r4 = decide(byUnit, "unit");
  if (r4) return r4;

  return { kind: "unmatched" };
}

function decide(list: MatchVehicle[], basis: MatchBasis): FileMatch | null {
  const ids = Array.from(new Set(list.map((v) => v.id)));
  if (ids.length === 1) return { kind: "auto", vehicleId: ids[0], basis };
  if (ids.length > 1) return { kind: "ambiguous", candidates: ids, basis };
  return null;
}

export const BULK_RECEIPT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.webp,application/pdf,image/*";
export const BULK_RECEIPT_MAX_BYTES = 20 * 1024 * 1024;
export const BULK_RECEIPT_MAX_FILES = 50;
export const BULK_RECEIPT_KINDS = ["receipt", "invoice"] as const;
export type BulkReceiptKind = (typeof BULK_RECEIPT_KINDS)[number];

/** Invoice when the name/text says so, otherwise receipt. */
export function guessReceiptKind(text: string): BulkReceiptKind {
  return /\binvoice\b|\binv[\s#-]*\d/i.test(text) ? "invoice" : "receipt";
}

export function receiptStoragePath(vehicleId: string | null, fileName: string, rand = Math.random().toString(36).slice(2, 8), now = Date.now()): string {
  const ext = (fileName.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
  return `${vehicleId || "unassigned"}/${now}-${rand}.${ext}`;
}

/** Validate a client file before upload. Returns an error message or null. */
export function checkBulkFile(f: { name: string; size: number; type: string }): string | null {
  if (f.size <= 0) return "Empty file";
  if (f.size > BULK_RECEIPT_MAX_BYTES) return "Larger than 20 MB";
  if (!/^(application\/pdf|image\/)/.test(f.type) && !/\.(pdf|jpe?g|png|heic|webp)$/i.test(f.name)) return "Only PDF or image files";
  return null;
}
