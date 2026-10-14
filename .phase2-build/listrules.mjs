// src/lib/vin.ts
var VIN_ALPHABET = /^[A-HJ-NPR-Z0-9]{17}$/;
var TRANSLITERATE = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9
};
var WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
function normalizeVin(raw) {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function checkVin(raw) {
  const normalized = normalizeVin(raw);
  if (!normalized) {
    return { normalized, formatValid: false, checkDigitValid: null, problem: "No VIN entered." };
  }
  if (normalized.length !== 17) {
    return {
      normalized,
      formatValid: false,
      checkDigitValid: null,
      problem: `A VIN is 17 characters; this has ${normalized.length}.`
    };
  }
  if (!VIN_ALPHABET.test(normalized)) {
    return {
      normalized,
      formatValid: false,
      checkDigitValid: null,
      // Naming the culprit is the difference between a useful error and a
      // shrug, because these are exactly the characters people mistype.
      problem: "A VIN never contains the letters I, O or Q \u2014 check for 1 and 0."
    };
  }
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = normalized[i];
    const value = /[0-9]/.test(ch) ? Number(ch) : TRANSLITERATE[ch];
    if (value === void 0) {
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
    problem: checkDigitValid ? null : "The check digit does not match. This is normal for some imported vehicles \u2014 confirm the VIN is right before saving."
  };
}

// src/lib/vehicle-readiness.ts
function hasValidRate(rate) {
  if (rate === null || rate === void 0 || rate === "") return false;
  const n = Number(rate);
  return Number.isFinite(n) && n > 0;
}
function rentalReadyItems(v) {
  const vin = String(v.vin ?? "").trim();
  return [
    { key: "identity", label: "Year, Make and Model", done: !!v.year && !!String(v.make ?? "").trim() && !!String(v.model ?? "").trim() },
    { key: "vin", label: "Valid VIN", done: !!vin && checkVin(vin).formatValid },
    { key: "weekly_rate", label: "Weekly Rate", done: hasValidRate(v.weekly_rate) }
  ];
}
function isRentalReady(v) {
  return rentalReadyItems(v).every((i) => i.done);
}

// src/lib/vehicles-list.ts
var VEHICLE_LIST_PAGE_SIZE = 50;
var VEHICLE_SORTS = ["unit", "make", "rate", "newest"];
var READINESS_BANDS = ["listing_ready", "rental_ready", "not_ready"];
var READINESS_FILTERS = ["all", ...READINESS_BANDS];
var READINESS_LABEL = {
  listing_ready: "Listing Ready",
  rental_ready: "Rental Ready",
  not_ready: "Needs Setup"
};
var READINESS_HINT = {
  listing_ready: "Rental Ready, with a published listing photo.",
  rental_ready: "Can be rented \u2014 year, make, model, a valid VIN and a weekly rate. No published photo yet.",
  not_ready: "Missing something a rental needs."
};
function readinessBand(v, hasPublishedPhoto) {
  if (!isRentalReady(v)) return "not_ready";
  return hasPublishedPhoto ? "listing_ready" : "rental_ready";
}
function readinessGaps(v, hasPublishedPhoto) {
  const gaps = rentalReadyItems(v).filter((i) => !i.done).map((i) => i.label);
  if (!gaps.length && !hasPublishedPhoto) gaps.push("Published Listing Photo");
  return gaps;
}
function isReadinessFilter(v) {
  return READINESS_FILTERS.includes(String(v));
}
var TEXT_FIELDS = [
  "unit_number",
  "vin",
  "license_plate",
  "make",
  "model",
  "trim",
  "color"
];
function buildVehicleSearchOr(raw) {
  const q = raw.replace(/[,()*%\\"':]/g, " ").trim().slice(0, 100);
  if (!q) return null;
  const parts = TEXT_FIELDS.map((f) => `${f}.ilike.*${q}*`);
  if (/^\d{4}$/.test(q)) parts.push(`year.eq.${q}`);
  return parts.join(",");
}
function availabilityLabel(row) {
  if (row.on_rent) return "On Rent";
  if (row.status === "onboarding") return "Needs Setup";
  return (row.status ?? "\u2014").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
export {
  READINESS_BANDS,
  READINESS_FILTERS,
  READINESS_HINT,
  READINESS_LABEL,
  VEHICLE_LIST_PAGE_SIZE,
  VEHICLE_SORTS,
  availabilityLabel,
  buildVehicleSearchOr,
  isReadinessFilter,
  readinessBand,
  readinessGaps
};
