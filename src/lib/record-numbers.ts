// Display helpers for Customer #, Booking # and Swap #.
//
// These numbers are assigned ONLY by the database (sequences inside the
// rental transactions, not yet installed). The browser never generates,
// infers or guesses one — not from row order, UUIDs or timestamps. Until a
// persisted value exists, every caller shows "—".

// Vehicle swap is gated at runtime, not here: the migration must be installed
// and the Owner must set app_settings.vehicle_swap.enabled (vehicle-swap.ts swapGate).

export type RecordKind = "customer" | "booking" | "swap";
const PREFIX: Record<RecordKind, string> = { customer: "C", booking: "B", swap: "S" };

/** "C-001", "B-042", "S-1000". Stored values are plain integers; prefix/padding are display only. */
export function formatRecordNumber(kind: RecordKind, n: unknown): string | null {
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) return null;
  return `${PREFIX[kind]}-${String(n).padStart(3, "0")}`;
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
