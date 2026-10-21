/**
 * Closeout Summary for one active or ended rental. Read-only.
 *
 * Weeks are Eastern calendar days from the start date through today while the
 * rental is active, or through end_date once it has ended. Expected rent is
 * weekly_rate × those days / 7, rounded to the cent. Payments recorded are
 * net_collected on rent rows only. A deposit is held by the same rule as the
 * #84 ledger: deposit_held, or status held / pending_disposition, and not
 * refunded, partially refunded, applied, or forfeited. The amount is the paid
 * deposit net_collected when one exists, otherwise deposit_amount. A blank
 * amount stays Unknown.
 *
 * The return checklist is #77's return_checklists row. When that table or row
 * is absent the status is Unknown.
 */

import { isIssueClosed } from "@/lib/driver-issues";

export const CLOSEOUT_SUMMARY_ENABLED = false;

export const CLOSEOUT_SUMMARY_DISABLED = "Closeout Summary is disabled pending acceptance";

export function assertCloseoutSummaryEnabled(): void {
  if (!CLOSEOUT_SUMMARY_ENABLED) throw new Error(CLOSEOUT_SUMMARY_DISABLED);
}

export const CLOSEOUT_TIME_ZONE = "America/New_York";

/** Statuses end_rental_tx and the bookings list already treat as ended. */
export const ENDED_RENTAL_STATUSES = ["ended", "completed", "closed", "returned", "finished"] as const;

const OPEN_INCIDENT = new Set(["open", "in_claim", "repairing"]);
const DEPOSIT_CLOSED = new Set(["refunded", "partially_refunded", "applied", "forfeited"]);

const INCIDENT_LABEL: Record<string, string> = {
  accident: "Accident",
  damage: "Damage",
  theft: "Theft",
  vandalism: "Vandalism",
  breakdown: "Breakdown",
  tow: "Tow",
  other: "Other",
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function etCalendarDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CLOSEOUT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month").padStart(2, "0")}-${pick("day").padStart(2, "0")}`;
}

function isRealDate(iso: string): boolean {
  const match = DATE_ONLY.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function calendarDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(raw).trim());
  if (!match || !isRealDate(match[1])) return null;
  return match[1];
}

function daysBetween(earlier: string, later: string): number {
  const [ay, am, ad] = earlier.split("-").map(Number);
  const [by, bm, bd] = later.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function closeoutApplies(status: string | null | undefined): boolean {
  const value = String(status ?? "").trim().toLowerCase();
  return value === "active" || (ENDED_RENTAL_STATUSES as readonly string[]).includes(value);
}

/** Elapsed days. Null when a date that the rental needs is missing or backwards. */
export function rentedDays(input: {
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  todayEt: string;
}): number | null {
  if (!isRealDate(input.todayEt) || !closeoutApplies(input.status)) return null;
  const start = calendarDate(input.startDate);
  if (!start) return null;
  const status = String(input.status ?? "").trim().toLowerCase();
  const end = calendarDate(input.endDate);
  const through = status === "active" ? (end && end < input.todayEt ? end : input.todayEt) : end;
  if (!through) return null;
  const days = daysBetween(start, through);
  return days < 0 ? null : days;
}

export function weeksLabel(days: number | null): string {
  if (days == null) return "Unknown";
  const weeks = Math.floor(days / 7);
  const extra = days % 7;
  const parts: string[] = [];
  if (weeks === 1) parts.push("1 Week");
  else if (weeks > 0) parts.push(`${weeks} Weeks`);
  else parts.push("0 Weeks");
  if (extra === 1) parts.push("1 Day");
  else if (extra > 1) parts.push(`${extra} Days`);
  if (weeks === 0 && extra > 0) return parts.slice(1).join(" ");
  return parts.join(" ");
}

export function dollarsToCents(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 1e-6) return null;
  return cents;
}

export function formatCents(cents: number | null): string {
  if (cents == null || !Number.isSafeInteger(cents)) return "Unknown";
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100).toLocaleString("en-US");
  const remainder = String(absolute % 100).padStart(2, "0");
  return `${sign}$${dollars}.${remainder}`;
}

/** Rent collected. Deposit, late fee, and other rows are not rent. A null net makes the total Unknown. */
export function rentCollectedCents(
  payments: { type: string | null; netCollected: number | null }[],
): number | null {
  let total = 0;
  for (const payment of payments) {
    if (String(payment.type ?? "").trim().toLowerCase() !== "rent") continue;
    const cents = dollarsToCents(payment.netCollected);
    if (cents == null) return null;
    total += cents;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function expectedRentCents(weeklyRate: number | null, days: number | null): number | null {
  if (days == null || days < 0) return null;
  const weekly = dollarsToCents(weeklyRate);
  if (weekly == null) return null;
  const product = weekly * days;
  if (!Number.isSafeInteger(product)) return null;
  const cents = Math.round(product / 7);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function unpaidCents(expected: number | null, recorded: number | null): number | null {
  if (expected == null || recorded == null) return null;
  const difference = expected - recorded;
  return Number.isSafeInteger(difference) ? difference : null;
}

/** Same held test as #84 heldDeposits. */
export function depositIsHeld(depositHeld: boolean | null, depositStatus: string | null): boolean {
  const status = depositStatus?.trim().toLowerCase() ?? "";
  if (DEPOSIT_CLOSED.has(status)) return false;
  return depositHeld === true || status === "held" || status === "pending_disposition";
}

/**
 * Held amount in cents, or null when it cannot be read.
 * Paid deposit nets win. With none, the rental deposit_amount is used.
 * A null net stays null instead of becoming zero.
 */
export function depositHeldCents(input: {
  depositHeld: boolean | null;
  depositStatus: string | null;
  depositAmount: number | null;
  paidDepositNets: Array<number | null>;
}): number | null {
  if (!depositIsHeld(input.depositHeld, input.depositStatus)) return null;
  if (input.paidDepositNets.length > 0) {
    let total = 0;
    for (const net of input.paidDepositNets) {
      const cents = dollarsToCents(net);
      if (cents == null) return null;
      total += cents;
      if (!Number.isSafeInteger(total)) return null;
    }
    return total;
  }
  return dollarsToCents(input.depositAmount);
}

export function depositHeldLabel(input: {
  depositHeld: boolean | null;
  depositStatus: string | null;
  depositAmount: number | null;
  paidDepositNets: Array<number | null>;
}): string {
  if (!depositIsHeld(input.depositHeld, input.depositStatus)) {
    const status = input.depositStatus?.trim().toLowerCase() ?? "";
    if (status === "refunded") return "Not Held, Refunded";
    if (status === "partially_refunded") return "Not Held, Partially Refunded";
    if (status === "applied") return "Not Held, Applied";
    if (status === "forfeited") return "Not Held, Forfeited";
    return "Not Held";
  }
  const cents = depositHeldCents(input);
  return cents == null ? "Unknown" : `${formatCents(cents)} Held`;
}

export type Coverage = "Current" | "Expired" | "Unknown";

export function coverageStatus(raw: string | null | undefined, todayEt: string): Coverage {
  const day = calendarDate(raw);
  if (!day || !isRealDate(todayEt)) return "Unknown";
  return day < todayEt ? "Expired" : "Current";
}

export type ReturnChecklistRead =
  | { known: false }
  | {
      known: true;
      keysReturned: boolean;
      depositDecisionNeeded: boolean;
      /** Null when the item rows could not be read. */
      damageCount: number | null;
    };

export function returnChecklistLabel(read: ReturnChecklistRead): string {
  if (!read.known) return "Unknown";
  const parts = [read.keysReturned ? "Keys Returned" : "Keys Not Returned"];
  if (read.damageCount == null) parts.push("Damage Unknown");
  else if (read.damageCount > 0) parts.push(read.damageCount === 1 ? "1 Damage Note" : `${read.damageCount} Damage Notes`);
  if (read.depositDecisionNeeded) parts.push("Deposit Decision Needed");
  return parts.join(", ");
}

function incidentName(type: string | null): string {
  const key = String(type ?? "").trim().toLowerCase();
  return INCIDENT_LABEL[key] ?? "Unknown";
}

function issueName(issue: { title: string | null; kind: string | null }): string {
  const title = issue.title?.trim();
  if (title) return title;
  const kind = String(issue.kind ?? "").trim().toLowerCase();
  if (kind === "vehicle") return "Vehicle";
  if (kind === "account") return "Account";
  if (kind === "breakdown") return "Breakdown";
  if (kind === "tow") return "Tow";
  if (kind === "accident") return "Accident";
  if (kind === "damage") return "Damage";
  return kind ? "Unknown" : "Unknown";
}

function countLine(count: number, names: string[], singular: string, plural: string): string {
  if (count === 0) return "None";
  const noun = count === 1 ? singular : plural;
  const shown = names.filter(Boolean);
  return shown.length ? `${count} ${noun}: ${shown.join(", ")}` : `${count} ${noun}`;
}

export type CloseoutFacts = {
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  todayEt: string;
  weeklyRate: number | null;
  payments: { type: string | null; status: string | null; netCollected: number | null }[];
  depositHeld: boolean | null;
  depositStatus: string | null;
  depositAmount: number | null;
  registrationExpiresOn: string | null;
  insuranceExpiresOn: string | null;
  incidents: { status: string | null; type: string | null }[];
  issues: { status: string | null; title: string | null; kind: string | null }[];
  checklist: ReturnChecklistRead;
};

export type CloseoutSummary = {
  applies: true;
  weeks: string;
  days: number | null;
  paymentsRecorded: string;
  expected: string;
  unpaidBalance: string;
  recordedCents: number | null;
  expectedCents: number | null;
  unpaidCents: number | null;
  depositHeld: string;
  openIncidents: string;
  openIssues: string;
  registration: Coverage;
  insurance: Coverage;
  returnChecklist: string;
  ready: boolean;
  blockers: string[];
  readyLine: string;
};

export function buildCloseoutSummary(input: CloseoutFacts): CloseoutSummary | { applies: false } {
  if (!closeoutApplies(input.status)) return { applies: false };
  const days = rentedDays(input);
  const recorded = rentCollectedCents(input.payments);
  const expected = expectedRentCents(input.weeklyRate, days);
  const unpaid = unpaidCents(expected, recorded);
  const held = depositIsHeld(input.depositHeld, input.depositStatus);
  const heldCents = depositHeldCents({
    depositHeld: input.depositHeld,
    depositStatus: input.depositStatus,
    depositAmount: input.depositAmount,
    paidDepositNets: input.payments
      .filter((payment) => String(payment.type ?? "").trim().toLowerCase() === "deposit" && String(payment.status ?? "").trim().toLowerCase() === "paid")
      .map((payment) => payment.netCollected),
  });
  const registration = coverageStatus(input.registrationExpiresOn, input.todayEt);
  const insurance = coverageStatus(input.insuranceExpiresOn, input.todayEt);
  const openIncidents = input.incidents.filter((incident) => OPEN_INCIDENT.has(String(incident.status ?? "").trim().toLowerCase()));
  const openIssues = input.issues.filter((issue) => !isIssueClosed(issue.status));
  const blockers: string[] = [];
  if (days == null) blockers.push("Weeks rented is Unknown.");
  if (expected == null) blockers.push("Expected rent is Unknown.");
  if (recorded == null) blockers.push("Payments recorded is Unknown.");
  if (unpaid == null) blockers.push("The unpaid balance is Unknown.");
  else if (unpaid > 0) blockers.push(`The unpaid balance is ${formatCents(unpaid)}.`);
  if (held && heldCents == null) blockers.push("The deposit is still held and the amount is Unknown.");
  else if (held) blockers.push(`The deposit of ${formatCents(heldCents)} is still held.`);
  if (openIncidents.length === 1) blockers.push("There is 1 open incident.");
  else if (openIncidents.length > 1) blockers.push(`There are ${openIncidents.length} open incidents.`);
  if (openIssues.length === 1) blockers.push("There is 1 open issue.");
  else if (openIssues.length > 1) blockers.push(`There are ${openIssues.length} open issues.`);
  if (registration === "Expired") blockers.push("Registration is expired.");
  if (registration === "Unknown") blockers.push("Registration status is Unknown.");
  if (insurance === "Expired") blockers.push("Insurance is expired.");
  if (insurance === "Unknown") blockers.push("Insurance status is Unknown.");
  if (!input.checklist.known) blockers.push("The return checklist is Unknown.");
  else {
    if (!input.checklist.keysReturned) blockers.push("Keys were not returned.");
    if (input.checklist.damageCount == null) blockers.push("Return damage is Unknown.");
    else if (input.checklist.damageCount > 0) blockers.push("The return checklist notes damage.");
    if (input.checklist.depositDecisionNeeded) blockers.push("A deposit decision is still needed.");
  }
  return {
    applies: true,
    weeks: weeksLabel(days),
    days,
    paymentsRecorded: formatCents(recorded),
    expected: formatCents(expected),
    unpaidBalance: formatCents(unpaid),
    recordedCents: recorded,
    expectedCents: expected,
    unpaidCents: unpaid,
    depositHeld: depositHeldLabel({
      depositHeld: input.depositHeld,
      depositStatus: input.depositStatus,
      depositAmount: input.depositAmount,
      paidDepositNets: input.payments
        .filter((payment) => String(payment.type ?? "").trim().toLowerCase() === "deposit" && String(payment.status ?? "").trim().toLowerCase() === "paid")
        .map((payment) => payment.netCollected),
    }),
    openIncidents: countLine(openIncidents.length, openIncidents.map((incident) => incidentName(incident.type)), "Open Incident", "Open Incidents"),
    openIssues: countLine(openIssues.length, openIssues.map(issueName), "Open Issue", "Open Issues"),
    registration,
    insurance,
    returnChecklist: returnChecklistLabel(input.checklist),
    ready: blockers.length === 0,
    blockers,
    readyLine: blockers.length === 0 ? "Ready to close? Yes." : `Ready to close? No. ${blockers.join(" ")}`,
  };
}
