import { validFinanceDate } from "./unified-finance";

/**
 * One new vehicle expense. The category list is the vehicle_expenses check
 * constraint. Amount is dollars, greater than zero, at most two decimal places,
 * inside numeric(10,2). The date is an Eastern Time calendar date stored in
 * incurred_on. description is required because that column is NOT NULL.
 * Receipt columns are filled only when the existing receipts upload supplied
 * them. This module does not touch the database.
 */

export const EXPENSE_CATEGORIES = [
  { value: "registration", label: "Registration And Tags" },
  { value: "insurance", label: "Insurance Premium" },
  { value: "maintenance", label: "Routine Maintenance" },
  { value: "repair", label: "Repair" },
  { value: "tires", label: "Tires" },
  { value: "fuel", label: "Fuel" },
  { value: "cleaning", label: "Cleaning And Detailing" },
  { value: "towing", label: "Towing" },
  { value: "parking", label: "Parking And Storage" },
  { value: "tolls", label: "Tolls Absorbed" },
  { value: "finance", label: "Finance And Lease" },
  { value: "purchase", label: "Purchase" },
  { value: "gps", label: "GPS And Telematics" },
  { value: "other", label: "Other" },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["value"];
const CATEGORY_SET = new Set<string>(EXPENSE_CATEGORIES.map((item) => item.value));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT_MAX = 99_999_999.99;

export type OwnerExpenseDraft = {
  vehicleId: string;
  incurredOn: string;
  amount: number | string;
  category: string;
  vendorId?: string | null;
  description: string;
  notes?: string | null;
  receiptPath?: string | null;
  receiptName?: string | null;
  receiptMime?: string | null;
};

export type OwnerExpenseInsert = {
  vehicle_id: string;
  incurred_on: string;
  amount: number;
  category: ExpenseCategory;
  vendor_id: string | null;
  description: string;
  notes: string | null;
  created_by: string;
  receipt_path: string | null;
  receipt_name: string | null;
  receipt_mime: string | null;
};

function blank(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Dollars and cents. Zero, negatives, and extra fractions are refused. */
export function parseExpenseAmount(value: number | string): number {
  const text = typeof value === "number"
    ? (Number.isFinite(value) ? String(value) : "")
    : value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("Enter an amount greater than zero");
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("Enter an amount greater than zero");
  const amount = cents / 100;
  if (amount > AMOUNT_MAX) throw new Error("Enter an amount greater than zero");
  return amount;
}

function receiptOf(draft: OwnerExpenseDraft): Pick<OwnerExpenseInsert, "receipt_path" | "receipt_name" | "receipt_mime"> {
  const path = blank(draft.receiptPath);
  const name = blank(draft.receiptName);
  const mime = blank(draft.receiptMime);
  if (!path && !name && !mime) return { receipt_path: null, receipt_name: null, receipt_mime: null };
  if (!path || !name || !mime || path.includes("..") || path.startsWith("/") || !/^[A-Za-z0-9._/-]+$/.test(path)) {
    throw new Error("Receipt was incomplete");
  }
  return { receipt_path: path, receipt_name: name.slice(0, 200), receipt_mime: mime.slice(0, 120) };
}

export function ownerExpenseInsert(draft: OwnerExpenseDraft, userId: string): OwnerExpenseInsert {
  if (!UUID.test(userId) || !UUID.test(draft.vehicleId ?? "")) throw new Error("Vehicle was not found");
  if (!validFinanceDate(draft.incurredOn ?? "")) throw new Error("Enter a date");
  if (!CATEGORY_SET.has(draft.category)) throw new Error("Choose a category");
  const description = blank(draft.description);
  if (!description || description.length > 300) throw new Error("Enter a description");
  const notes = blank(draft.notes);
  if (notes.length > 2000) throw new Error("Note is too long");
  const vendor = blank(draft.vendorId);
  if (vendor && !UUID.test(vendor)) throw new Error("Vendor was not found");
  return {
    vehicle_id: draft.vehicleId,
    incurred_on: draft.incurredOn,
    amount: parseExpenseAmount(draft.amount),
    category: draft.category as ExpenseCategory,
    vendor_id: vendor || null,
    description,
    notes: notes || null,
    created_by: userId,
    ...receiptOf(draft),
  };
}

export function todayEastern(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}
