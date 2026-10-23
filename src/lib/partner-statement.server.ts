import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { tierAllows, type StaffTier } from "./roles";
import {
  buildPartnerStatement,
  partnerOptions,
  periodWindow,
  type PartnerCharge,
  type PartnerStatementDirectory,
  type PartnerStatementPeriod,
  type PartnerStatementResponse,
} from "./partner-statement";

export type { PartnerStatementResponse };

/**
 * Owners only. The flag is checked before the role and before any table or
 * Stripe read. Listing partners does not call Stripe. A statement reads
 * charges only after the directory is in hand.
 */

const PAGE = 1000;
type Result<T> = { data: T[] | null; error: { message: string } | null };

export async function runPartnerStatement(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  partnerId: string | null;
  period: PartnerStatementPeriod;
  now?: Date;
  load: () => Promise<PartnerStatementDirectory | null>;
  readCharges: (window: { gte: number; lt: number }) => Promise<{ ok: true; charges: PartnerCharge[] } | { ok: false; reason: string }>;
}): Promise<PartnerStatementResponse> {
  if (!input.enabled) return { status: "disabled", partners: [], statement: null };
  if (!input.userId || !tierAllows(input.tier, "owner")) throw new Error("Forbidden");
  const now = input.now ?? new Date();
  if (!periodWindow(input.period, now)) return { status: "unavailable", reason: "The period could not be dated", partners: [], statement: null };
  const directory = await input.load();
  if (!directory) return { status: "unavailable", reason: "Partner records were incomplete", partners: [], statement: null };
  const partners = partnerOptions(directory.partners);
  if (!input.partnerId) return { status: "ready", partners, statement: null };
  const known = directory.partners.some((partner) => partner.id === input.partnerId)
    || directory.vehicles.some((vehicle) => vehicle.partnerId === input.partnerId);
  if (!known) return { status: "unavailable", reason: "Partner was not found", partners, statement: null };
  const bounds = periodWindow(input.period, now);
  if (!bounds) return { status: "unavailable", reason: "The period could not be dated", partners, statement: null };
  const charges = await input.readCharges({ gte: bounds.gte, lt: bounds.lt });
  if (!charges.ok) return { status: "unavailable", reason: charges.reason, partners, statement: null };
  const statement = buildPartnerStatement({ ...directory, partnerId: input.partnerId, period: input.period, now, charges: charges.charges });
  return statement
    ? { status: "ready", partners, statement }
    : { status: "unavailable", reason: "The period could not be dated", partners, statement: null };
}

export async function loadPartnerStatementDirectory(
  supabase: SupabaseClient<Database>,
  signal?: AbortSignal,
): Promise<PartnerStatementDirectory | null> {
  const vehicles = await readStable(async (cursor) => {
    let query = supabase.from("vehicles").select("id,year,make,model,license_plate,partner_id").order("id", { ascending: true }).limit(PAGE);
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
    vehicles: vehicles.map((row) => ({
      id: row.id, year: row.year, make: row.make, model: row.model, licensePlate: row.license_plate, partnerId: row.partner_id,
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
