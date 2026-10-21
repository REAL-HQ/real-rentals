import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { tierAllows, type StaffTier } from "./roles";
import {
  buildOwnerPnl,
  currentEtMonth,
  monthWindow,
  previousMonth,
  type OwnerCharge,
  type OwnerPnlDirectory,
  type OwnerPnlReport,
} from "./owner-pnl";

/**
 * Owners only. The flag is checked before the role and before any table or
 * Stripe read. Charges come from the caller (readLivePartnerCharges). This
 * file does not import Stripe.
 */

/** Same bounds the accountant export uses. A full page on the last pass is a cap, not a complete read. */
export const OWNER_DIRECTORY_PAGE = 1000;
export const OWNER_DIRECTORY_MAX_PAGES = 100;
type Result<T> = { data: T[] | null; error: { message: string } | null };

export type OwnerPnlResponse =
  | { status: "disabled"; report: null }
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: OwnerPnlReport };

export async function runOwnerPnl(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  month: string;
  now?: Date;
  load: () => Promise<OwnerPnlDirectory | null>;
  readCharges: (window: { gte: number; lt: number }) => Promise<{ ok: true; charges: OwnerCharge[] } | { ok: false; reason: string }>;
}): Promise<OwnerPnlResponse> {
  if (!input.enabled) return { status: "disabled", report: null };
  if (!input.userId || !tierAllows(input.tier, "owner")) throw new Error("Forbidden");
  const now = input.now ?? new Date();
  const latest = currentEtMonth(now);
  const prior = previousMonth(input.month);
  const current = monthWindow(input.month);
  const previous = prior ? monthWindow(prior) : null;
  if (!latest || !current || !previous) return { status: "unavailable", reason: "The month could not be dated", report: null };
  if (input.month > latest) return { status: "unavailable", reason: "Choose a month through the current month", report: null };
  const directory = await input.load();
  if (!directory) return { status: "unavailable", reason: "P&L records were incomplete", report: null };
  const currentCharges = await input.readCharges({ gte: current.gte, lt: current.lt });
  if (!currentCharges.ok) return { status: "unavailable", reason: currentCharges.reason, report: null };
  const previousCharges = await input.readCharges({ gte: previous.gte, lt: previous.lt });
  if (!previousCharges.ok) return { status: "unavailable", reason: previousCharges.reason, report: null };
  const report = buildOwnerPnl({
    ...directory,
    month: input.month,
    currentCharges: currentCharges.charges,
    previousCharges: previousCharges.charges,
  });
  return report ? { status: "ready", report } : { status: "unavailable", reason: "The month could not be dated", report: null };
}

export async function loadOwnerPnlDirectory(
  supabase: SupabaseClient<Database>,
  signal?: AbortSignal,
): Promise<OwnerPnlDirectory | null> {
  const expenses = await readStable(async (cursor) => {
    let query = supabase.from("vehicle_expenses").select("id,vehicle_id,category,amount,incurred_on,maintenance_record_id").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const maintenance = await readStable(async (cursor) => {
    let query = supabase.from("maintenance_records").select("id,vehicle_id,category,company_share,performed_on,completed_at,created_at").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const rentals = await readStable(async (cursor) => {
    let query = supabase.from("rentals").select("id,vehicle_id,stripe_customer_id,stripe_subscription_id").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const payments = await readStable(async (cursor) => {
    let query = supabase.from("payments").select("id,vehicle_id,type,stripe_payment_intent_id,stripe_invoice_id,stripe_subscription_id").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const refunds = await readStable(async (cursor) => {
    let query = supabase.from("payment_refunds").select("id,amount,status,created_at,payment_ids").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  if (!expenses || !maintenance || !rentals || !payments || !refunds) return null;
  return {
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
    })),
    payments: payments.map((row) => ({
      id: row.id, vehicleId: row.vehicle_id, type: row.type, paymentIntentId: row.stripe_payment_intent_id,
      invoiceId: row.stripe_invoice_id, subscriptionId: row.stripe_subscription_id,
    })),
    refunds: refunds.map((row) => ({
      id: row.id, amount: row.amount, status: row.status, createdAt: row.created_at, paymentIds: row.payment_ids ?? [],
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
    for (let page = 0; page < OWNER_DIRECTORY_MAX_PAGES; page++) {
      signal?.throwIfAborted();
      const response = await load(cursor);
      if (response.error || !Array.isArray(response.data) || response.data.length > OWNER_DIRECTORY_PAGE) return null;
      for (const row of response.data) {
        if (typeof row.id !== "string" || !row.id || (cursor !== null && row.id <= cursor)) return null;
        cursor = row.id;
        rows.push(row);
      }
      if (response.data.length < OWNER_DIRECTORY_PAGE) return rows;
    }
    return null;
  }
  const first = await scan();
  const second = await scan();
  if (!first || !second || JSON.stringify(first) !== JSON.stringify(second)) return null;
  return first;
}
