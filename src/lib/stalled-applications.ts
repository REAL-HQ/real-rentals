/**
 * Stalled applications — who started and then stopped.
 *
 * A person is stalled when they are still in the application (not approved,
 * declined, or renting), something they need is still missing, and nothing
 * on the file has moved in three or more Eastern calendar days. The list is
 * oldest first. This module only classifies. It does not write.
 */

export const STALLED_APPLICATIONS_ENABLED: boolean = false;

/** Whole Eastern days with no update before an application counts as stalled. */
export const STALLED_AFTER_DAYS = 3;

/** Still in the application. Decided and operating rows are someone else's list. */
export const STALLED_STATUSES = ["partial", "new", "complete", "reviewing"] as const;

export type StalledStatus = (typeof STALLED_STATUSES)[number];

export type StalledGap = "finish_application" | "driver_license" | "insurance" | "identity_review";

export const STALLED_GAP_LABEL: Record<StalledGap, string> = {
  finish_application: "Finish Application",
  driver_license: "Driver License",
  insurance: "Insurance",
  identity_review: "Identity Review",
};

const GAP_ORDER: StalledGap[] = ["finish_application", "driver_license", "insurance", "identity_review"];

export type StalledInput = {
  id: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  status?: string | null;
  licenseOnFile: boolean;
  insuranceOnFile: boolean;
  backgroundCheckStatus?: string | null;
  mvrStatus?: string | null;
  /** Every timestamp that counts as the file moving. The latest one wins. */
  activityAt: Array<string | null | undefined>;
};

export type StalledApplication = {
  id: string;
  name: string;
  phone: string | null;
  gaps: StalledGap[];
  daysStalled: number;
  lastActivityAt: string;
};

export function assertStalledApplicationsEnabled(): void {
  if (STALLED_APPLICATIONS_ENABLED !== true) {
    throw new Error("Stalled applications are not enabled.");
  }
}

export function easternDay(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Whole Eastern calendar days from an instant to today. Same day is 0. */
export function daysSinceEastern(iso: string, today: Date): number | null {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const start = Date.parse(`${easternDay(when)}T12:00:00Z`);
  const end = Date.parse(`${easternDay(today)}T12:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

export function latestActivity(values: Array<string | null | undefined>): string | null {
  let bestMs = -Infinity;
  let best: string | null = null;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isNaN(ms) || ms <= bestMs) continue;
    bestMs = ms;
    best = new Date(ms).toISOString();
  }
  return best;
}

function norm(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Identity review is still open until both checks have passed. */
export function identityReviewPending(
  backgroundCheckStatus: string | null | undefined,
  mvrStatus: string | null | undefined,
): boolean {
  return norm(backgroundCheckStatus) !== "passed" || norm(mvrStatus) !== "passed";
}

export function stalledGaps(input: {
  status?: string | null;
  licenseOnFile: boolean;
  insuranceOnFile: boolean;
  backgroundCheckStatus?: string | null;
  mvrStatus?: string | null;
}): StalledGap[] {
  const gaps: StalledGap[] = [];
  if (norm(input.status) === "partial") gaps.push("finish_application");
  if (!input.licenseOnFile) gaps.push("driver_license");
  if (!input.insuranceOnFile) gaps.push("insurance");
  if (identityReviewPending(input.backgroundCheckStatus, input.mvrStatus)) gaps.push("identity_review");
  return GAP_ORDER.filter((gap) => gaps.includes(gap));
}

export function stalledDriverName(input: {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const full = String(input.fullName ?? "").trim();
  if (full) return full;
  const joined = [input.firstName, input.lastName]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return joined || "Applicant";
}

/**
 * One applicant, or null when they are not stalled.
 * Missing work and three quiet Eastern days are both required.
 */
export function classifyStalled(input: StalledInput, today: Date): StalledApplication | null {
  const status = norm(input.status);
  if (!(STALLED_STATUSES as readonly string[]).includes(status)) return null;
  const gaps = stalledGaps(input);
  if (gaps.length === 0) return null;
  const lastActivityAt = latestActivity(input.activityAt);
  if (!lastActivityAt) return null;
  const daysStalled = daysSinceEastern(lastActivityAt, today);
  if (daysStalled == null || daysStalled < STALLED_AFTER_DAYS) return null;
  const phone = String(input.phone ?? "").trim();
  return {
    id: input.id,
    name: stalledDriverName(input),
    phone: phone || null,
    gaps,
    daysStalled,
    lastActivityAt,
  };
}

/** Oldest first. A tie goes to the name, then the id. */
export function sortStalled<T extends { daysStalled: number; name: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => b.daysStalled - a.daysStalled || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

export function licenseOnFile(
  licensePhotoUrl: string | null | undefined,
  categories: Array<string | null | undefined>,
): boolean {
  if (String(licensePhotoUrl ?? "").trim()) return true;
  return categories.some((category) => /license/i.test(String(category ?? "")));
}

export function insuranceOnFile(
  insuranceDocUrl: string | null | undefined,
  categories: Array<string | null | undefined>,
): boolean {
  if (String(insuranceDocUrl ?? "").trim()) return true;
  return categories.some((category) => /insurance/i.test(String(category ?? "")));
}
