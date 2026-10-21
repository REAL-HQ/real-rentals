// Read-only list of partial applications that have been idle for more than 24 hours.
// No database access and no sends. Last activity is shown in America/New_York.

import { contactStatusLabel } from "@/lib/contact-status";

export const RESUME_REMINDER_TIME_ZONE = "America/New_York";
export const RESUME_REMINDER_READ_CAP = 999;
export const RESUME_REMINDER_IDLE_MS = 24 * 60 * 60 * 1000;

export type ResumeReminderSource = {
  id: string;
  full_name: string | null;
  status: string | null;
  updated_at: string | null;
  contact_status: string | null;
  contact_status_at: string | null;
};

export type ResumeReminderRow = {
  applicationId: string;
  driverName: string;
  lastActivityLabel: string;
  contactStatusLabel: string;
  driverSearch: { tab: "drivers"; id: string };
};

export type ResumeReminderList = {
  rows: ResumeReminderRow[];
  truncated: boolean;
};

function parsed(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
}

/** The later of the application update and the contact-status change. */
export function lastActivityInstant(row: Pick<ResumeReminderSource, "updated_at" | "contact_status_at">): number | null {
  const stamps = [parsed(row.updated_at), parsed(row.contact_status_at)].filter((value): value is number => value != null);
  if (stamps.length === 0) return null;
  return Math.max(...stamps);
}

export function isPartialApplication(status: string | null | undefined): boolean {
  return typeof status === "string" && status.trim().toLowerCase() === "partial";
}

/** True only after more than 24 elapsed hours. A row with no usable timestamp is not idle. */
export function isIdleOver24Hours(row: Pick<ResumeReminderSource, "updated_at" | "contact_status_at">, now: Date): boolean {
  const at = lastActivityInstant(row);
  if (at == null) return false;
  return now.getTime() - at > RESUME_REMINDER_IDLE_MS;
}

export function lastActivityLabel(row: Pick<ResumeReminderSource, "updated_at" | "contact_status_at">): string {
  const at = lastActivityInstant(row);
  if (at == null) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: RESUME_REMINDER_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(at));
}

export function buildResumeReminders(input: {
  now: Date;
  applications: readonly ResumeReminderSource[];
  truncated?: boolean;
}): ResumeReminderList {
  const rows: Array<ResumeReminderRow & { at: number }> = [];
  for (const application of input.applications) {
    if (!application.id || !isPartialApplication(application.status)) continue;
    if (!isIdleOver24Hours(application, input.now)) continue;
    const at = lastActivityInstant(application);
    if (at == null) continue;
    const name = application.full_name?.trim() ?? "";
    rows.push({
      applicationId: application.id,
      driverName: name || "Unnamed Driver",
      lastActivityLabel: lastActivityLabel(application),
      contactStatusLabel: contactStatusLabel(application.contact_status),
      driverSearch: { tab: "drivers", id: application.id },
      at,
    });
  }
  rows.sort((a, b) => a.at - b.at || a.applicationId.localeCompare(b.applicationId));
  return {
    rows: rows.map(({ at: _at, ...row }) => row),
    truncated: input.truncated === true,
  };
}
