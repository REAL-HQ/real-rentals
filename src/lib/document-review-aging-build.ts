import { REQUIRED_DOC_TYPES } from "@/components/admin/types";
import { leadToday } from "./lead-priorities";
import {
  DOCUMENT_REVIEW_AGING_ROW_CAP,
  type DocumentReviewAgingResult,
  type DocumentReviewCategory,
  type DocumentReviewRow,
} from "./document-review-aging";
import { canonicalRequiredDoc } from "./required-docs";

const REQUIRED_INDEX = new Map<string, number>(REQUIRED_DOC_TYPES.map((key, index) => [key, index]));

export type ReviewDocument = {
  id: string;
  driver_id: string | null;
  category: string | null;
  is_current: boolean | null;
  review_status: string | null;
  created_at: string | null;
};

export type ReviewApplication = {
  id: string;
  full_name: string | null;
};

function dayIndex(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const stamped = new Date(Date.UTC(year, month - 1, date));
  if (
    stamped.getUTCFullYear() !== year ||
    stamped.getUTCMonth() !== month - 1 ||
    stamped.getUTCDate() !== date
  ) {
    return null;
  }
  return Date.UTC(year, month - 1, date) / 86_400_000;
}

/** Eastern calendar days from the upload through today. A non-day is null. */
export function easternWaitingDays(createdAt: string | null | undefined, today: string): number | null {
  if (!createdAt) return null;
  const when = new Date(createdAt);
  if (Number.isNaN(when.getTime())) return null;
  let uploaded: string;
  try {
    uploaded = leadToday(when);
  } catch {
    return null;
  }
  const start = dayIndex(uploaded);
  const end = dayIndex(today);
  if (start == null || end == null) return null;
  // A future upload is not a wait. Unknown, not a negative day.
  if (end < start) return null;
  return end - start;
}

/**
 * Required, current, and still awaiting a person. Verified is not waiting.
 * Rejected and superseded are already outside canonicalRequiredDoc.
 */
export function awaitingReviewCategory(doc: {
  category?: string | null;
  review_status?: string | null;
  is_current?: boolean | null;
}): string | null {
  if ((doc.review_status ?? "").trim() === "verified") return null;
  return canonicalRequiredDoc(doc);
}

function displayName(value: string | null | undefined): string {
  const name = (value ?? "").trim().replace(/\s+/g, " ");
  return name || "Unnamed Applicant";
}

export function buildDocumentReviewAging(input: {
  documents: readonly ReviewDocument[];
  applications: readonly ReviewApplication[];
  truncated: boolean;
  today: string;
  cap?: number;
}): DocumentReviewAgingResult {
  const cap = input.cap ?? DOCUMENT_REVIEW_AGING_ROW_CAP;
  const names = new Map<string, string>();
  for (const app of input.applications) {
    if (app && typeof app.id === "string" && app.id.length > 0) names.set(app.id, displayName(app.full_name));
  }
  const grouped = new Map<string, Array<DocumentReviewRow & { createdAt: string }>>();
  for (const doc of input.documents) {
    if (!doc || typeof doc.id !== "string" || doc.id.length === 0) continue;
    // Soft-deleted applicants are absent from the live set. Do not list them
    // as Unnamed Applicant or count the upload.
    if (typeof doc.driver_id !== "string" || !names.has(doc.driver_id)) continue;
    const key = awaitingReviewCategory(doc);
    if (!key) continue;
    const createdAt = doc.created_at ?? "";
    const row: DocumentReviewRow & { createdAt: string } = {
      id: doc.id,
      name: names.get(doc.driver_id) ?? "Unnamed Applicant",
      days: easternWaitingDays(doc.created_at, input.today),
      createdAt,
    };
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  const categories: DocumentReviewCategory[] = [];
  for (const [key, rows] of grouped) {
    rows.sort((left, right) => {
      if (left.days == null && right.days == null) return left.createdAt.localeCompare(right.createdAt);
      if (left.days == null) return 1;
      if (right.days == null) return -1;
      if (left.days !== right.days) return right.days - left.days;
      return left.createdAt.localeCompare(right.createdAt);
    });
    const visible = rows.slice(0, cap);
    categories.push({
      key,
      count: visible.length,
      oldestDays: visible[0]?.days ?? null,
      rows: visible.map(({ id, name, days }) => ({ id, name, days })),
    });
  }
  categories.sort((left, right) => {
    if (left.oldestDays == null && right.oldestDays == null) {
      return (REQUIRED_INDEX.get(left.key) ?? 99) - (REQUIRED_INDEX.get(right.key) ?? 99);
    }
    if (left.oldestDays == null) return 1;
    if (right.oldestDays == null) return -1;
    if (left.oldestDays !== right.oldestDays) return right.oldestDays - left.oldestDays;
    return (REQUIRED_INDEX.get(left.key) ?? 99) - (REQUIRED_INDEX.get(right.key) ?? 99);
  });
  return {
    failed: false,
    truncated: input.truncated,
    cap,
    categories,
  };
}
