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

/**
 * Owner choice, still behind the column flag. False keeps one status, where
 * OK requires a TNC date. True shows licence and insurance on their own
 * (for example "OK · TNC Unknown") and hides the OK filter until TNC dates
 * are tracked. Installing the proposed columns is the other choice.
 */
export const DRIVER_DOC_EXPIRY_SEPARATE_TNC: boolean = false;

export const DRIVER_DOC_EXPIRY_ROW_CAP = 1000;

export type DriverDocExpiryRow = {
  id: string;
  status: DocExpiryStatus;
  /** Prepared for the separate display. Ignored while that choice stays false. */
  separateLabel?: string;
};

export type DriverDocExpiryResult = {
  failed: boolean;
  truncated: boolean;
  cap: number;
  /** True only after the read selects real TNC approval dates. */
  tncTracked?: boolean;
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

/** One map for the whole list. Callers must not scan the rows again per driver. */
export function documentRowIndex(
  result: DriverDocExpiryResult | null,
): ReadonlyMap<string, DriverDocExpiryRow> {
  const index = new Map<string, DriverDocExpiryRow>();
  if (!result || result.failed) return index;
  for (const row of result.drivers) index.set(row.id, row);
  return index;
}

/** Cell key for one list row. A failed read is not OK, and a capped row is not Unknown. */
export function documentListStatus(
  result: DriverDocExpiryResult | null,
  id: string,
  index: ReadonlyMap<string, DriverDocExpiryRow> = documentRowIndex(result),
): DocumentListStatus {
  if (!result) return "pending";
  if (result.failed) return "failed";
  const found = index.get(id);
  if (found) return found.status;
  if (result.truncated) return "unread";
  return "unknown";
}
