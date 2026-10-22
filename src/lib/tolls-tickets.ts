/** One page per source. A larger result is not a complete total. */
export const TOLLS_TICKETS_PAGE_CAP = 100;

export const TOLLS_TICKETS_GAPS = [
  "No Tickets Table And No Violations Table. Citations, Parking, Red Light, Speeding, And Impound Are Charge Types On Toll Charges.",
  "Admin Fee And Other Charge Types Are Not Listed. There Is No Column That Says They Are A Ticket.",
  "A Payment Of Type Fee Is Also Used For Cleaning And Fuel. There Is No Column That Says The Fee Is A Ticket, So Every Fee Payment Is Listed.",
  "Incidents Have No Toll, Ticket, Or Violation Type. A Row Is Listed Only When Its Type, Description, Or Notes Name One. Other Incidents Are Omitted.",
  "Incidents Have No Billed Column And No Paid Column. Driver Responsible Amount Is The Only Renter Amount. Estimated Cost And Actual Cost Are Repair Amounts And Are Not Used.",
  "A Toll Charge Has No Separate Paid Flag. Paid Means The Charge Status Is Paid, Or The Linked Payment Status Is Paid.",
  "Payment Due Date And Paid Date Are Calendar Dates. A Timestamp Is Shown As The Eastern Time Date.",
  "No Issuing Authority URL Is Stored. The Link Opens The Staff List That Holds The Record.",
  "Notes Are Free Text On The Charge, Payment, Or Incident. They Are Not A Separate Ledger.",
  "A Source With More Than 100 Rows, Or A Failed Read, Withholds The Lines And The Totals. A Partial Page Is Not A Complete Total.",
] as const;

const CHARGE_KIND = {
  toll: "Toll",
  citation: "Ticket",
  parking: "Ticket",
  red_light: "Violation",
  speeding: "Violation",
  impound: "Violation",
} as const;

const INCIDENT_WORD = /\b(tolls?|tickets?|citations?|violations?|parking|speeding|red light)\b/i;

export type TollsTicketsKind = "Toll" | "Ticket" | "Violation" | "Fee";

export type TollsChargeRow = {
  id: string;
  vehicleId: string;
  rentalId: string | null;
  applicationId: string | null;
  chargeType: string;
  occurredAt: string;
  amount: number;
  adminFee: number;
  status: string;
  paymentId: string | null;
  notes: string | null;
  referenceNumber: string | null;
};

export type TollsPaymentRow = {
  id: string;
  type: string;
  amount: number;
  status: string;
  driverId: string | null;
  rentalId: string | null;
  vehicleId: string | null;
  notes: string | null;
  dueDate: string | null;
  paidDate: string | null;
  createdAt: string;
};

export type TollsIncidentRow = {
  id: string;
  incidentType: string;
  description: string | null;
  notes: string | null;
  occurredAt: string;
  applicationId: string | null;
  rentalId: string | null;
  vehicleId: string;
  driverResponsibleAmount: number;
};

export type TollsName = { id: string; label: string };

export type TollsRead<T> = {
  rows: T[] | null;
  count: number | null;
  error: boolean;
};

export type TollsTicketsInput = {
  charges: TollsRead<TollsChargeRow>;
  payments: TollsRead<TollsPaymentRow>;
  incidents: TollsRead<TollsIncidentRow>;
  linkedPayments: TollsRead<TollsPaymentRow>;
  renters: TollsName[];
  vehicles: TollsName[];
  rentals: TollsName[];
};

export type TollsLine = {
  id: string;
  source: "Charge" | "Payment" | "Incident";
  kind: TollsTicketsKind;
  dateEt: string | null;
  amount: number;
  billedToRenter: boolean | null;
  paid: boolean | null;
  renterId: string | null;
  renter: string;
  rentalId: string | null;
  rental: string;
  vehicleId: string | null;
  vehicle: string;
  notes: string | null;
  reference: string | null;
  link: string;
};

export type TollsRenterTotal = {
  renterId: string | null;
  renter: string;
  amount: number;
  lineCount: number;
};

export type TollsTicketsLedger = {
  withheld: "page_cap" | "failed_read" | null;
  lines: TollsLine[];
  totals: TollsRenterTotal[];
  gaps: readonly string[];
  csv: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

type DateParts = { year: number; month: number; day: number };

function etParts(value: string): DateParts | null {
  const dateOnly = DATE_ONLY.exec(value.trim());
  if (dateOnly) return { year: Number(dateOnly[1]), month: Number(dateOnly[2]), day: Number(dateOnly[3]) };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

/** Calendar date in Eastern Time. A date-only value is not shifted. */
export function tollsDateEt(value: string | null): string | null {
  if (!value) return null;
  const parts = etParts(value);
  if (!parts) return null;
  return labeledDate(parts.year, parts.month, parts.day);
}

function dateKey(value: string | null): string {
  if (!value) return "";
  const parts = etParts(value);
  if (!parts) return "";
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function labeledDate(year: number, month: number, day: number): string | null {
  const name = MONTHS[month - 1];
  if (!name) return null;
  return `${name} ${day}, ${year}`;
}

function dollars(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function nameOf(rows: TollsName[], id: string | null, missing: string): string {
  if (!id) return missing;
  return rows.find((row) => row.id === id)?.label || "Not Recorded";
}

function blocks(read: TollsRead<unknown>): "page_cap" | "failed_read" | null {
  if (read.error || read.rows == null || read.count == null) return "failed_read";
  if (read.count > TOLLS_TICKETS_PAGE_CAP || read.rows.length > TOLLS_TICKETS_PAGE_CAP) return "page_cap";
  return null;
}

function incidentKind(text: string): TollsTicketsKind | null {
  if (!INCIDENT_WORD.test(text)) return null;
  if (/\b(tickets?|citations?)\b/i.test(text)) return "Ticket";
  if (/\b(violations?|parking|speeding|red light)\b/i.test(text)) return "Violation";
  return "Toll";
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function yesNo(value: boolean | null): string {
  if (value == null) return "Not Recorded";
  return value ? "Yes" : "No";
}

export function tollsTicketsCsv(lines: TollsLine[], withheld: TollsTicketsLedger["withheld"]): string {
  if (withheld) return "Ledger Withheld\n";
  const header = ["Date ET", "Renter", "Rental", "Vehicle", "Kind", "Amount", "Billed To Renter", "Paid", "Link", "Notes", "Source"];
  const rows = lines.map((line) =>
    [
      line.dateEt ?? "",
      line.renter,
      line.rental,
      line.vehicle,
      line.kind,
      line.amount.toFixed(2),
      yesNo(line.billedToRenter),
      yesNo(line.paid),
      line.link,
      line.notes ?? "",
      line.source,
    ].map(csvCell).join(","),
  );
  return [header.join(","), ...rows].join("\n") + "\n";
}

function emptyLedger(withheld: "page_cap" | "failed_read"): TollsTicketsLedger {
  return { withheld, lines: [], totals: [], gaps: TOLLS_TICKETS_GAPS, csv: tollsTicketsCsv([], withheld) };
}

export function buildTollsTicketsLedger(input: TollsTicketsInput): TollsTicketsLedger {
  const blocked = [input.charges, input.payments, input.incidents, input.linkedPayments].map(blocks);
  if (blocked.includes("failed_read")) return emptyLedger("failed_read");
  if (blocked.includes("page_cap")) return emptyLedger("page_cap");

  const charges = input.charges.rows ?? [];
  const payments = input.payments.rows ?? [];
  const incidents = input.incidents.rows ?? [];
  const linked = new Map((input.linkedPayments.rows ?? []).map((row) => [row.id, row]));
  for (const row of payments) linked.set(row.id, row);
  const billedChargePaymentIds = new Set<string>();

  const drafts: (TollsLine & { sortAt: string })[] = [];
  for (const row of charges) {
    const kind = CHARGE_KIND[row.chargeType as keyof typeof CHARGE_KIND];
    if (!kind) continue;
    if (row.paymentId) billedChargePaymentIds.add(row.paymentId);
    const payment = row.paymentId ? linked.get(row.paymentId) : undefined;
    const paid = row.status === "paid" ? true : payment ? payment.status === "paid" : row.paymentId ? null : false;
    drafts.push({
      id: row.id,
      source: "Charge",
      kind,
      dateEt: tollsDateEt(row.occurredAt),
      sortAt: dateKey(row.occurredAt),
      amount: dollars(row.amount + row.adminFee),
      billedToRenter: row.paymentId != null || row.status === "rebilled" || row.status === "paid",
      paid,
      renterId: row.applicationId,
      renter: nameOf(input.renters, row.applicationId, "Not Assigned"),
      rentalId: row.rentalId,
      rental: nameOf(input.rentals, row.rentalId, "Not Assigned"),
      vehicleId: row.vehicleId,
      vehicle: nameOf(input.vehicles, row.vehicleId, "Not Recorded"),
      notes: row.notes,
      reference: row.referenceNumber,
      link: "/admin?tab=charges",
    });
  }

  for (const row of payments) {
    if (row.type !== "toll" && row.type !== "fee") continue;
    const when = row.status === "paid" && row.paidDate ? row.paidDate : row.dueDate || row.createdAt;
    drafts.push({
      id: row.id,
      source: "Payment",
      kind: row.type === "toll" ? "Toll" : "Fee",
      dateEt: tollsDateEt(when),
      sortAt: dateKey(when),
      amount: dollars(row.amount),
      billedToRenter: row.driverId != null,
      paid: row.status === "paid",
      renterId: row.driverId,
      renter: nameOf(input.renters, row.driverId, "Not Assigned"),
      rentalId: row.rentalId,
      rental: nameOf(input.rentals, row.rentalId, "Not Assigned"),
      vehicleId: row.vehicleId,
      vehicle: nameOf(input.vehicles, row.vehicleId, "Not Recorded"),
      notes: row.notes,
      reference: null,
      link: "/admin?tab=payments",
    });
  }

  for (const row of incidents) {
    const text = [row.incidentType, row.description, row.notes].filter(Boolean).join(" ");
    const kind = incidentKind(text);
    if (!kind) continue;
    drafts.push({
      id: row.id,
      source: "Incident",
      kind,
      dateEt: tollsDateEt(row.occurredAt),
      sortAt: dateKey(row.occurredAt),
      amount: dollars(row.driverResponsibleAmount),
      billedToRenter: null,
      paid: null,
      renterId: row.applicationId,
      renter: nameOf(input.renters, row.applicationId, "Not Assigned"),
      rentalId: row.rentalId,
      rental: nameOf(input.rentals, row.rentalId, "Not Assigned"),
      vehicleId: row.vehicleId,
      vehicle: nameOf(input.vehicles, row.vehicleId, "Not Recorded"),
      notes: row.notes,
      reference: null,
      link: `/admin?tab=incidents&issue=${row.id}`,
    });
  }

  drafts.sort((a, b) => b.sortAt.localeCompare(a.sortAt) || a.id.localeCompare(b.id));
  const lines = drafts.map(({ sortAt, ...line }) => {
    void sortAt;
    return line;
  });

  const totals = new Map<string, TollsRenterTotal>();
  for (const line of lines) {
    if (line.source === "Payment" && billedChargePaymentIds.has(line.id)) continue;
    const key = line.renterId ?? "";
    const current = totals.get(key) ?? { renterId: line.renterId, renter: line.renter, amount: 0, lineCount: 0 };
    current.amount = dollars(current.amount + line.amount);
    current.lineCount += 1;
    totals.set(key, current);
  }
  const listed = [...totals.values()].sort((a, b) => a.renter.localeCompare(b.renter) || (a.renterId ?? "").localeCompare(b.renterId ?? ""));

  return {
    withheld: null,
    lines,
    totals: listed,
    gaps: TOLLS_TICKETS_GAPS,
    csv: tollsTicketsCsv(lines, null),
  };
}
