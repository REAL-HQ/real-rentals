// VIN validation and normalisation.
//
// Pure and client-safe, so the same rules run in the form, in bulk import and
// on the server. A VIN that fails here never reaches the decoder or the
// database, which matters most during import: one malformed row should be
// reported, not silently created as a vehicle nobody can find again.

/** I, O and Q are excluded from VINs precisely because they look like 1 and 0. */
const VIN_ALPHABET = /^[A-HJ-NPR-Z0-9]{17}$/;

/** Transliteration table from the North American check-digit standard. */
const TRANSLITERATE: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export type VinCheck = {
  normalized: string;
  /** Right shape: 17 characters from the permitted alphabet. */
  formatValid: boolean;
  /**
   * Check digit agrees. Only meaningful for North American VINs — plenty of
   * legitimate imported vehicles fail it, so this is advisory, never a block.
   */
  checkDigitValid: boolean | null;
  problem: string | null;
};

export function normalizeVin(raw: string): string {
  // Strip anything a camera, a spreadsheet or a person might add.
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function checkVin(raw: string): VinCheck {
  const normalized = normalizeVin(raw);

  if (!normalized) {
    return { normalized, formatValid: false, checkDigitValid: null, problem: "No VIN entered." };
  }
  if (normalized.length !== 17) {
    return {
      normalized,
      formatValid: false,
      checkDigitValid: null,
      problem: `A VIN is 17 characters; this has ${normalized.length}.`,
    };
  }
  if (!VIN_ALPHABET.test(normalized)) {
    return {
      normalized,
      formatValid: false,
      checkDigitValid: null,
      // Naming the culprit is the difference between a useful error and a
      // shrug, because these are exactly the characters people mistype.
      problem: "A VIN never contains the letters I, O or Q — check for 1 and 0.",
    };
  }

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = normalized[i];
    const value = /[0-9]/.test(ch) ? Number(ch) : TRANSLITERATE[ch];
    if (value === undefined) {
      return { normalized, formatValid: false, checkDigitValid: null, problem: `Unexpected character "${ch}".` };
    }
    sum += value * WEIGHTS[i];
  }
  const remainder = sum % 11;
  const expected = remainder === 10 ? "X" : String(remainder);
  const checkDigitValid = normalized[8] === expected;

  return {
    normalized,
    formatValid: true,
    checkDigitValid,
    problem: checkDigitValid
      ? null
      : "The check digit does not match. This is normal for some imported vehicles — confirm the VIN is right before saving.",
  };
}

/** Last four, for lists and lookups. */
export function vinLast4(vin: string | null | undefined): string {
  const n = normalizeVin(vin ?? "");
  return n ? n.slice(-4) : "";
}
