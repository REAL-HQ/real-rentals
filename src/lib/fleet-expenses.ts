/**
 * FLEET vehicle expenses, rental inspection photos and pickup odometer.
 * Pure rules: no I/O. The handlers are in fleet-expenses.server.ts and
 * fleet-rental-records.server.ts.
 */
import { addCalendarDays, parseIsoDate } from "@/lib/vehicle-maintenance";
import { vendorKey } from "@/lib/maintenance-rules";

export const FLEET_EXPENSES_KEY = "fleet_expenses";
export const FLEET_RENTAL_RECORDS_KEY = "fleet_rental_records";

/** Same list as vehicle_expenses_category_check and Admin > Expenses (a test keeps them in step). */
export const FLEET_EXPENSE_CATEGORIES = [
  "registration",
  "insurance",
  "maintenance",
  "repair",
  "tires",
  "fuel",
  "cleaning",
  "towing",
  "parking",
  "tolls",
  "finance",
  "purchase",
  "gps",
  "other",
] as const;
export type FleetExpenseCategory = (typeof FLEET_EXPENSE_CATEGORIES)[number];

export const EXPENSE_MAX_AMOUNT = 1_000_000;
/** How far back an expense date may be. Older than this is almost certainly a typo. */
export const EXPENSE_MAX_AGE_DAYS = 365 * 5;
export const EXPENSE_LIST_DEFAULT_LIMIT = 200;
export const EXPENSE_LIST_MAX_LIMIT = 500;
export const FLEET_PICKUP_ODOMETER_MAX = 1_999_999;

export const FLEET_EXPENSE_NOTE_TAG = "Added by FLEET.";

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
/** Notes keep their line breaks. */
const cleanBlock = (v: unknown, max: number) =>
  String(v ?? "").replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const blank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");

export type Parsed<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (error: string, status = 400): { ok: false; status: number; error: string } => ({ ok: false, status, error });

/** Dollars from a number or a plain numeric string, at most 2 decimals, > 0. Returns cents-exact dollars. */
export function parseExpenseAmount(v: unknown): Parsed<number> {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\s*\$?\s*\d{1,9}(\.\d{1,2})?\s*$/.test(v)) n = Number(v.replace(/[$\s]/g, ""));
  else return fail("amount must be a number in dollars, for example 74.50.");
  if (!Number.isFinite(n)) return fail("amount must be a number in dollars, for example 74.50.");
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return fail("amount can have at most 2 decimal places.");
  if (n <= 0) return fail("amount must be greater than zero.");
  if (n > EXPENSE_MAX_AMOUNT) return fail(`amount must be at most ${EXPENSE_MAX_AMOUNT.toLocaleString("en-US")}.`);
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** A real calendar date, not after today (Eastern) and not older than 5 years. */
export function parseExpenseDate(v: unknown, today: string): Parsed<string> {
  const s = typeof v === "string" ? v.trim() : "";
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseIsoDate(s) : null;
  if (!iso) return fail("date must be a real calendar date in YYYY-MM-DD.");
  if (iso > today) return fail(`date cannot be in the future (today is ${today}).`);
  const oldest = addCalendarDays(today, -EXPENSE_MAX_AGE_DAYS) ?? "2000-01-01";
  if (iso < oldest) return fail(`date is more than 5 years ago (earliest accepted: ${oldest}).`);
  return { ok: true, value: iso };
}

export function parseExpenseCategory(v: unknown): Parsed<FleetExpenseCategory> {
  const s = clean(v, 40).toLowerCase();
  if ((FLEET_EXPENSE_CATEGORIES as readonly string[]).includes(s)) return { ok: true, value: s as FleetExpenseCategory };
  return fail(`category must be one of: ${FLEET_EXPENSE_CATEGORIES.join(", ")}.`);
}

export type ExpenseCreate = {
  date: string;
  amount: number;
  category: FleetExpenseCategory;
  vendor: string | null;
  description: string;
  notes: string | null;
  invoiceNumber: string | null;
  paymentMethod: string | null;
  isRecurring: boolean;
};

/** Everything in the create body except the vehicle, the idempotency key and the receipt file. */
export function parseExpenseCreate(body: Record<string, any>, today: string): Parsed<ExpenseCreate> {
  const date = parseExpenseDate(body.date ?? body.incurred_on, today);
  if (!date.ok) return date;
  if (blank(body.amount)) return fail("amount is required.");
  const amount = parseExpenseAmount(body.amount);
  if (!amount.ok) return amount;
  const category = parseExpenseCategory(body.category);
  if (!category.ok) return category;

  const vendor = blank(body.vendor) ? null : clean(body.vendor, 120);
  if (vendor && vendorKey(vendor).length < 2) return fail("vendor must be a name.");
  const notes = blank(body.notes) ? null : cleanBlock(body.notes, 1500);
  let description = blank(body.description) ? "" : clean(body.description, 300);
  if (!description && notes) description = clean(notes, 300);
  if (!description) return fail("description or notes is required.");

  const inv = blank(body.invoice_number) ? null : clean(body.invoice_number, 120);
  const tkt = blank(body.ticket_number) ? null : clean(body.ticket_number, 120);
  if (inv && tkt && invoiceKey(inv) !== invoiceKey(tkt)) return fail("Send invoice_number or ticket_number, not two different numbers.");
  const invoiceNumber = inv ?? tkt;
  if (invoiceNumber && invoiceKey(invoiceNumber).length < 1) return fail("invoice_number must contain letters or numbers.");

  let paymentMethod: string | null = null;
  if (!blank(body.payment_method)) paymentMethod = clean(body.payment_method, 60);
  if (body.is_recurring != null && typeof body.is_recurring !== "boolean") return fail("is_recurring must be true or false.");

  return {
    ok: true,
    value: { date: date.value, amount: amount.value, category: category.value, vendor, description, notes, invoiceNumber, paymentMethod, isRecurring: body.is_recurring === true },
  };
}

export const invoiceKey = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** `Vendor: X` line kept in notes when the vendor is not in the Vendors list. */
export function vendorNoteLine(vendor: string): string {
  return `Vendor: ${vendor}`;
}
export function vendorFromNotes(notes: string | null | undefined): string | null {
  const m = /^Vendor: (.{1,120})$/m.exec(String(notes ?? ""));
  return m ? m[1].trim() : null;
}

/** The notes column: unmatched vendor, the caller's notes, and who added it. */
export function composeExpenseNotes(c: { vendorUnmatched: string | null; notes: string | null }): string {
  return [c.vendorUnmatched ? vendorNoteLine(c.vendorUnmatched) : null, c.notes, FLEET_EXPENSE_NOTE_TAG].filter(Boolean).join("\n").slice(0, 2000);
}

export type ExpenseLike = {
  id: string;
  vehicle_id: string;
  incurred_on: string;
  amount: number | string;
  vendor_id?: string | null;
  reference?: string | null;
  notes?: string | null;
};
export type DuplicateWarning = {
  expense_id: string;
  reason: "same_vehicle_date_amount_vendor" | "same_invoice_number";
  same_vehicle: boolean;
  date: string;
  amount: number;
  invoice_number: string | null;
};

/**
 * Likely duplicates of a new expense, among rows already on file.
 *  - same vehicle, date and amount, and the same vendor (when a vendor was
 *    given; with no vendor, any row with that vehicle, date and amount), or
 *  - the same invoice or ticket number, on any vehicle.
 * A warning never blocks the save.
 */
export function findDuplicateExpenses(
  candidates: ExpenseLike[],
  next: { vehicleId: string; date: string; amount: number; vendorId: string | null; vendorName: string | null; invoiceNumber: string | null },
  vendorNameById: (id: string) => string | null = () => null,
): DuplicateWarning[] {
  const out = new Map<string, DuplicateWarning>();
  const wantVendor = next.vendorName ? vendorKey(next.vendorName) : "";
  const wantInv = next.invoiceNumber ? invoiceKey(next.invoiceNumber) : "";
  for (const r of candidates) {
    const amount = Number(r.amount);
    const sameVehicle = r.vehicle_id === next.vehicleId;
    const sameInvoice = !!wantInv && invoiceKey(r.reference) === wantInv;
    let sameCore = sameVehicle && r.incurred_on === next.date && Math.abs(amount - next.amount) < 0.005;
    if (sameCore && wantVendor) {
      const have = [r.vendor_id ? vendorNameById(r.vendor_id) : null, vendorFromNotes(r.notes)].filter(Boolean).map((x) => vendorKey(x));
      const idMatch = !!next.vendorId && r.vendor_id === next.vendorId;
      // A row with no vendor at all on file is still a likely repeat of the same bill.
      sameCore = idMatch || have.includes(wantVendor) || (!r.vendor_id && have.length === 0);
    }
    if (sameInvoice || sameCore) {
      out.set(r.id, {
        expense_id: r.id,
        reason: sameInvoice ? "same_invoice_number" : "same_vehicle_date_amount_vendor",
        same_vehicle: sameVehicle,
        date: r.incurred_on,
        amount,
        invoice_number: r.reference ?? null,
      });
    }
  }
  return [...out.values()];
}

/** Stable text for a request, so the same idempotency key can be checked against the same body. */
export function expenseFingerprintText(f: {
  vehicleId: string;
  value: ExpenseCreate;
  receiptSha256: string | null;
}): string {
  const v = f.value;
  return JSON.stringify([
    f.vehicleId, v.date, v.amount.toFixed(2), v.category, vendorKey(v.vendor), v.description, v.notes ?? "", invoiceKey(v.invoiceNumber),
    v.paymentMethod ?? "", v.isRecurring, f.receiptSha256 ?? "",
  ]);
}

export type ExpenseListQuery = { from: string | null; to: string | null; limit: number };

export function parseExpenseListQuery(q: Record<string, unknown>): Parsed<ExpenseListQuery> {
  let from: string | null = null;
  let to: string | null = null;
  if (!blank(q.from)) {
    from = parseIsoDate(String(q.from).trim());
    if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(String(q.from).trim())) return fail("from must be a real date in YYYY-MM-DD.");
  }
  if (!blank(q.to)) {
    to = parseIsoDate(String(q.to).trim());
    if (!to || !/^\d{4}-\d{2}-\d{2}$/.test(String(q.to).trim())) return fail("to must be a real date in YYYY-MM-DD.");
  }
  if (from && to && from > to) return fail("from must be on or before to.");
  let limit = EXPENSE_LIST_DEFAULT_LIMIT;
  if (!blank(q.limit)) {
    const n = Number(q.limit);
    if (!Number.isInteger(n) || n < 1 || n > EXPENSE_LIST_MAX_LIMIT) return fail(`limit must be a whole number from 1 to ${EXPENSE_LIST_MAX_LIMIT}.`);
    limit = n;
  }
  return { ok: true, value: { from, to, limit } };
}

// ---------------------------------------------------------------- rentals

export const INSPECTION_STAGES = { pickup: "checkout", return: "checkin" } as const;
export type InspectionStage = keyof typeof INSPECTION_STAGES;

/** Angles the staff photo uploads already use; a matching label also sets the photo's angle. */
export const INSPECTION_ANGLES: Record<string, string> = {
  front: "front",
  rear: "rear",
  "driver side": "driver_side",
  "passenger side": "passenger_side",
  "interior front": "interior_front",
  "interior rear": "interior_rear",
  odometer: "odometer",
  fuel: "fuel",
  "fuel gauge": "fuel",
  damage: "damage",
  other: "other",
};

export function parseInspectionStage(v: unknown): Parsed<InspectionStage> {
  const s = clean(v, 20).toLowerCase();
  if (s === "pickup" || s === "return") return { ok: true, value: s };
  return fail('stage must be "pickup" or "return".');
}

export function parseInspectionLabel(v: unknown): Parsed<{ label: string; angle: string | null }> {
  const label = clean(v, 200);
  if (!label) return fail("label is required, for example \"Front\" or \"Odometer\".");
  const key = label.toLowerCase().replace(/[_\u2014\u2013-]+/g, " ").replace(/\s+/g, " ").trim();
  return { ok: true, value: { label, angle: INSPECTION_ANGLES[key] ?? null } };
}

export function parsePickupOdometer(v: unknown): Parsed<number> {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\s*\d{1,7}\s*$/.test(v)) n = Number(v);
  else return fail("odometer must be a whole number of miles.");
  if (!Number.isInteger(n)) return fail("odometer must be a whole number of miles.");
  if (n < 0 || n > FLEET_PICKUP_ODOMETER_MAX) return fail(`odometer must be from 0 to ${FLEET_PICKUP_ODOMETER_MAX.toLocaleString("en-US")}.`);
  return { ok: true, value: n };
}
