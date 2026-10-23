import { tierAllows, type StaffTier } from "@/lib/roles";
import {
  buildDepositsRefundsLedger,
  type DepositDeduction,
  type DepositPayment,
  type DepositPerson,
  type DepositRefund,
  type DepositRental,
  type DepositStripeRefund,
  type DepositVehicle,
  type DepositsRefundsResponse,
} from "./deposits-refunds-ledger";

/**
 * Read-only directory for the deposits ledger. The caller has already
 * required a manager: supabaseAdmin bypasses RLS. Two identical scans,
 * or the report is withheld. This file never writes.
 */

export const DEPOSIT_RECORDS_INCOMPLETE = "Deposit records were incomplete";
const DIRECTORY_PAGE = 1000;
const DIRECTORY_MAX_PAGES = 100;

type Page<T> = { data: T[] | null; error: { message: string } | null };
export type DepositScan<T extends { id: string }> = (cursor: string | null) => PromiseLike<Page<T>>;

type PaymentRow = {
  id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  rental_id: string | null;
  type: string | null;
  status: string | null;
  amount: string | number | null;
  refunded_amount: string | number | null;
  stripe_payment_intent_id: string | null;
};
type RefundRow = {
  id: string;
  amount: string | number | null;
  status: string | null;
  payment_ids: string[] | null;
  stripe_refund_id: string | null;
  stripe_charge_id: string | null;
  stripe_payment_intent_id: string | null;
};
type DeductionRow = {
  id: string;
  amount: string | number | null;
  rental_id: string | null;
  incident_id: string | null;
  toll_charge_id: string | null;
};
type RentalRow = {
  id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  deposit_amount: string | number | null;
  deposit_held: boolean | null;
};
type PersonRow = { id: string; full_name: string | null };
type VehicleRow = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  license_plate: string | null;
  unit_number: string | null;
};

export type DepositRecords = {
  payments: DepositPayment[];
  refunds: DepositRefund[];
  deductions: DepositDeduction[];
  rentals: DepositRental[];
  people: DepositPerson[];
  vehicles: DepositVehicle[];
};

type Query = PromiseLike<Page<{ id: string }>> & {
  gt: (column: string, value: string) => PromiseLike<Page<{ id: string }>>;
};
type AdminDb = {
  from: (table: string) => {
    select: (columns: string) => {
      order: (column: string, options: { ascending: boolean }) => {
        limit: (count: number) => Query;
      };
    };
  };
};

export function depositScans(db: AdminDb | unknown) {
  const admin = db as AdminDb;
  const page = <T extends { id: string }>(table: string, columns: string): DepositScan<T> => async (cursor) => {
    let query = admin.from(table).select(columns).order("id", { ascending: true }).limit(DIRECTORY_PAGE);
    if (cursor) return query.gt("id", cursor) as unknown as PromiseLike<Page<T>>;
    return query as unknown as PromiseLike<Page<T>>;
  };
  return {
    payments: page<PaymentRow>("payments", "id,driver_id,vehicle_id,rental_id,type,status,amount,refunded_amount,stripe_payment_intent_id"),
    refunds: page<RefundRow>("payment_refunds", "id,amount,status,payment_ids,stripe_refund_id,stripe_charge_id,stripe_payment_intent_id"),
    deductions: page<DeductionRow>("deposit_deductions", "id,amount,rental_id,incident_id,toll_charge_id"),
    rentals: page<RentalRow>("rentals", "id,driver_id,vehicle_id,deposit_amount,deposit_held"),
    people: page<PersonRow>("applications", "id,full_name"),
    vehicles: page<VehicleRow>("vehicles", "id,year,make,model,license_plate,unit_number"),
  };
}

export async function loadDepositRecords(source: {
  payments: DepositScan<PaymentRow>;
  refunds: DepositScan<RefundRow>;
  deductions: DepositScan<DeductionRow>;
  rentals: DepositScan<RentalRow>;
  people: DepositScan<PersonRow>;
  vehicles: DepositScan<VehicleRow>;
}): Promise<{ ok: true; records: DepositRecords } | { ok: false }> {
  const [payments, refunds, deductions, rentals, people, vehicles] = await Promise.all([
    readPages(source.payments),
    readPages(source.refunds),
    readPages(source.deductions),
    readPages(source.rentals),
    readPages(source.people),
    readPages(source.vehicles),
  ]);
  if (!payments || !refunds || !deductions || !rentals || !people || !vehicles) return { ok: false };
  const mapped = {
    payments: payments.map(mapPayment),
    refunds: refunds.map(mapRefund),
    deductions: deductions.map(mapDeduction),
    rentals: rentals.map(mapRental),
    people: people.map(mapPerson),
    vehicles: vehicles.map(mapVehicle),
  };
  if (mapped.refunds.some((row) => !row) || mapped.deductions.some((row) => !row) || mapped.rentals.some((row) => !row)) return { ok: false };
  return {
    ok: true,
    records: {
      payments: mapped.payments,
      refunds: mapped.refunds.filter((row): row is DepositRefund => !!row),
      deductions: mapped.deductions.filter((row): row is DepositDeduction => !!row),
      rentals: mapped.rentals.filter((row): row is DepositRental => !!row),
      people: mapped.people,
      vehicles: mapped.vehicles,
    },
  };
}

export async function runDepositsRefunds(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  load: () => Promise<{ ok: true; records: DepositRecords } | { ok: false }>;
  readStripe: () => Promise<{ ok: true; refunds: DepositStripeRefund[] } | { ok: false }>;
}): Promise<DepositsRefundsResponse> {
  if (!input.enabled) return { status: "disabled", report: null };
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const loaded = await input.load();
  if (!loaded.ok) return { status: "unavailable", report: null, reason: DEPOSIT_RECORDS_INCOMPLETE };
  let stripe: { ok: true; refunds: DepositStripeRefund[] } | { ok: false };
  try {
    stripe = await input.readStripe();
  } catch {
    stripe = { ok: false };
  }
  return { status: "ready", report: buildDepositsRefundsLedger({ ...loaded.records, stripe }) };
}

async function readPages<T extends { id: string }>(load: DepositScan<T>): Promise<T[] | null> {
  async function scan(): Promise<T[] | null> {
    const rows: T[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < DIRECTORY_MAX_PAGES; page++) {
      const response = await load(cursor);
      if (response.error || !Array.isArray(response.data) || response.data.length > DIRECTORY_PAGE) return null;
      for (const row of response.data) {
        if (!row || typeof row.id !== "string" || !row.id || (cursor !== null && row.id <= cursor)) return null;
        cursor = row.id;
        rows.push(row);
      }
      if (response.data.length < DIRECTORY_PAGE) return rows;
    }
    return null;
  }
  const first = await scan();
  const second = await scan();
  if (!first || !second || JSON.stringify(first) !== JSON.stringify(second)) return null;
  return first;
}

function mapPayment(row: PaymentRow): DepositPayment {
  return {
    id: row.id,
    driverId: text(row.driver_id),
    vehicleId: text(row.vehicle_id),
    rentalId: text(row.rental_id),
    type: text(row.type),
    status: text(row.status),
    amount: money(row.amount),
    refundedAmount: money(row.refunded_amount),
    paymentIntentId: text(row.stripe_payment_intent_id),
  };
}
function mapRefund(row: RefundRow): DepositRefund | null {
  if (!Array.isArray(row.payment_ids) || row.payment_ids.some((id) => typeof id !== "string")) return null;
  return {
    id: row.id,
    amount: money(row.amount),
    status: text(row.status),
    paymentIds: row.payment_ids,
    stripeRefundId: text(row.stripe_refund_id),
    stripeChargeId: text(row.stripe_charge_id),
    paymentIntentId: text(row.stripe_payment_intent_id),
  };
}
function mapDeduction(row: DeductionRow): DepositDeduction | null {
  if (typeof row.rental_id !== "string" || !row.rental_id) return null;
  return {
    id: row.id,
    rentalId: row.rental_id,
    amount: money(row.amount),
    incidentId: text(row.incident_id),
    tollChargeId: text(row.toll_charge_id),
  };
}
function mapRental(row: RentalRow): DepositRental | null {
  if (typeof row.driver_id !== "string" || !row.driver_id || typeof row.vehicle_id !== "string" || !row.vehicle_id) return null;
  return {
    id: row.id,
    driverId: row.driver_id,
    vehicleId: row.vehicle_id,
    depositAmount: money(row.deposit_amount),
    depositHeld: row.deposit_held === true ? true : row.deposit_held === false ? false : null,
  };
}
function mapPerson(row: PersonRow): DepositPerson {
  return { id: row.id, fullName: text(row.full_name) ?? "" };
}
function mapVehicle(row: VehicleRow): DepositVehicle {
  return {
    id: row.id,
    year: typeof row.year === "number" ? row.year : null,
    make: text(row.make),
    model: text(row.model),
    licensePlate: text(row.license_plate),
    unitNumber: text(row.unit_number),
  };
}
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function money(value: unknown): string | number | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}
