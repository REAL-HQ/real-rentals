/**
 * Which license and insurance files a signed-in driver should replace.
 *
 * The upload itself is not here. The portal card calls the existing vault
 * path (createDocumentUploadUrl → signed upload to the returned bucket →
 * confirmDocumentUpload). That path inserts a new current row and marks the
 * previous row is_current false. It does not delete the file or the row.
 *
 * This module only decides whether the card should ask. Dates are calendar
 * days in America/New_York. A date-only value (documents.expires_at is a
 * date) is that calendar day, never a UTC midnight shifted across the
 * evening.
 */

export const PORTAL_DOCUMENT_UPDATE_ENABLED: boolean = false;

export const PORTAL_DOCUMENT_UPDATE_WINDOW_DAYS = 30;

export const PORTAL_DOCUMENT_TIME_ZONE = "America/New_York";

export const PORTAL_DOCUMENT_UPDATE_SLOTS = [
  { category: "license_front", label: "Driver's License (Front)" },
  { category: "license_back", label: "Driver's License (Back)" },
  { category: "insurance", label: "Insurance Card" },
] as const;

export type PortalDocumentUpdateCategory = (typeof PORTAL_DOCUMENT_UPDATE_SLOTS)[number]["category"];

export type PortalDocumentUpdateReason = "missing" | "expired" | "expiring";

export type PortalDocumentUpdateItem = {
  category: PortalDocumentUpdateCategory;
  label: string;
  reason: PortalDocumentUpdateReason;
  /** Calendar day the file expires, when the reason is a date. */
  expiresOn: string | null;
};

export type DocumentOnFile = {
  category: string;
  expiresAt: string | null;
  isCurrent: boolean;
  storagePath: string | null;
  createdAt: string | null;
  visibleToDriver: boolean;
};

/**
 * Apply-flow files that may not have a vault row yet.
 *
 * license_photo_url is the front of the license. insurance_doc_url is the
 * insurance card. The wizard never collects the back of the license, so
 * license_back has no application column. A full http URL is a legacy value
 * the vault refuses to treat as an object we own.
 */
export type ApplicationDocumentFacts = {
  licensePhotoPath: string | null;
  licenseExpiration: string | null;
  insuranceDocPath: string | null;
  insuranceExpiresOn: string | null;
};

export function assertPortalDocumentUpdateEnabled(): void {
  if (PORTAL_DOCUMENT_UPDATE_ENABLED !== true) {
    throw new Error("Portal document update is not enabled.");
  }
}

/** YYYY-MM-DD in Eastern Time. */
export function easternCalendarDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PORTAL_DOCUMENT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * A date column stays a calendar day. A real timestamp is the Eastern
 * calendar day it falls on.
 */
export function asEasternCalendarDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return easternCalendarDate(new Date(parsed));
}

function ownedPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const path = value.trim();
  if (!path || path.startsWith("http://") || path.startsWith("https://")) return null;
  return path;
}

function daysFromToday(today: string, expiresOn: string): number {
  const start = Date.parse(`${today}T00:00:00Z`);
  const end = Date.parse(`${expiresOn}T00:00:00Z`);
  return Math.round((end - start) / 86400000);
}

function newestCurrent(docs: DocumentOnFile[], category: string): DocumentOnFile | null {
  const hits = docs.filter(
    (doc) => doc.category === category && doc.isCurrent && doc.visibleToDriver,
  );
  hits.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return hits[0] ?? null;
}

function judgeDate(
  today: string,
  expiresOn: string,
): { reason: "expired" | "expiring"; expiresOn: string } | null {
  const days = daysFromToday(today, expiresOn);
  if (days < 0) return { reason: "expired", expiresOn };
  if (days <= PORTAL_DOCUMENT_UPDATE_WINDOW_DAYS) return { reason: "expiring", expiresOn };
  return null;
}

const APPLICATION_FILE: Record<
  PortalDocumentUpdateCategory,
  {
    path: (facts: ApplicationDocumentFacts) => string | null;
    expiry: (facts: ApplicationDocumentFacts) => string | null;
  }
> = {
  license_front: {
    path: (facts) => ownedPath(facts.licensePhotoPath),
    expiry: (facts) => facts.licenseExpiration,
  },
  license_back: {
    path: () => null,
    expiry: () => null,
  },
  insurance: {
    path: (facts) => ownedPath(facts.insuranceDocPath),
    expiry: (facts) => facts.insuranceExpiresOn,
  },
};

/**
 * License front, license back, and insurance that are missing, already
 * expired, or due within 30 Eastern calendar days (today and day 30 included).
 *
 * A current driver-visible file with no date is on file. It is not treated as
 * missing or expired. When that file is still the apply-flow object (same
 * storage path) and the application recorded a date the vault row never
 * copied, that date is the expiry. A newer vault file with a different path
 * and no expires_at is the replacement the driver just sent, and the old
 * application date does not follow it.
 */
export function documentsNeedingUpdate(
  docs: DocumentOnFile[],
  application: ApplicationDocumentFacts,
  today: string,
): PortalDocumentUpdateItem[] {
  const items: PortalDocumentUpdateItem[] = [];
  for (const slot of PORTAL_DOCUMENT_UPDATE_SLOTS) {
    const source = APPLICATION_FILE[slot.category];
    const applicationPath = source.path(application);
    const doc = newestCurrent(docs, slot.category);
    let dated: { reason: "expired" | "expiring"; expiresOn: string } | null = null;

    if (doc) {
      const onRow = asEasternCalendarDate(doc.expiresAt);
      if (onRow) {
        dated = judgeDate(today, onRow);
      } else if (applicationPath && doc.storagePath === applicationPath) {
        const fromApplication = asEasternCalendarDate(source.expiry(application));
        if (fromApplication) dated = judgeDate(today, fromApplication);
      }
      if (dated) {
        items.push({ category: slot.category, label: slot.label, ...dated });
      }
      continue;
    }

    if (!applicationPath) {
      items.push({ category: slot.category, label: slot.label, reason: "missing", expiresOn: null });
      continue;
    }

    const fromApplication = asEasternCalendarDate(source.expiry(application));
    if (fromApplication) dated = judgeDate(today, fromApplication);
    if (dated) items.push({ category: slot.category, label: slot.label, ...dated });
  }
  return items;
}
