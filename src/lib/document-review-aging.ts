/**
 * Dark review queue on the existing Drivers screen.
 *
 * Which upload is a required document is canonicalRequiredDoc. This file is
 * only the gate and the shape of the answer. DOCUMENT_REVIEW_AGING_ENABLED
 * is the only declaration of the gate. Nothing reads an environment variable
 * to open it.
 */
export const DOCUMENT_REVIEW_AGING_ENABLED: boolean = false;

export const DOCUMENT_REVIEW_AGING_ROW_CAP = 1000;

export type DocumentReviewRow = {
  id: string;
  name: string;
  /** Eastern calendar days from the upload day through today. */
  days: number | null;
};

export type DocumentReviewCategory = {
  key: string;
  count: number;
  oldestDays: number | null;
  rows: DocumentReviewRow[];
};

export type DocumentReviewAgingResult = {
  failed: boolean;
  truncated: boolean;
  cap: number;
  categories: DocumentReviewCategory[];
};

function dayWord(days: number): "Day" | "Days" {
  return days === 1 || days === -1 ? "Day" : "Days";
}

/** Title Case day count for the Drivers list. Lives here so the screen does not import the builder. */
export function waitingDayLabel(days: number | null): string {
  if (days == null) return "Unknown";
  return `${days} ${dayWord(days)}`;
}

export function assertDocumentReviewAgingEnabled(): never {
  if (DOCUMENT_REVIEW_AGING_ENABLED !== true) {
    throw new Error("Document review aging is disabled.");
  }
  return DOCUMENT_REVIEW_AGING_ENABLED as never;
}

/** True while the queue stays off. The handler stops before any read. */
export const DOCUMENT_REVIEW_AGING_REFUSED: boolean = !DOCUMENT_REVIEW_AGING_ENABLED;
