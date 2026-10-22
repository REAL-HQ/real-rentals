import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { tierAllows, type StaffTier } from "./roles";
import {
  buildJvStatement,
  jvVehicleOptions,
  periodWindow,
  type JvCharge,
  type JvDirectory,
  type JvPeriod,
  type JvStatementResponse,
} from "./jv-statement";

export type { JvStatementResponse };

/**
 * Owners only. The flag is checked before the role and before any table or
 * Stripe read. Choosing a vehicle does not call Stripe until the directory
 * is in hand. The loader only selects.
 */

const PAGE = 1000;
const DISABLED: JvStatementResponse = { status: "disabled", vehicles: [], statement: null };
type Result<T> = { data: T[] | null; error: { message: string } | null };

export async function runJvStatement(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  vehicleId: string | null;
  period: JvPeriod;
  now?: Date;
  load: () => Promise<JvDirectory | null>;
  readCharges: (window: {
    gte: number;
    lt: number;
  }) => Promise<{ ok: true; charges: JvCharge[] } | { ok: false; reason: string }>;
}): Promise<JvStatementResponse> {
  if (!input.enabled) return DISABLED;
  if (!input.userId || !tierAllows(input.tier, "owner")) throw new Error("Forbidden");
  const now = input.now ?? new Date();
  if (!periodWindow(input.period, now))
    return {
      status: "unavailable",
      reason: "The period could not be dated",
      vehicles: [],
      statement: null,
    };
  const directory = await input.load();
  if (!directory)
    return {
      status: "unavailable",
      reason: "Partner records were incomplete",
      vehicles: [],
      statement: null,
    };
  const vehicles = jvVehicleOptions(directory);
  if (!input.vehicleId) return { status: "ready", vehicles, statement: null };
  if (!directory.vehicles.some((vehicle) => vehicle.id === input.vehicleId)) {
    return { status: "unavailable", reason: "Vehicle was not found", vehicles, statement: null };
  }
  const bounds = periodWindow(input.period, now);
  if (!bounds)
    return {
      status: "unavailable",
      reason: "The period could not be dated",
      vehicles,
      statement: null,
    };
  const charges = await input.readCharges({ gte: bounds.gte, lt: bounds.lt });
  if (!charges.ok)
    return { status: "unavailable", reason: charges.reason, vehicles, statement: null };
  const statement = buildJvStatement({
    ...directory,
    vehicleId: input.vehicleId,
    period: input.period,
    now,
    charges: charges.charges,
  });
  return statement
    ? { status: "ready", vehicles, statement }
    : { status: "unavailable", reason: "The period could not be dated", vehicles, statement: null };
}

export async function loadJvDirectory(
  supabase: SupabaseClient<Database>,
  signal?: AbortSignal,
): Promise<JvDirectory | null> {
  const vehicles = await readStable(async (cursor) => {
    let query = supabase
      .from("vehicles")
      .select("id,year,make,model,license_plate,partner_id")
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const partners = await readStable(async (cursor) => {
    let query = supabase
      .from("partners")
      .select("id,name,revenue_split_pct")
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const expenses = await readStable(async (cursor) => {
    let query = supabase
      .from("vehicle_expenses")
      .select("id,vehicle_id,category,amount,incurred_on,maintenance_record_id")
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const maintenance = await readStable(async (cursor) => {
    let query = supabase
      .from("maintenance_records")
      .select(
        "id,vehicle_id,category,company_share,partner_share,total_cost,performed_on,completed_at,created_at",
      )
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const rentals = await readStable(async (cursor) => {
    let query = supabase
      .from("rentals")
      .select("id,vehicle_id,stripe_customer_id,stripe_subscription_id")
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const payments = await readStable(async (cursor) => {
    let query = supabase
      .from("payments")
      .select(
        "id,vehicle_id,rental_id,type,status,amount,payment_method,paid_date,refunded_amount,refunded_at,stripe_payment_intent_id,stripe_invoice_id,stripe_subscription_id",
      )
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const refunds = await readStable(async (cursor) => {
    let query = supabase
      .from("payment_refunds")
      .select("id,amount,status,created_at,payment_ids")
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  if (!vehicles || !partners || !expenses || !maintenance || !rentals || !payments || !refunds)
    return null;
  return {
    vehicles: vehicles.map((row) => ({
      id: row.id,
      year: row.year,
      make: row.make,
      model: row.model,
      licensePlate: row.license_plate,
      partnerId: row.partner_id,
    })),
    partners: partners.map((row) => ({
      id: row.id,
      name: row.name,
      revenueSplitPct: row.revenue_split_pct,
    })),
    expenses: expenses.map((row) => ({
      id: row.id,
      vehicleId: row.vehicle_id,
      category: row.category,
      amount: row.amount,
      incurredOn: row.incurred_on,
      maintenanceRecordId: row.maintenance_record_id,
    })),
    maintenance: maintenance.map((row) => ({
      id: row.id,
      vehicleId: row.vehicle_id,
      category: row.category,
      companyShare: row.company_share,
      partnerShare: row.partner_share,
      totalCost: row.total_cost,
      performedOn: row.performed_on,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    })),
    rentals: rentals.map((row) => ({
      id: row.id,
      vehicleId: row.vehicle_id,
      customerId: row.stripe_customer_id,
      subscriptionId: row.stripe_subscription_id,
    })),
    payments: payments.map((row) => ({
      id: row.id,
      vehicleId: row.vehicle_id,
      rentalId: row.rental_id,
      type: row.type,
      status: row.status,
      amount: row.amount,
      paymentMethod: row.payment_method,
      paidDate: row.paid_date,
      refundedAmount: row.refunded_amount,
      refundedAt: row.refunded_at,
      paymentIntentId: row.stripe_payment_intent_id,
      invoiceId: row.stripe_invoice_id,
      subscriptionId: row.stripe_subscription_id,
    })),
    refunds: refunds.map((row) => ({
      id: row.id,
      amount: row.amount,
      status: row.status,
      createdAt: row.created_at,
      paymentIds: row.payment_ids ?? [],
    })),
  };
}

async function readStable<T extends { id: string }>(
  load: (cursor: string | null) => PromiseLike<Result<T>>,
  signal?: AbortSignal,
): Promise<T[] | null> {
  async function scan(): Promise<T[] | null> {
    const rows: T[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      signal?.throwIfAborted();
      const response = await load(cursor);
      if (response.error || !Array.isArray(response.data) || response.data.length > PAGE)
        return null;
      for (const row of response.data) {
        if (typeof row.id !== "string" || !row.id || (cursor !== null && row.id <= cursor))
          return null;
        cursor = row.id;
        rows.push(row);
      }
      if (response.data.length < PAGE) return rows;
    }
    return null;
  }
  const first = await scan();
  const second = await scan();
  if (!first || !second || JSON.stringify(first) !== JSON.stringify(second)) return null;
  return first;
}
