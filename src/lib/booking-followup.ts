/**
 * Booking-conversion follow-up. A booking is a rental (there is no bookings
 * table). This list is the approved or verified applications that have none.
 *
 * The flag is a hard false. While it is off, the server function and the
 * loader both return before a role check and before any read. Nothing here
 * sends email or SMS. Staff copy the reminder and send it themselves.
 */
export const BOOKING_FOLLOWUP_ENABLED: boolean = false as boolean;

export const BOOKING_FOLLOWUP_LIMIT = 100;

export function assertBookingFollowupEnabled(): void {
  if (BOOKING_FOLLOWUP_ENABLED !== true) {
    throw new Error("Booking follow-up is not enabled.");
  }
}

/** Statuses that are not waiting on a first booking. */
export const FOLLOWUP_EXCLUDED_STATUSES = [
  "partial",
  "active",
  "suspended",
  "declined",
  "closed",
  "duplicate",
] as const;

const VERIFIED_CHECKS = [
  "backgroundCheckStatus",
  "mvrStatus",
  "rideshareHistoryStatus",
  "earningsVerifiedStatus",
] as const;

export type FollowupReason = "approved" | "verified" | "approved_and_verified";

export const FOLLOWUP_REASON_LABEL: Record<FollowupReason, string> = {
  approved: "Approved",
  verified: "Verified",
  approved_and_verified: "Approved And Verified",
};

export type LastContactSource = "contact_status" | "document_request" | "recovery" | "message";

export const LAST_CONTACT_LABEL: Record<LastContactSource, string> = {
  contact_status: "Contact Status",
  document_request: "Document Request",
  recovery: "Recovery",
  message: "Message",
};

/** Delivery states that mean a message actually went out. */
export const SENT_DELIVERY_STATES = ["accepted", "sent", "delivered"] as const;

export type FollowupApplication = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  userId: string | null;
  deletedAt: string | null;
  contactStatus: string | null;
  contactStatusAt: string | null;
  docRequestSentAt: string | null;
  recoverySentAt: string | null;
  recoveryEmailSent24h: string | null;
  recoveryEmailSent72h: string | null;
  backgroundCheckStatus: string | null;
  mvrStatus: string | null;
  rideshareHistoryStatus: string | null;
  earningsVerifiedStatus: string | null;
};

export type FollowupRental = {
  applicationId: string | null;
  driverId: string | null;
};

export type FollowupStamp = {
  applicationId: string;
  at: string;
  source?: LastContactSource;
};

export type BookingFollowupRow = {
  applicationId: string;
  name: string;
  email: string | null;
  phone: string | null;
  reason: FollowupReason;
  reasonLabel: string;
  daysWaiting: number | null;
  waitingSince: string | null;
  lastContactAt: string | null;
  lastContactLabel: string | null;
  reminder: string;
};

export type BookingFollowupList = {
  rows: BookingFollowupRow[];
};

function norm(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function passed(value: string | null | undefined): boolean {
  return norm(value) === "passed";
}

export function isApprovedStatus(status: string | null | undefined): boolean {
  return norm(status) === "approved";
}

/** All four staff checks are passed. This is not an application status. */
export function isVerifiedApplication(app: Pick<
  FollowupApplication,
  "backgroundCheckStatus" | "mvrStatus" | "rideshareHistoryStatus" | "earningsVerifiedStatus"
>): boolean {
  return VERIFIED_CHECKS.every((key) => passed(app[key]));
}

export function followupReason(app: Pick<
  FollowupApplication,
  "status" | "deletedAt" | "backgroundCheckStatus" | "mvrStatus" | "rideshareHistoryStatus" | "earningsVerifiedStatus"
>): FollowupReason | null {
  if (app.deletedAt) return null;
  if ((FOLLOWUP_EXCLUDED_STATUSES as readonly string[]).includes(norm(app.status))) return null;
  const approved = isApprovedStatus(app.status);
  const verified = isVerifiedApplication(app);
  if (approved && verified) return "approved_and_verified";
  if (approved) return "approved";
  if (verified) return "verified";
  return null;
}

/**
 * A rental is a booking. rentals.driver_id is the auth user id
 * (applications.user_id), never an application id.
 */
export function applicationHasBooking(
  app: Pick<FollowupApplication, "id" | "userId">,
  rentals: readonly FollowupRental[],
): boolean {
  return rentals.some(
    (rental) =>
      rental.applicationId === app.id || (app.userId !== null && rental.driverId === app.userId),
  );
}

const NY_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

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

/**
 * Whole America/New_York calendar days from the approval instant to now.
 * A 23-hour spring-forward day and a 25-hour fall-back day each count as one
 * date change, and a wait that crosses midnight counts even when it is under
 * 24 hours.
 */
export function daysWaiting(sinceIso: string | null, now: Date): number | null {
  if (!sinceIso) return null;
  const since = nyCivilDay(new Date(sinceIso));
  const today = nyCivilDay(now);
  if (since === null || today === null) return null;
  return Math.max(0, today - since);
}

/**
 * Drop booked applicants before a cap. The cap counts people still waiting,
 * so a page full of rentals cannot push an unbooked applicant off the list.
 */
export function takeUnbooked(
  applications: readonly FollowupApplication[],
  rentals: readonly FollowupRental[],
  limit: number,
): FollowupApplication[] {
  const kept: FollowupApplication[] = [];
  for (const app of applications) {
    if (applicationHasBooking(app, rentals)) continue;
    kept.push(app);
    if (kept.length >= limit) break;
  }
  return kept;
}

export function isSentDelivery(state: string | null | undefined): boolean {
  return (SENT_DELIVERY_STATES as readonly string[]).includes(norm(state));
}

function stamp(applicationId: string, at: string | null, source: LastContactSource): FollowupStamp | null {
  if (!at || Number.isNaN(Date.parse(at))) return null;
  return { applicationId, at, source };
}

/**
 * Recorded contacts only. contacted_at is not one of them: approval writes
 * that column when it is empty, which is not a conversation.
 */
export function contactMarksFromApplication(app: FollowupApplication): FollowupStamp[] {
  const marks: Array<FollowupStamp | null> = [
    norm(app.contactStatus) !== "" && norm(app.contactStatus) !== "new"
      ? stamp(app.id, app.contactStatusAt, "contact_status")
      : null,
    stamp(app.id, app.docRequestSentAt, "document_request"),
    stamp(app.id, app.recoverySentAt, "recovery"),
    stamp(app.id, app.recoveryEmailSent24h, "recovery"),
    stamp(app.id, app.recoveryEmailSent72h, "recovery"),
  ];
  return marks.filter((mark): mark is FollowupStamp => mark !== null);
}

export function latestContact(marks: readonly FollowupStamp[]): FollowupStamp | null {
  let best: FollowupStamp | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const mark of marks) {
    const at = Date.parse(mark.at);
    if (Number.isNaN(at) || at < bestAt) continue;
    best = mark;
    bestAt = at;
  }
  return best;
}

export function earliestApproval(stamps: readonly FollowupStamp[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const stamp of stamps) {
    const at = Date.parse(stamp.at);
    if (Number.isNaN(at)) continue;
    const prev = out.get(stamp.applicationId);
    if (!prev || at < Date.parse(prev)) out.set(stamp.applicationId, new Date(at).toISOString());
  }
  return out;
}

function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function greetingName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0]?.replace(/[\r\n<>]/g, "") ?? "";
  return first || "there";
}

export function reminderText(input: {
  fullName: string;
  reason: FollowupReason;
  daysWaiting: number | null;
  portalUrl?: string;
}): string {
  const name = greetingName(input.fullName);
  const state = input.reason === "verified" ? "verified" : "approved";
  const days =
    input.daysWaiting === null
      ? ""
      : ` It has been ${input.daysWaiting} ${input.daysWaiting === 1 ? "day" : "days"}.`;
  const portal = input.portalUrl?.trim() || "https://drivereal.com/portal";
  return [
    `Hi ${name},`,
    "",
    `Your Real Rentals application is ${state}. We have not booked a car for you yet.${days}`,
    "Reply to this message and we will set that up.",
    `You can also open ${portal}.`,
    "",
    "— Real Rentals",
  ].join("\n");
}

export function buildBookingFollowups(input: {
  applications: readonly FollowupApplication[];
  rentals: readonly FollowupRental[];
  approvals: readonly FollowupStamp[];
  contacts: readonly FollowupStamp[];
  now: Date;
  portalUrl?: string;
}): BookingFollowupRow[] {
  const approvedAt = earliestApproval(input.approvals);
  const contactsById = new Map<string, FollowupStamp[]>();
  for (const app of input.applications) {
    contactsById.set(app.id, contactMarksFromApplication(app));
  }
  for (const mark of input.contacts) {
    if (!mark.source || Number.isNaN(Date.parse(mark.at))) continue;
    const list = contactsById.get(mark.applicationId) ?? [];
    list.push(mark);
    contactsById.set(mark.applicationId, list);
  }

  const rows: BookingFollowupRow[] = [];
  for (const app of input.applications) {
    const reason = followupReason(app);
    if (!reason) continue;
    if (applicationHasBooking(app, input.rentals)) continue;
    const waitingSince = isApprovedStatus(app.status) ? (approvedAt.get(app.id) ?? null) : null;
    const waiting = daysWaiting(waitingSince, input.now);
    const contact = latestContact(contactsById.get(app.id) ?? []);
    const name = app.fullName.trim();
    rows.push({
      applicationId: app.id,
      name,
      email: blankToNull(app.email),
      phone: blankToNull(app.phone),
      reason,
      reasonLabel: FOLLOWUP_REASON_LABEL[reason],
      daysWaiting: waiting,
      waitingSince,
      lastContactAt: contact ? new Date(Date.parse(contact.at)).toISOString() : null,
      lastContactLabel: contact?.source ? LAST_CONTACT_LABEL[contact.source] : null,
      reminder: reminderText({
        fullName: name,
        reason,
        daysWaiting: waiting,
        portalUrl: input.portalUrl,
      }),
    });
  }

  rows.sort((a, b) => {
    if (a.daysWaiting === null && b.daysWaiting === null) return a.name.localeCompare(b.name);
    if (a.daysWaiting === null) return 1;
    if (b.daysWaiting === null) return -1;
    return b.daysWaiting - a.daysWaiting || a.name.localeCompare(b.name);
  });
  return rows.slice(0, BOOKING_FOLLOWUP_LIMIT);
}
