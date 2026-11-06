/**
 * Stalled applications — the Applications "Stalled" filter.
 *
 * A person is stalled when their application is still New or Reviewing and
 * nothing on the file has moved in three or more Eastern calendar days.
 * The row says which of documents, identity, agreement, and card on file
 * are still missing, and the Eastern date of the last contact. Oldest first.
 *
 * This module only classifies. It does not write, email, or text.
 * STALLED_APPLICATIONS_ENABLED is the only declaration of that flag.
 */

export const STALLED_APPLICATIONS_ENABLED: boolean = false;

/** Whole Eastern days with no update before an application counts as stalled. */
export const STALLED_AFTER_DAYS = 3;

/** Still awaiting a decision. Approved, partial, and closed rows are other lists. */
export const STALLED_STATUSES = ["new", "reviewing"] as const;

export type StalledStatus = (typeof STALLED_STATUSES)[number];

export type StalledGap = "documents" | "identity" | "agreement" | "card_on_file";

export const STALLED_GAP_LABEL: Record<StalledGap, string> = {
  documents: "Documents",
  identity: "Identity",
  agreement: "Agreement",
  card_on_file: "Card On File",
};

const GAP_ORDER: StalledGap[] = ["documents", "identity", "agreement", "card_on_file"];

export type StalledAgreement = {
  status?: string | null;
  signedAt?: string | null;
  voidedAt?: string | null;
};

export type StalledInput = {
  id: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  status?: string | null;
  documentsOnFile: boolean;
  identityClear: boolean;
  agreementSigned: boolean;
  cardOnFile: boolean;
  /** Every timestamp that counts as the file moving. The latest one wins. */
  activityAt: Array<string | null | undefined>;
  /** Staff contact timestamps only. Not application edits. */
  contactAt?: Array<string | null | undefined>;
};

export type StalledApplication = {
  id: string;
  name: string;
  phone: string | null;
  gaps: StalledGap[];
  daysStalled: number;
  lastActivityAt: string;
  /** Eastern calendar day of the latest contact, or null when nobody has been contacted. */
  lastContactOn: string | null;
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

function filled(value: string | null | undefined): boolean {
  return String(value ?? "").trim().length > 0;
}

/** Identity is still open until both checks have passed and no review is open. */
export function identityReviewPending(
  backgroundCheckStatus: string | null | undefined,
  mvrStatus: string | null | undefined,
): boolean {
  return norm(backgroundCheckStatus) !== "passed" || norm(mvrStatus) !== "passed";
}

export function identityIsClear(
  backgroundCheckStatus: string | null | undefined,
  mvrStatus: string | null | undefined,
  openIdentityReview: boolean,
): boolean {
  return !openIdentityReview && !identityReviewPending(backgroundCheckStatus, mvrStatus);
}

/** A signed agreement that has not been voided. A Stripe customer id is not an agreement. */
export function signedAgreement(rows: StalledAgreement[]): boolean {
  return rows.some((row) => {
    if (filled(row.voidedAt)) return false;
    const status = norm(row.status);
    if (status === "voided" || status === "void") return false;
    return status === "signed" || filled(row.signedAt);
  });
}

/** Card evidence stored on the application. A Stripe customer id is not a card. */
export function cardOnFile(values: Array<string | null | undefined>): boolean {
  return values.some((value) => filled(value));
}

export function stalledGaps(input: {
  documentsOnFile: boolean;
  identityClear: boolean;
  agreementSigned: boolean;
  cardOnFile: boolean;
}): StalledGap[] {
  const gaps: StalledGap[] = [];
  if (!input.documentsOnFile) gaps.push("documents");
  if (!input.identityClear) gaps.push("identity");
  if (!input.agreementSigned) gaps.push("agreement");
  if (!input.cardOnFile) gaps.push("card_on_file");
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
 * New or Reviewing, and three quiet Eastern days, are both required.
 * A quiet file with nothing missing is still stalled.
 */
export function classifyStalled(input: StalledInput, today: Date): StalledApplication | null {
  const status = norm(input.status);
  if (!(STALLED_STATUSES as readonly string[]).includes(status)) return null;
  const lastActivityAt = latestActivity(input.activityAt);
  if (!lastActivityAt) return null;
  const daysStalled = daysSinceEastern(lastActivityAt, today);
  if (daysStalled == null || daysStalled < STALLED_AFTER_DAYS) return null;
  const contactAt = latestActivity(input.contactAt ?? []);
  const phone = String(input.phone ?? "").trim();
  return {
    id: input.id,
    name: stalledDriverName(input),
    phone: phone || null,
    gaps: stalledGaps(input),
    daysStalled,
    lastActivityAt,
    lastContactOn: contactAt ? easternDay(new Date(contactAt)) : null,
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
  if (filled(licensePhotoUrl)) return true;
  return categories.some((category) => /license/i.test(String(category ?? "")));
}

export function insuranceOnFile(
  insuranceDocUrl: string | null | undefined,
  categories: Array<string | null | undefined>,
): boolean {
  if (filled(insuranceDocUrl)) return true;
  return categories.some((category) => /insurance/i.test(String(category ?? "")));
}

/** Documents are on file when both the license and the insurance file are present. */
export function documentsOnFile(input: {
  licensePhotoUrl?: string | null;
  insuranceDocUrl?: string | null;
  categories: Array<string | null | undefined>;
}): boolean {
  return (
    licenseOnFile(input.licensePhotoUrl, input.categories) &&
    insuranceOnFile(input.insuranceDocUrl, input.categories)
  );
}
