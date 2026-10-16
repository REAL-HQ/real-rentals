// Display helpers for Customer #, Booking # and Swap #.
//
// These numbers are assigned ONLY by the database (sequences inside the
// rental transactions, not yet installed). The browser never generates,
// infers or guesses one — not from row order, UUIDs or timestamps. Until a
// persisted value exists, every caller shows "—".

/** Swap stays off until the reviewed backend is installed and activated. */
export const SWAP_ENABLED = false;

/** "#001", "#042", "#999", "#1000". Null for anything that is not a real positive integer. */
export function formatRecordNumber(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) return null;
  return `#${String(n).padStart(3, "0")}`;
}

/** Reads a persisted number field if the record carries one; never derives it. */
export function persistedNumber(record: unknown, key: string): number | null {
  if (!record || typeof record !== "object") return null;
  const v = (record as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

export const SWAP_REASONS = [
  "Upgrade",
  "Downgrade",
  "Maintenance",
  "Damage",
  "Replacement",
  "Other",
] as const;
