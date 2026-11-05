/**
 * Renter payment reminder cadence — pure helpers so the schedule is testable
 * without a database.
 *
 *   day before due  → "due_tomorrow"
 *   1 day late      → "d1"   (also the first-past-due team alert)
 *   3 days late     → "d3"
 *   7 days late     → "d7"
 *   then weekly     → "w2", "w3", … (14, 21, … days late)
 *
 * Each stage is sent at most once per application + due date. The dedupe key
 * lives in outbound_messages.kind, so the sequence advances on its own and a
 * missed cron day sends the latest stage owed (never a burst of old ones).
 * The sequence stops by construction: only unpaid statuses are queried, so a
 * row that is paid, waived or void (staff "handled") drops out on the next run.
 */
export const UNPAID_STATUSES = ["pending", "failed", "overdue", "past_due", "unpaid", "late"] as const;
export const UPCOMING_STATUSES = ["upcoming", "pending", "current"] as const;
export const TEAM_INBOX = "team@drivereal.com";

export function daysBetween(fromIso: string, to: Date): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86400000);
}

/** The follow-up stage owed for a balance this many days late, or null. */
export function followUpStage(daysLate: number): string | null {
  if (daysLate < 1) return null;
  if (daysLate < 3) return "d1";
  if (daysLate < 7) return "d3";
  if (daysLate < 14) return "d7";
  return `w${Math.floor(daysLate / 7)}`;
}

export function reminderKind(stage: string, dueDate: string): string {
  return `payment_reminder:${stage}:${dueDate}`;
}

export function addDays(d: Date, n: number): string {
  return new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
}
