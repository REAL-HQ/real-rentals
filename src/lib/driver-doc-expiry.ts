/**
 * Dark document-expiry column on the existing Drivers list.
 *
 * The dates and the Eastern-day classifier live in driver-readiness-facts.ts,
 * on the same application fields the readiness facts already name. This file
 * is only the gate and the shape of the answer. DRIVER_DOC_EXPIRY_ENABLED is
 * the only declaration of the gate. Nothing reads an environment variable
 * to open it.
 */
import type { DocExpiryStatus } from "./driver-readiness-facts";

export const DRIVER_DOC_EXPIRY_ENABLED: boolean = false;

export const DRIVER_DOC_EXPIRY_ROW_CAP = 1000;

export type DriverDocExpiryRow = {
  id: string;
  status: DocExpiryStatus;
};

export type DriverDocExpiryResult = {
  failed: boolean;
  truncated: boolean;
  cap: number;
  drivers: DriverDocExpiryRow[];
};

export function assertDriverDocExpiryEnabled(): void {
  if (DRIVER_DOC_EXPIRY_ENABLED !== true) {
    throw new Error("Driver document expiry is disabled.");
  }
}

/** True while the column stays off. The handler stops before any read. */
export const DOC_EXPIRY_REFUSED: boolean = !DRIVER_DOC_EXPIRY_ENABLED;

export type DocumentListStatus = DocExpiryStatus | "pending" | "failed" | "unread";

/** Cell key for one list row. A failed read is not OK, and a capped row is not Unknown. */
export function documentListStatus(
  result: DriverDocExpiryResult | null,
  id: string,
): DocumentListStatus {
  if (!result) return "pending";
  if (result.failed) return "failed";
  const found = result.drivers.find((row) => row.id === id);
  if (found) return found.status;
  if (result.truncated) return "unread";
  return "unknown";
}
