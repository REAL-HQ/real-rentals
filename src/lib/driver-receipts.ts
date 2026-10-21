/**
 * Driver payment history and receipts. The flag is a hard constant. The
 * server function throws before portalScope and before any table read unless
 * this is true.
 *
 * A receipt uses stored columns only. A blank is listed under missing rather
 * than filled in.
 */

import { fmtDate } from "@/lib/date-format";

export const DRIVER_RECEIPTS_ENABLED: boolean = false;

export function assertDriverReceiptsEnabled(): void {
  if (DRIVER_RECEIPTS_ENABLED !== true) {
    throw new Error("Driver receipts are not enabled.");
  }
}

/** Same words as the payments screen. */
const STATUS_LABEL: Record<string, string> = {
  upcoming: "Upcoming",
  pending: "Processing",
  current: "Due",
  paid: "Paid",
  overdue: "Overdue",
  past_due: "Past Due",
  failed: "Failed",
  unpaid: "Unpaid",
  collections: "In Collections",
  refunded: "Refunded",
  waived: "Waived",
  void: "Void",
  late: "Late",
};

const PURPOSE_LABEL: Record<string, string> = {
  rent: "Rent",
  deposit: "Deposit",
  late_fee: "Late Fee",
  toll: "Toll",
  damage: "Damage",
  fee: "Fee",
  other: "Other",
};

/** A payment that has already happened. Open balances stay off this list. */
const PAST_STATUS = new Set(["paid", "refunded", "failed", "waived"]);

export type ReceiptPayment = {
  id: string;
  paid_date: string | null;
  amount: number | null;
  type: string | null;
  status: string | null;
  rental_id: string | null;
  vehicle_id: string | null;
};

export type ReceiptRental = {
  id: string;
  start_date: string | null;
  end_date: string | null;
  vehicle_id: string | null;
};

export type ReceiptVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  license_plate: string | null;
};

export type DriverReceipt = {
  id: string;
  date: string | null;
  amount: string | null;
  purpose: string | null;
  status: string | null;
  businessName: string | null;
  driverName: string | null;
  vehicle: string | null;
  period: string | null;
  missing: string[];
};

export type ReceiptContext = {
  businessName: string | null;
  driverName: string | null;
  /** False when the vehicles read failed. A payment with no vehicle id is not a failed read. */
  vehiclesReadable: boolean;
  vehicles: ReceiptVehicle[];
  /** False when the rentals read failed. */
  rentalsReadable: boolean;
  rentals: ReceiptRental[];
};

export function isPastPayment(payment: Pick<ReceiptPayment, "status" | "paid_date">): boolean {
  if (payment.paid_date) return true;
  return PAST_STATUS.has((payment.status ?? "").toLowerCase());
}

/** Calendar dates stay as stored. A timestamp is shown on the Eastern calendar. */
export function formatReceiptDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return fmtDate(trimmed) || null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function formatReceiptAmount(amount: number | null | undefined): string | null {
  if (amount == null || Number.isNaN(Number(amount))) return null;
  return Number(amount).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function purposeLabel(type: string | null): string | null {
  const key = (type ?? "").trim().toLowerCase();
  if (!key) return null;
  return PURPOSE_LABEL[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusLabel(status: string | null): string | null {
  const key = (status ?? "").trim().toLowerCase();
  if (!key) return null;
  return STATUS_LABEL[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function vehicleLine(vehicle: ReceiptVehicle | undefined): string | null {
  if (!vehicle) return null;
  const name = [vehicle.year, vehicle.make, vehicle.model].filter((part) => part != null && String(part).trim() !== "").join(" ");
  const plate = vehicle.license_plate?.trim();
  const line = [name, plate].filter(Boolean).join(" · ");
  return line || null;
}

function periodLine(rental: ReceiptRental | undefined): string | null {
  if (!rental?.start_date) return null;
  const start = formatReceiptDate(rental.start_date);
  if (!start) return null;
  const end = formatReceiptDate(rental.end_date);
  return end ? `${start} – ${end}` : `From ${start}`;
}

export function buildDriverReceipts(payments: ReceiptPayment[], context: ReceiptContext): DriverReceipt[] {
  const vehicles = new Map(context.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const rentals = new Map(context.rentals.map((rental) => [rental.id, rental]));

  return payments.filter(isPastPayment).map((payment) => {
    const rental = payment.rental_id ? rentals.get(payment.rental_id) : undefined;
    const vehicleId = payment.vehicle_id ?? rental?.vehicle_id ?? null;
    const vehicle = vehicleId ? vehicles.get(vehicleId) : undefined;
    const missing: string[] = [];
    if (!context.businessName) missing.push("Business Name");
    if (!context.driverName) missing.push("Driver");
    const date = formatReceiptDate(payment.paid_date);
    if (!date) missing.push("Date");
    const amount = formatReceiptAmount(payment.amount);
    if (!amount) missing.push("Amount");
    const purpose = purposeLabel(payment.type);
    if (!purpose) missing.push("What It Was For");
    const status = statusLabel(payment.status);
    if (!status) missing.push("Status");
    let vehicleText: string | null = null;
    if (!vehicleId || !context.vehiclesReadable) missing.push("Vehicle");
    else {
      vehicleText = vehicleLine(vehicle);
      if (!vehicleText) missing.push("Vehicle");
    }
    let period: string | null = null;
    if (!payment.rental_id || !context.rentalsReadable) missing.push("Period");
    else {
      period = periodLine(rental);
      if (!period) missing.push("Period");
    }
    return {
      id: payment.id,
      date,
      amount,
      purpose,
      status,
      businessName: context.businessName,
      driverName: context.driverName,
      vehicle: vehicleText,
      period,
      missing,
    };
  });
}
