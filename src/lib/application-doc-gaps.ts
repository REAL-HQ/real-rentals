/**
 * Dark document-completeness list for open applications.
 *
 * Which upload counts is canonicalRequiredDoc in required-docs.ts — the same
 * rule as the Drivers "x/4" count. This file is only the gate and the shape
 * of the answer. APPLICATION_DOC_GAPS_ENABLED is the only declaration of the
 * gate. Nothing reads an environment variable to open it.
 */
export const APPLICATION_DOC_GAPS_ENABLED: boolean = false;

export const APPLICATION_DOC_GAPS_ROW_CAP = 1000;

/**
 * Still an application. Approved, active, suspended, declined, closed, and
 * duplicate are later outcomes, and a deleted row is gone.
 */
export const OPEN_APPLICATION_STATUSES = ["partial", "new", "complete", "reviewing"] as const;

export type DocGapState = "present" | "missing" | "unknown";

export type ApplicationDocSlot = {
  key: string;
  state: DocGapState;
  /** Eastern calendar day the current upload arrived, when it is present. */
  on: string | null;
};

export type ApplicationDocGap = {
  id: string;
  name: string;
  status: string;
  slots: ApplicationDocSlot[];
};

export type ApplicationDocGapsResult = {
  failed: boolean;
  truncated: boolean;
  cap: number;
  applications: ApplicationDocGap[];
};

export function assertApplicationDocGapsEnabled(): void {
  if (APPLICATION_DOC_GAPS_ENABLED !== true) {
    throw new Error("Application document gaps are disabled.");
  }
}

/** True while the view stays off. The handler stops before any read. */
export const DOC_GAPS_REFUSED: boolean = !APPLICATION_DOC_GAPS_ENABLED;
