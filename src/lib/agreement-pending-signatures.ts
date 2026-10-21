// Read-only list of agreements that were sent and are still unsigned.
// No database access and no writes. Days use America/New_York calendar dates.

export const PENDING_SIGNATURE_TIME_ZONE = "America/New_York";
export const PENDING_SIGNATURE_READ_CAP = 999;
export const PENDING_SIGNATURE_NAME_CHUNK = 50;

const NY_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: PENDING_SIGNATURE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const OPEN_STATUSES = ["sent", "viewed", "signing"] as const;

export type PendingAgreementRow = {
  id: string;
  application_id: string | null;
  title: string | null;
  status: string | null;
  sent_at: string | null;
  signed_at: string | null;
  signer_name: string | null;
  token_expires_at?: string | null;
};

export type PendingDriver = {
  id: string;
  full_name: string | null;
};

export type PendingSignatureRow = {
  agreementId: string;
  driverName: string;
  driverSearch: { tab: "drivers"; id: string } | null;
  title: string;
  statusLabel: string;
  daysWaiting: number | null;
  lastSentLabel: string;
};

export type PendingSignatureList = {
  today: string;
  rows: PendingSignatureRow[];
  /** The agreement page itself stopped at the read cap. */
  truncated: boolean;
  /** A driver-name query failed or was capped. The agreement list can still be complete. */
  namesFailed: boolean;
};

/** Calendar day in America/New_York, as a UTC day serial. Not elapsed 24-hour periods. */
function nyCivilDay(date: Date): number | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = NY_DAY.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (!year || !month || !day) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function easternCalendarDate(now: Date): string | null {
  const serial = nyCivilDay(now);
  if (serial === null) return null;
  const date = new Date(serial * 86_400_000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Whole America/New_York calendar days from the last send to now.
 * A 23-hour spring-forward day and a 25-hour fall-back day each count as one
 * date change. A wait that crosses midnight counts even when it is under 24 hours.
 */
export function daysWaiting(sentAt: string | null, now: Date): number | null {
  if (!sentAt) return null;
  const sent = nyCivilDay(new Date(sentAt));
  const today = nyCivilDay(now);
  if (sent === null || today === null) return null;
  return Math.max(0, today - sent);
}

export function lastSentLabel(sentAt: string | null): string {
  if (!sentAt) return "Unknown";
  const date = new Date(sentAt);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PENDING_SIGNATURE_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function statusLabel(row: PendingAgreementRow, now: Date): string {
  const expiresAt = row.token_expires_at;
  if (typeof expiresAt === "string" && expiresAt.trim() !== "") {
    const expires = new Date(expiresAt);
    if (!Number.isNaN(expires.getTime()) && expires.getTime() <= now.getTime()) return "Expired";
  }
  if (row.status === "sent") return "Sent";
  if (row.status === "viewed") return "Viewed";
  if (row.status === "signing") return "Signing";
  return row.status && row.status.trim() !== "" ? row.status : "Unknown";
}

function isOpenUnsigned(row: PendingAgreementRow): boolean {
  const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  if (!(OPEN_STATUSES as readonly string[]).includes(status)) return false;
  if (row.signed_at) return false;
  return typeof row.sent_at === "string" && row.sent_at.trim() !== "";
}

export function buildPendingSignatures(input: {
  now: Date;
  agreements: readonly PendingAgreementRow[];
  drivers: readonly PendingDriver[];
  truncated?: boolean;
  namesFailed?: boolean;
  namesUnchecked?: readonly string[];
}): PendingSignatureList {
  const drivers = new Map(input.drivers.map((driver) => [driver.id, driver]));
  const unchecked = new Set(input.namesUnchecked ?? []);
  const rows: PendingSignatureRow[] = [];
  for (const agreement of input.agreements) {
    if (!isOpenUnsigned(agreement)) continue;
    const applicationId = agreement.application_id;
    const driver = applicationId ? drivers.get(applicationId) : undefined;
    const name = driver?.full_name?.trim() ?? "";
    const signer = agreement.signer_name?.trim() ?? "";
    const waiting = daysWaiting(agreement.sent_at, input.now);
    rows.push({
      agreementId: agreement.id,
      driverName: !applicationId
        ? signer || "No Driver"
        : unchecked.has(applicationId)
          ? "Driver Not Checked"
          : name || signer || "Unnamed Driver",
      driverSearch: applicationId ? { tab: "drivers", id: applicationId } : null,
      title: agreement.title?.trim() || "Rental Agreement",
      statusLabel: statusLabel(agreement, input.now),
      daysWaiting: waiting,
      lastSentLabel: lastSentLabel(agreement.sent_at),
    });
  }
  rows.sort((a, b) => {
    const days = (b.daysWaiting ?? -1) - (a.daysWaiting ?? -1);
    if (days !== 0) return days;
    return a.agreementId.localeCompare(b.agreementId);
  });
  return {
    today: easternCalendarDate(input.now) ?? "",
    rows,
    truncated: input.truncated === true,
    namesFailed: input.namesFailed === true,
  };
}
