/**
 * Fleet capacity and the approved-applicant waitlist.
 *
 * Public waitlist mode follows the real Available count (unarchived
 * vehicles with status `available` and no active rental) unless a staff
 * member sets the optional Cars Available override: 0 forces waitlist
 * mode on, any number above 0 forces it off. A missing override is not
 * 0 — that used to send city pages to the waitlist by accident.
 *
 * Positions are computed on read (oldest approved/ready first). The
 * applicant-facing copy includes the number. Nothing here sends mail,
 * texts, or webhooks.
 */

import { withinTextingHours } from "@/lib/failed-payment-link";

/** Re-export so capacity callers keep a single import. The parser lives with the override. */
export { parseCarsAvailable } from "@/lib/cars-available";

/**
 * Whether city landing pages should collect a waitlist signup instead of
 * an application. A failed fleet count never counts as zero.
 */
export function publicWaitlistMode(
  override: number | null,
  fleetAvailable: number | null,
): boolean {
  if (override === 0) return true;
  if (override != null && override > 0) return false;
  if (fleetAvailable == null) return false;
  return fleetAvailable === 0;
}

/** Number shown in the scarcity line, or null when we should not show one. */
export function publicScarcityCount(
  override: number | null,
  fleetAvailable: number | null,
): number | null {
  if (publicWaitlistMode(override, fleetAvailable)) return null;
  if (override != null && override > 0) return override;
  if (fleetAvailable != null && fleetAvailable > 0) return fleetAvailable;
  return null;
}

export type CapacityVehicle = {
  id: string;
  status: string | null;
  archived_at?: string | null;
};

/** Unarchived cars marked Available that are not on an active rental. */
export function countFleetCapacity(
  vehicles: readonly CapacityVehicle[],
  activeRentalVehicleIds: ReadonlySet<string> | readonly (string | null | undefined)[],
): number {
  const busy = activeRentalVehicleIds instanceof Set
    ? activeRentalVehicleIds
    : new Set((activeRentalVehicleIds as readonly (string | null | undefined)[]).filter(Boolean) as string[]);
  let n = 0;
  for (const v of vehicles) {
    if (v.archived_at) continue;
    if (String(v.status ?? "").trim().toLowerCase() !== "available") continue;
    if (busy.has(v.id)) continue;
    n += 1;
  }
  return n;
}

export type QueueCandidate = {
  id: string;
  approvedAt: string | null;
  addedAt: string;
  createdAt?: string | null;
};

/** FIFO key: approved/ready time, then the hold, then the application. */
export function queueRankTime(c: QueueCandidate): string {
  return c.approvedAt || c.addedAt || c.createdAt || "";
}

export function assignQueuePositions(rows: readonly QueueCandidate[]): { id: string; position: number }[] {
  const sorted = [...rows].sort((a, b) => {
    const ta = queueRankTime(a);
    const tb = queueRankTime(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  return sorted.map((r, i) => ({ id: r.id, position: i + 1 }));
}

export function positionFor(rows: readonly QueueCandidate[], id: string): number | null {
  return assignQueuePositions(rows).find((r) => r.id === id)?.position ?? null;
}

export const WAITLIST_JOINED_SUBJECT = "You're on the REAL RENTALS waitlist";
export const WAITLIST_JOINED_EMAIL_WORKFLOW = "application_waitlist_joined";
export const WAITLIST_JOINED_AUTOMATION_KEY = "waitlist_joined_notice";
export const WAITLIST_JOINED_SMS_KIND = "waitlist_joined";

export function waitlistJoinedPlain(position: number): string {
  const n = Number.isInteger(position) && position > 0 ? position : 1;
  return `No cars are available right now, but you're #${n} on our waitlist. You'll be the first contacted when a car comes back or we add one to the fleet.`;
}

export function waitlistJoinedEmailHtml(input: {
  fullName: string | null;
  position: number;
  companyPhone: string;
}): { subject: string; html: string } {
  const first = escapeHtml(String(input.fullName ?? "").split(" ")[0] || "there");
  const body = escapeHtml(waitlistJoinedPlain(input.position));
  const phone = escapeHtml(input.companyPhone);
  return {
    subject: WAITLIST_JOINED_SUBJECT,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
        <p style="font-size:15px;line-height:1.6">Hi ${first},</p>
        <p style="font-size:15px;line-height:1.6">${body}</p>
        <p style="color:#888;font-size:12px;margin-top:24px">REAL RENTALS · team@drivereal.com · ${phone}</p>
      </div>`,
  };
}

export type WaitlistWebhookEntry = { lead_id: string; position: number; name: string };

export function vehicleAvailablePayload(
  vehicleId: string,
  waitlist: readonly WaitlistWebhookEntry[],
): { vehicle_id: string; waitlist: WaitlistWebhookEntry[] } {
  return {
    vehicle_id: vehicleId,
    waitlist: waitlist.map((w) => ({
      lead_id: w.lead_id,
      position: w.position,
      name: String(w.name ?? "").trim() || "Applicant",
    })),
  };
}

export function vehicleAvailableAlertCopy(input: {
  vehicleLabel: string;
  count: number;
  waitlist: readonly { position: number; name: string }[];
}): { title: string; status: string; lines: string[] } {
  const label = String(input.vehicleLabel || "A car").trim() || "A car";
  const title = `AVAILABLE: ${label} - Call The Waitlist`;
  const status = input.count === 0
    ? "No approved applicants are on the waitlist."
    : input.count === 1
      ? "1 approved applicant is on the waitlist."
      : `${input.count} approved applicants are on the waitlist.`;
  const lines = input.waitlist.length
    ? input.waitlist.map((w) => `#${w.position} ${String(w.name ?? "").trim() || "Applicant"}`)
    : ["The approved waitlist is empty."];
  return { title, status, lines };
}

/**
 * If `now` is inside 8 AM–9 PM ET, return it. Otherwise the next 8:00 AM ET.
 * Used to queue waitlist texts that cannot go out during quiet hours.
 */
export function nextTextingWindowStart(now: Date): Date {
  if (withinTextingHours(now)) return now;
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(now),
  );
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  // After 9 PM ET, jump to tomorrow 8 AM; before 8 AM, today 8 AM.
  const addDays = hour >= 21 ? 1 : 0;
  const start = etWallTime(y, m, d + addDays, 8, 0, 0);
  return start;
}

/** A calendar date + clock in Eastern, returned as a Date (UTC instant). */
export function etWallTime(year: number, month: number, day: number, hour: number, minute = 0, second = 0): Date {
  // month is 1-12. day may overflow (32 → next month) via Date.UTC first guess.
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const asEt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const got = {
    year: Number(asEt.find((p) => p.type === "year")?.value),
    month: Number(asEt.find((p) => p.type === "month")?.value),
    day: Number(asEt.find((p) => p.type === "day")?.value),
    hour: Number(asEt.find((p) => p.type === "hour")?.value),
  };
  // Difference between the wall we wanted and the wall UTC produced in ET.
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  const gotUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, minute, second);
  return new Date(utcGuess + (wanted - gotUtc));
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
