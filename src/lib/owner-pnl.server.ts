import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { tierAllows, type StaffTier } from "./roles";
import type { OwnerFeeRead } from "./owner-pnl-fees";
import {
  buildOwnerPnl,
  currentEtMonth,
  etYmd,
  monthWindow,
  previousMonth,
  type OwnerCharge,
  type OwnerPnlDirectory,
  type OwnerPnlReport,
} from "./owner-pnl";
import { buildOwnerPnlView, resolvePnlRange, type OwnerPnlView, type PnlFilter, type PnlPreset } from "./owner-pnl-range";
import type { OwnerFeeTxn } from "./owner-pnl-fees";

/**
 * Owners only. The flag is checked before the role and before any table or
 * Stripe read. Charges come from the caller (readLivePartnerCharges). Fees
 * come from the caller (readLiveOwnerPnlFees) after both charge reads
 * succeed. A failed fee read stays on the report. This file does not import Stripe.
 */

/** Same bounds the accountant export uses. A full page on the last pass is a cap, not a complete read. */
export const OWNER_DIRECTORY_PAGE = 1000;
export const OWNER_DIRECTORY_MAX_PAGES = 100;
type Result<T> = { data: T[] | null; error: { message: string } | null };

export type OwnerPnlResponse =
  | { status: "disabled"; report: null }
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: OwnerPnlReport };

export type OwnerPnlViewResponse =
  | { status: "disabled"; view: null }
  | { status: "unavailable"; reason: string; view: null }
  | { status: "ready"; view: OwnerPnlView };

export async function runOwnerPnl(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  month: string;
  now?: Date;
  load: () => Promise<OwnerPnlDirectory | null>;
  readCharges: (window: { gte: number; lt: number }) => Promise<{ ok: true; charges: OwnerCharge[] } | { ok: false; reason: string }>;
  readFees: (window: { gte: number; lt: number }) => Promise<OwnerFeeRead>;
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
  const currentFees = await settleFees(input.readFees, { gte: current.gte, lt: current.lt });
  const previousFees = await settleFees(input.readFees, { gte: previous.gte, lt: previous.lt });
  const report = buildOwnerPnl({
    ...directory,
    month: input.month,
    currentCharges: currentCharges.charges,
    previousCharges: previousCharges.charges,
    currentFees,
    previousFees,
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
    let query = supabase.from("maintenance_records").select("id,vehicle_id,category,company_share,total_cost,performed_on,completed_at,created_at").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const rentals = await readStable(async (cursor) => {
    let query = supabase.from("rentals").select("id,vehicle_id,stripe_customer_id,stripe_subscription_id,driver_id,application_id,start_date,end_date,status,deposit_held,deposit_amount,deposit_refund_amount,deposit_status").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const payments = await readStable(async (cursor) => {
    let query = supabase.from("payments").select("id,vehicle_id,rental_id,driver_id,type,status,payment_method,amount,balance_due,due_date,refunded_amount,refunded_at,paid_date,stripe_payment_intent_id,stripe_invoice_id,stripe_subscription_id,reason,notes").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const vehicles = await readStable(async (cursor) => {
    let query = supabase.from("vehicles").select("id,year,make,model,license_plate").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const applications = await readStable(async (cursor) => {
    let query = supabase.from("applications").select("id,user_id,full_name").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
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
  if (!expenses || !maintenance || !rentals || !payments || !refunds || !vehicles || !applications) return null;
  const finance = await supabase.from("vehicle_finance").select("vehicle_id,purchase_price").limit(OWNER_DIRECTORY_PAGE);
  const purchases = finance.error || !finance.data
    ? []
    : finance.data.map((row) => ({ vehicleId: row.vehicle_id, priceCents: purchaseCents(row.purchase_price) }));
  const people = peopleFrom(applications, rentals);
  return {
    expenses: expenses.map((row) => ({
      id: row.id, vehicleId: row.vehicle_id, category: row.category, amount: row.amount,
      incurredOn: row.incurred_on, maintenanceRecordId: row.maintenance_record_id,
    })),
    maintenance: maintenance.map((row) => ({
      id: row.id, vehicleId: row.vehicle_id, category: row.category, companyShare: row.company_share,
      totalCost: row.total_cost, performedOn: row.performed_on, completedAt: row.completed_at, createdAt: row.created_at,
    })),
    rentals: rentals.map((row) => ({
      id: row.id, vehicleId: row.vehicle_id, customerId: row.stripe_customer_id, subscriptionId: row.stripe_subscription_id,
      driverId: row.driver_id, applicationId: row.application_id, startDate: row.start_date, endDate: row.end_date,
      status: row.status, depositHeld: row.deposit_held, depositAmount: row.deposit_amount,
      depositRefundAmount: row.deposit_refund_amount, depositStatus: row.deposit_status,
    })),
    payments: payments.map((row) => ({
      id: row.id, vehicleId: row.vehicle_id, rentalId: row.rental_id, driverId: row.driver_id, type: row.type, status: row.status,
      paymentMethod: row.payment_method, amount: row.amount, balanceDue: row.balance_due, dueDate: row.due_date,
      refundedAmount: row.refunded_amount, refundedAt: row.refunded_at, paidDate: row.paid_date,
      paymentIntentId: row.stripe_payment_intent_id, invoiceId: row.stripe_invoice_id, subscriptionId: row.stripe_subscription_id,
      reason: row.reason, notes: row.notes,
    })),
    vehicles: vehicles.map((row) => ({
      id: row.id, year: row.year, make: row.make, model: row.model, licensePlate: row.license_plate,
    })),
    refunds: refunds.map((row) => ({
      id: row.id, amount: row.amount, status: row.status, createdAt: row.created_at, paymentIds: row.payment_ids ?? [],
    })),
    people,
    purchases,
  };
}

function purchaseCents(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function peopleFrom(
  applications: { id: string; user_id: string | null; full_name: string | null }[],
  rentals: { driver_id: string; application_id: string | null }[],
): { driverId: string; name: string }[] {
  const byApplication = new Map(applications.map((row) => [row.id, row.full_name?.trim() || ""]));
  const names = new Map<string, string>();
  for (const row of applications) {
    const name = row.full_name?.trim();
    if (row.user_id && name && !names.has(row.user_id)) names.set(row.user_id, name);
  }
  for (const rental of rentals) {
    const named = rental.application_id ? byApplication.get(rental.application_id) : "";
    if (rental.driver_id && named) names.set(rental.driver_id, named);
  }
  return [...names.entries()].map(([driverId, name]) => ({ driverId, name }));
}

export async function runOwnerPnlView(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  preset: PnlPreset;
  from?: string | null;
  through?: string | null;
  filter: PnlFilter;
  now?: Date;
  load: () => Promise<OwnerPnlDirectory | null>;
  readCharges: (window: { gte: number; lt: number }) => Promise<{ ok: true; charges: OwnerCharge[] } | { ok: false; reason: string }>;
  readFeeLines: (window: { gte: number; lt: number }) => Promise<{ ok: true; txns: OwnerFeeTxn[] } | { ok: false }>;
}): Promise<OwnerPnlViewResponse> {
  if (!input.enabled) return { status: "disabled", view: null };
  if (!input.userId || !tierAllows(input.tier, "owner")) throw new Error("Forbidden");
  const now = input.now ?? new Date();
  const today = etYmd(now);
  const range = resolvePnlRange({ preset: input.preset, now, from: input.from, through: input.through });
  if (!range || !today) return { status: "unavailable", reason: "The range could not be dated", view: null };
  const directory = await input.load();
  if (!directory) return { status: "unavailable", reason: "P&L records were incomplete", view: null };
  const listed = await input.readCharges({ gte: range.allTime.gte, lt: range.allTime.lt });
  let charges: OwnerCharge[] | null = listed.ok ? listed.charges : null;
  let allTimeRevenueKnown = listed.ok;
  let chargesCover = listed.ok ? { gte: range.allTime.gte, lt: range.allTime.lt } : null;
  if (!charges) {
    const coverFrom = range.previous && range.previous.gte < range.current.gte ? range.previous.gte : range.current.gte;
    const retry = await input.readCharges({ gte: coverFrom, lt: range.current.lt });
    if (!retry.ok) return { status: "unavailable", reason: retry.reason, view: null };
    charges = retry.charges;
    allTimeRevenueKnown = false;
    chargesCover = { gte: coverFrom, lt: range.current.lt };
  }
  const fees = await input.readFeeLines({ gte: range.allTime.gte, lt: range.allTime.lt });
  const view = buildOwnerPnlView({
    directory,
    charges,
    feeTxns: fees.ok ? fees.txns : null,
    range: { preset: input.preset, ...range },
    filter: input.filter,
    today,
    revenueKnown: chargesCover ? range.current.gte >= chargesCover.gte && range.current.gte < chargesCover.lt : false,
    allTimeRevenueKnown,
    chargesCover,
  });
  return view ? { status: "ready", view } : { status: "unavailable", reason: "The range could not be dated", view: null };
}

async function settleFees(
  read: (window: { gte: number; lt: number }) => Promise<OwnerFeeRead>,
  window: { gte: number; lt: number },
): Promise<OwnerFeeRead> {
  try {
    const result = await read(window);
    if (result?.ok === true && Number.isSafeInteger(result.feesCents)) return { ok: true, feesCents: result.feesCents };
    return { ok: false };
  } catch {
    return { ok: false };
  }
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
