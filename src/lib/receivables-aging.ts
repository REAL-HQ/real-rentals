/**
 * Read-only rent receivables aging. Money is copied into the result.
 * Nothing here writes a payment, a rental, or a refund.
 */

export const AGING_PAGE_CAP =
  "Receivable records passed the page cap. Totals are withheld so a partial read cannot understate what is owed.";

export const RECENTLY_ENDED_DAYS = 30;

export const AGING_OMITTED = [
  "There is no drivers table. The driver name is applications.full_name, and the driver link uses applications.id. rentals.driver_id is the auth user id and is not the driver screen.",
  "Deposit, late fee, toll, damage, fee, and other payment types are excluded. This list is rent only.",
  "Paid, refunded, waived, and void payments are not receivables.",
  "Amount owed is the payment amount minus net collected when both are set. Net collected is already the amount after a payment refund, so the refund is not subtracted again. A blank net collected uses the payment amount minus the payment refund.",
  "A rental's whole balance sits in the bucket of its oldest open due date.",
  "Current means that due date is today or later, Eastern Time. 1-7, 8-14, and 15-30 count that many days past due. Day 30 stays in 15-30. 30+ starts at 31 days.",
  "An ended rental is listed when its end date is within the last 30 days or later. An older end date is left out. An ended rental with no end date is left out. Pending, reserved, and cancelled rentals are left out.",
  "A rent payment with no due date stays on the row and out of the bucket totals.",
  "Stripe is not called.",
] as const;

export type AgeBucket = "current" | "d1_7" | "d8_14" | "d15_30" | "d30_plus";

export const AGE_BUCKETS: readonly AgeBucket[] = ["current", "d1_7", "d8_14", "d15_30", "d30_plus"];

export const AGE_BUCKET_LABEL: Record<AgeBucket, string> = {
  current: "Current",
  d1_7: "1-7 Days",
  d8_14: "8-14 Days",
  d15_30: "15-30 Days",
  d30_plus: "30+ Days",
};

const ENDED = new Set(["ended", "completed", "closed", "returned", "finished"]);
const SETTLED = new Set(["paid", "refunded", "waived", "void", "cancelled", "canceled"]);
const KNOWN_OPEN = new Set(["unpaid", "failed", "late", "overdue", "past_due", "collections", "pending", "upcoming", "current"]);
const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  ended: "Ended",
  completed: "Completed",
  closed: "Closed",
  returned: "Returned",
  finished: "Finished",
};

export type AgingRental = {
  id: string;
  applicationId: string | null;
  vehicleId: string;
  status: string;
  endDate: string | null;
};

export type AgingPayment = {
  id: string;
  rentalId: string | null;
  applicationId: string | null;
  type: string;
  status: string;
  dueDate: string | null;
  amountCents: number | null;
  netCollectedCents: number | null;
  refundedCents: number | null;
  balanceDueCents: number | null;
  unreadable: boolean;
};

export type AgingPerson = { id: string; name: string };
export type AgingVehicle = { id: string; label: string };

export type AgingRow = {
  rentalId: string;
  applicationId: string | null;
  vehicleId: string | null;
  driver: string;
  vehicle: string;
  rentalStatus: string;
  owedCents: number | null;
  oldestDue: string | null;
  bucket: AgeBucket | null;
  evidence: string[];
};

export type AgingReport = {
  today: string;
  recentFrom: string;
  rows: AgingRow[];
  bucketCents: Record<AgeBucket, number> | null;
  warnings: string[];
  omitted: string[];
};

export function rentalStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export function etToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addCalendarDays(iso: string, days: number): string | null {
  const date = dateOnly(iso);
  if (!date) return null;
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function dollarsToCents(value: unknown): { cents: number | null; unreadable: boolean } {
  if (value == null || value === "") return { cents: null, unreadable: false };
  const amount = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) return { cents: null, unreadable: true };
  const cents = Math.round(Number(amount.toFixed(2)) * 100);
  return Number.isSafeInteger(cents) ? { cents, unreadable: false } : { cents: null, unreadable: true };
}

export function ageBucket(due: string, today: string): AgeBucket | null {
  const age = calendarDays(due, today);
  if (age == null) return null;
  if (age <= 0) return "current";
  if (age <= 7) return "d1_7";
  if (age <= 14) return "d8_14";
  if (age <= 30) return "d15_30";
  return "d30_plus";
}

export function buildReceivablesAging(input: {
  today: string;
  rentals: AgingRental[];
  payments: AgingPayment[];
  people: AgingPerson[];
  vehicles: AgingVehicle[];
}): AgingReport | null {
  const today = dateOnly(input.today);
  const recentFrom = today ? addCalendarDays(today, -RECENTLY_ENDED_DAYS) : null;
  if (!today || !recentFrom) return null;

  const people = new Map(input.people.map((person) => [person.id, person.name.trim() || "Driver"]));
  const vehicles = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicle.label.trim() || "Vehicle"]));
  const rentalIds = new Set(input.rentals.map((rental) => rental.id));
  const byRental = new Map<string, AgingPayment[]>();
  const orphans: AgingPayment[] = [];
  for (const payment of input.payments) {
    if (payment.type !== "rent") continue;
    if (payment.rentalId && rentalIds.has(payment.rentalId)) {
      const list = byRental.get(payment.rentalId) ?? [];
      list.push(payment);
      byRental.set(payment.rentalId, list);
    } else if (!SETTLED.has(payment.status)) {
      orphans.push(payment);
    }
  }

  const rows: AgingRow[] = [];
  let olderCents = 0;
  let olderCount = 0;
  let blankEndCents = 0;
  let blankEndCount = 0;
  let otherStatusCents = 0;
  let otherStatusCount = 0;
  let unreadableSkipped = 0;
  for (const rental of input.rentals) {
    const payments = byRental.get(rental.id) ?? [];
    const owed = sumOwed(payments);
    if (!owed.unreadable && owed.cents <= 0) continue;
    const place = placeRental(rental, recentFrom);
    if (place === "list") {
      rows.push(rowFor(rental, payments, owed, people, vehicles, today));
      continue;
    }
    if (owed.unreadable) {
      unreadableSkipped += 1;
      continue;
    }
    if (place === "older") {
      olderCount += 1;
      olderCents += owed.cents;
    } else if (place === "blank-end") {
      blankEndCount += 1;
      blankEndCents += owed.cents;
    } else {
      otherStatusCount += 1;
      otherStatusCents += owed.cents;
    }
  }

  rows.sort((a, b) => bucketRank(b.bucket) - bucketRank(a.bucket) || a.driver.localeCompare(b.driver) || a.rentalId.localeCompare(b.rentalId));

  const bucketCents = emptyBuckets();
  for (const row of rows) {
    if (row.owedCents == null || row.owedCents <= 0 || !row.bucket) continue;
    bucketCents[row.bucket] += row.owedCents;
  }

  const orphan = sumOwed(orphans.filter((payment) => !SETTLED.has(payment.status)));
  const omitted: string[] = [...AGING_OMITTED];
  if (olderCount) omitted.push(`${olderCount} ended ${olderCount === 1 ? "rental is" : "rentals are"} older than 30 days and not listed. Unpaid rent on ${olderCount === 1 ? "it" : "them"} is ${money(olderCents)} and is not in the bucket totals.`);
  if (blankEndCount) omitted.push(`${blankEndCount} ended ${blankEndCount === 1 ? "rental has" : "rentals have"} no end date and ${blankEndCount === 1 ? "is" : "are"} not listed. Unpaid rent on ${blankEndCount === 1 ? "it" : "them"} is ${money(blankEndCents)} and is not in the bucket totals.`);
  if (otherStatusCount) omitted.push(`${otherStatusCount} ${otherStatusCount === 1 ? "rental is" : "rentals are"} not active or recently ended. Unpaid rent on ${otherStatusCount === 1 ? "it" : "them"} is ${money(otherStatusCents)} and is not in the bucket totals.`);
  if (!orphan.unreadable && orphan.cents > 0) omitted.push(`Rent payments with no rental on file total ${money(orphan.cents)}. They are not in the bucket totals.`);
  if (orphan.unreadable) omitted.push("A rent payment with no rental has an amount that could not be read.");
  if (unreadableSkipped) omitted.push(`${unreadableSkipped} ${unreadableSkipped === 1 ? "rental has" : "rentals have"} an amount that could not be read and ${unreadableSkipped === 1 ? "is" : "are"} not listed.`);

  return { today, recentFrom, rows, bucketCents, warnings: [], omitted };
}

export function cappedReceivablesAging(today: string): AgingReport | null {
  const day = dateOnly(today);
  const recentFrom = day ? addCalendarDays(day, -RECENTLY_ENDED_DAYS) : null;
  if (!day || !recentFrom) return null;
  return { today: day, recentFrom, rows: [], bucketCents: null, warnings: [AGING_PAGE_CAP], omitted: [...AGING_OMITTED] };
}

export function receivablesAgingToCsv(report: AgingReport): string {
  const lines: string[][] = [
    ["Receivables Aging"],
    ["Eastern Time", report.today],
    ["Recently Ended From", report.recentFrom],
  ];
  for (const bucket of AGE_BUCKETS) {
    lines.push([AGE_BUCKET_LABEL[bucket], report.bucketCents ? money(report.bucketCents[bucket]) : ""]);
  }
  for (const warning of report.warnings) lines.push([warning]);
  lines.push(
    [],
    ["Driver", "Vehicle", "Rental Status", "Amount Owed", "Oldest Unpaid Due Date", "Age Bucket", "Evidence"],
    ...report.rows.map((row) => [
      row.driver,
      row.vehicle,
      row.rentalStatus,
      row.owedCents == null ? "" : money(row.owedCents),
      row.oldestDue ?? "",
      row.bucket ? AGE_BUCKET_LABEL[row.bucket] : "",
      row.evidence.join("; "),
    ]),
    [],
    ["Not Included"],
    ...report.omitted.map((line) => [line]),
  );
  return `${lines.map((line) => line.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

function rowFor(
  rental: AgingRental,
  payments: AgingPayment[],
  owed: { cents: number; unreadable: boolean; evidence: string[] },
  people: Map<string, string>,
  vehicles: Map<string, string>,
  today: string,
): AgingRow {
  const evidence = [...owed.evidence];
  const applicationIds = new Set(payments.map((payment) => payment.applicationId).filter((id): id is string => !!id));
  const applicationId = rental.applicationId ?? (applicationIds.size === 1 ? [...applicationIds][0] : null);
  if (applicationIds.size > 1) evidence.push("Rent payments name more than one driver.");
  if (owed.unreadable) return baseRow(rental, applicationId, people, vehicles, null, null, null, evidence);
  const dated = payments.filter((payment) => contributes(payment) && dateOnly(payment.dueDate));
  const undated = payments.filter((payment) => contributes(payment) && !dateOnly(payment.dueDate));
  if (undated.length) evidence.push("A rent charge has no due date and is not used to choose the age bucket.");
  const oldest = dated.map((payment) => dateOnly(payment.dueDate)).filter((due): due is string => !!due).sort()[0] ?? null;
  const bucket = oldest ? ageBucket(oldest, today) : null;
  if (!bucket) evidence.push("No open rent charge has a due date, so this balance is not in a bucket.");
  return baseRow(rental, applicationId, people, vehicles, owed.cents, oldest, bucket, evidence);
}

function baseRow(
  rental: AgingRental,
  applicationId: string | null,
  people: Map<string, string>,
  vehicles: Map<string, string>,
  owedCents: number | null,
  oldestDue: string | null,
  bucket: AgeBucket | null,
  evidence: string[],
): AgingRow {
  return {
    rentalId: rental.id,
    applicationId,
    vehicleId: rental.vehicleId,
    driver: (applicationId && people.get(applicationId)) || "Driver",
    vehicle: vehicles.get(rental.vehicleId) || "Vehicle",
    rentalStatus: rentalStatusLabel(rental.status),
    owedCents,
    oldestDue,
    bucket,
    evidence,
  };
}

function placeRental(rental: AgingRental, recentFrom: string): "list" | "older" | "blank-end" | "other" {
  if (rental.status === "active") return "list";
  if (!ENDED.has(rental.status)) return "other";
  const end = dateOnly(rental.endDate);
  if (!end) return "blank-end";
  if (end < recentFrom) return "older";
  return "list";
}

function contributes(payment: AgingPayment): boolean {
  return payment.type === "rent" && !SETTLED.has(payment.status) && !payment.unreadable && owedOf(payment).cents > 0;
}

function sumOwed(payments: AgingPayment[]): { cents: number; unreadable: boolean; evidence: string[] } {
  let cents = 0;
  const evidence: string[] = [];
  let included = false;
  for (const payment of payments) {
    if (payment.type !== "rent" || SETTLED.has(payment.status)) continue;
    if (payment.unreadable) return { cents: 0, unreadable: true, evidence: ["An amount on this rental could not be read."] };
    if (!KNOWN_OPEN.has(payment.status)) evidence.push("A rent payment status is not one of the usual open statuses. It is still counted because it is not paid, refunded, waived, or void.");
    const owed = owedOf(payment);
    if (owed.unreadable) return { cents: 0, unreadable: true, evidence: owed.evidence };
    if (owed.evidence.length) evidence.push(...owed.evidence);
    if (owed.cents <= 0) continue;
    cents += owed.cents;
    included = true;
  }
  if (!included) return { cents: 0, unreadable: false, evidence };
  return { cents, unreadable: false, evidence: dedupe(evidence) };
}

function owedOf(payment: AgingPayment): { cents: number; unreadable: boolean; evidence: string[] } {
  const evidence: string[] = [];
  const amount = payment.amountCents;
  const net = payment.netCollectedCents;
  const refunded = payment.refundedCents ?? 0;
  const balance = payment.balanceDueCents;
  let cents: number | null = null;
  if (net != null && amount != null) cents = amount - net;
  else if (amount != null) cents = amount - refunded;
  else if (balance != null) cents = balance;
  if (cents == null || cents < 0) return { cents: 0, unreadable: true, evidence: ["An amount on this rental could not be read."] };
  if (balance != null && balance !== cents) {
    evidence.push(net != null
      ? "Balance due and amount minus net collected differ. The amount used is amount minus net collected. This is evidence only."
      : "Balance due and the amount minus the payment refund differ. The amount used is the amount minus the payment refund. This is evidence only.");
  }
  return { cents, unreadable: false, evidence };
}

function emptyBuckets(): Record<AgeBucket, number> {
  return { current: 0, d1_7: 0, d8_14: 0, d15_30: 0, d30_plus: 0 };
}

function bucketRank(bucket: AgeBucket | null): number {
  if (bucket === "d30_plus") return 5;
  if (bucket === "d15_30") return 4;
  if (bucket === "d8_14") return 3;
  if (bucket === "d1_7") return 2;
  if (bucket === "current") return 1;
  return 0;
}

function calendarDays(from: string, to: string): number | null {
  const start = dateOnly(from);
  const end = dateOnly(to);
  if (!start || !end) return null;
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!match) return null;
  const iso = match[1];
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return iso;
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

function dedupe(lines: string[]): string[] {
  return [...new Set(lines)];
}

function escapeCsvCell(value: string): string {
  const formula = /^[=+\-@\t\r]/.test(value);
  const safe = formula ? `'${value}` : value;
  if (formula || /[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}
