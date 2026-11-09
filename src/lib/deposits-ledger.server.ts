import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  buildDepositsLedger, periodWindow, type DepositPaymentRow, type DepositPeriod, type DepositPerson, type DepositRentalRow,
  type DepositsLedgerReport, type DepositVehicleRow, type LedgerCharge, type LedgerRefund,
} from "./deposits-ledger";
import type { DriverMatchApplication, DriverMatchRental } from "./stripe-driver-match";

/**
 * Owners and managers only. The flag is checked before any application,
 * rental, payment, vehicle, or Stripe read.
 */

const PAGE = 1000;
type Result<T> = { data: T[] | null; error: { message: string } | null };
export type DepositsLedgerResponse =
  | { status: "disabled"; report: null }
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: DepositsLedgerReport };

export async function runDepositsLedger(input: {
  enabled: boolean;
  userId: string | null;
  roles: string[];
  period: DepositPeriod;
  now?: Date;
  signal?: AbortSignal;
  load: () => Promise<{
    applications: DriverMatchApplication[];
    rentals: DriverMatchRental[];
    depositRentals: DepositRentalRow[];
    depositPayments: DepositPaymentRow[];
    vehicles: DepositVehicleRow[];
    people: DepositPerson[];
  } | null>;
  readStripe: (window: { gte: number; lt: number }) => Promise<{ ok: true; charges: LedgerCharge[]; refunds: LedgerRefund[] } | { ok: false; reason: string }>;
}): Promise<DepositsLedgerResponse> {
  if (!input.enabled) return { status: "disabled", report: null };
  if (!input.userId) throw new Error("Forbidden");
  const { tierFromRoles, tierAllows } = await import("./roles");
  if (!tierAllows(tierFromRoles(input.roles), "manager")) throw new Error("Forbidden");
  const now = input.now ?? new Date();
  const bounds = periodWindow(input.period, now);
  if (!bounds) return { status: "unavailable", reason: "The period could not be dated", report: null };
  const directory = await input.load();
  if (!directory) return { status: "unavailable", reason: "Deposit records were incomplete", report: null };
  const stripe = await input.readStripe(bounds);
  if (!stripe.ok) return { status: "unavailable", reason: stripe.reason, report: null };
  const report = buildDepositsLedger({ now, period: input.period, ...directory, charges: stripe.charges, refunds: stripe.refunds });
  return report ? { status: "ready", report } : { status: "unavailable", reason: "The ledger could not be totaled", report: null };
}

export async function loadDepositsDirectory(supabase: SupabaseClient<Database>, signal?: AbortSignal) {
  const applications = await readPages(async (cursor) => {
    let query = supabase.from("applications").select("id,full_name,email,phone,stripe_customer_id,user_id,deleted_at,status").order("id", { ascending: true }).limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const rentals = await readPages(async (cursor) => {
    let query = supabase.from("rentals").select("id,application_id,driver_id,vehicle_id,stripe_customer_id,deposit_amount,deposit_held,deposit_status").order("id", { ascending: true }).limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const payments = await readPages(async (cursor) => {
    let query = supabase.from("payments").select("id,rental_id,driver_id,vehicle_id,type,status,net_collected,paid_date").eq("type", "deposit").order("id", { ascending: true }).limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const vehicles = await readPages(async (cursor) => {
    let query = supabase.from("vehicles").select("id,year,make,model,unit_number").order("id", { ascending: true }).limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  if (!applications || !rentals || !payments || !vehicles) return null;
  return {
    applications: applications.map((row) => ({
      id: row.id, fullName: row.full_name, email: row.email, phone: row.phone, stripeCustomerId: row.stripe_customer_id,
      userId: row.user_id, deletedAt: row.deleted_at, status: row.status,
    })),
    rentals: rentals.map((row) => ({ id: row.id, applicationId: row.application_id, driverId: row.driver_id, stripeCustomerId: row.stripe_customer_id })),
    depositRentals: rentals.map((row) => ({
      id: row.id, applicationId: row.application_id, driverUserId: row.driver_id, vehicleId: row.vehicle_id,
      depositAmount: row.deposit_amount, depositHeld: row.deposit_held, depositStatus: row.deposit_status,
    })),
    depositPayments: payments.map((row) => ({
      id: row.id, rentalId: row.rental_id, driverId: row.driver_id, vehicleId: row.vehicle_id,
      status: row.status, netCollected: row.net_collected, paidDate: row.paid_date,
    })),
    vehicles: vehicles.map((row) => ({ id: row.id, year: row.year, make: row.make, model: row.model, unitNumber: row.unit_number })),
    people: applications.map((row) => ({ id: row.id, fullName: row.full_name, userId: row.user_id, phone: row.phone })),
  };
}

async function readPages<T extends { id: string }>(load: (cursor: string | null) => PromiseLike<Result<T>>, signal?: AbortSignal): Promise<T[] | null> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    signal?.throwIfAborted();
    const response = await load(cursor);
    if (response.error || !Array.isArray(response.data) || response.data.length > PAGE) return null;
    for (const row of response.data) {
      if (typeof row.id !== "string" || !row.id || (cursor !== null && row.id <= cursor)) return null;
      cursor = row.id;
      rows.push(row);
    }
    if (response.data.length < PAGE) return rows;
  }
  return null;
}
