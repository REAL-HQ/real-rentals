import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { VEHICLE_PROFITABILITY_ENABLED } from "./vehicle-profitability-flag";
import { buildVehicleProfitReport, periodWindow, type ProfitCharge, type ProfitPeriodId, type VehicleProfitReport } from "./vehicle-profitability";

/**
 * Owners and managers only. The flag is checked before the role lookup and
 * before any table or Stripe read. Expense and maintenance rows are the same
 * tables the Unified Finance vehicle reader pages, with category and the
 * maintenance link included so a service is not counted twice.
 */

const PAGE = 1000;
type Result<T> = { data: T[] | null; error: { message: string } | null };

export type VehicleProfitResponse =
  | { status: "disabled"; report: null }
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: VehicleProfitReport };

export async function runVehicleProfit(input: {
  enabled: boolean;
  userId: string | null;
  roles: string[];
  period: ProfitPeriodId;
  now?: Date;
  signal?: AbortSignal;
  load: () => Promise<Parameters<typeof buildVehicleProfitReport>[0] | null>;
  readCharges: (window: { gte: number; lt: number }) => Promise<{ ok: true; charges: ProfitCharge[] } | { ok: false; reason: string }>;
}): Promise<VehicleProfitResponse> {
  if (!input.enabled) return { status: "disabled", report: null };
  if (!input.userId) throw new Error("Forbidden");
  const { tierFromRoles, tierAllows } = await import("./roles");
  if (!tierAllows(tierFromRoles(input.roles), "manager")) throw new Error("Forbidden");
  const now = input.now ?? new Date();
  if (!periodWindow(input.period, now)) return { status: "unavailable", reason: "The period could not be dated", report: null };
  const directory = await input.load();
  if (!directory) return { status: "unavailable", reason: "Vehicle records were incomplete", report: null };
  const bounds = periodWindow(input.period, now);
  if (!bounds) return { status: "unavailable", reason: "The period could not be dated", report: null };
  const charges = await input.readCharges({ gte: bounds.gte, lt: bounds.lt });
  if (!charges.ok) return { status: "unavailable", reason: charges.reason, report: null };
  const report = buildVehicleProfitReport({ ...directory, period: input.period, now, charges: charges.charges });
  return report ? { status: "ready", report } : { status: "unavailable", reason: "The period could not be dated", report: null };
}

export async function loadVehicleProfitDirectory(
  supabase: SupabaseClient<Database>,
  signal?: AbortSignal,
): Promise<Parameters<typeof buildVehicleProfitReport>[0] | null> {
  const vehicles = await readStable(async (cursor) => {
    let query = supabase.from("vehicles").select("id,year,make,model,license_plate,partner_id,created_at,archived_at").order("id", { ascending: true }).limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const partners = await readStable(async (cursor) => {
    let query = supabase.from("partners").select("id,name,revenue_split_pct").order("id", { ascending: true }).limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const expenses = await readStable(async (cursor) => {
    let query = supabase.from("vehicle_expenses").select("id,vehicle_id,category,amount,incurred_on,maintenance_record_id").order("id", { ascending: true }).limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const maintenance = await readStable(async (cursor) => {
    let query = supabase.from("maintenance_records").select("id,vehicle_id,category,company_share,performed_on,completed_at,created_at").order("id", { ascending: true }).limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const rentals = await readStable(async (cursor) => {
    let query = supabase.from("rentals").select("id,vehicle_id,stripe_customer_id,stripe_subscription_id,start_date,end_date,status").order("id", { ascending: true }).limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const payments = await readStable(async (cursor) => {
    let query = supabase.from("payments").select("id,vehicle_id,type,stripe_payment_intent_id,stripe_invoice_id,stripe_subscription_id").order("id", { ascending: true }).limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  if (!vehicles || !partners || !expenses || !maintenance || !rentals || !payments) return null;
  return {
    period: "this_month",
    now: new Date(),
    charges: [],
    vehicles: vehicles.map((row) => ({
      id: row.id, year: row.year, make: row.make, model: row.model, licensePlate: row.license_plate,
      partnerId: row.partner_id, createdAt: row.created_at, archivedAt: row.archived_at,
    })),
    partners: partners.map((row) => ({ id: row.id, name: row.name, revenueSplitPct: row.revenue_split_pct })),
    expenses: expenses.map((row) => ({
      id: row.id, vehicleId: row.vehicle_id, category: row.category, amount: row.amount,
      incurredOn: row.incurred_on, maintenanceRecordId: row.maintenance_record_id,
    })),
    maintenance: maintenance.map((row) => ({
      id: row.id, vehicleId: row.vehicle_id, category: row.category, companyShare: row.company_share,
      performedOn: row.performed_on, completedAt: row.completed_at, createdAt: row.created_at,
    })),
    rentals: rentals.map((row) => ({
      id: row.id, vehicleId: row.vehicle_id, customerId: row.stripe_customer_id, subscriptionId: row.stripe_subscription_id,
      startDate: row.start_date, endDate: row.end_date, status: row.status,
    })),
    payments: payments.map((row) => ({
      id: row.id, vehicleId: row.vehicle_id, type: row.type, paymentIntentId: row.stripe_payment_intent_id,
      invoiceId: row.stripe_invoice_id, subscriptionId: row.stripe_subscription_id,
    })),
  };
}

export function vehicleProfitEnabled(): boolean {
  return VEHICLE_PROFITABILITY_ENABLED;
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
  const first = await scan();
  const second = await scan();
  if (!first || !second || JSON.stringify(first) !== JSON.stringify(second)) return null;
  return first;
}
