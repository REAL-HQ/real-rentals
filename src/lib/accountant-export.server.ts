import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { tierAllows, type StaffTier } from "./roles";
import { OWNER_DIRECTORY_MAX_PAGES, OWNER_DIRECTORY_PAGE } from "./owner-pnl.server";
import type { OwnerFeeRead } from "./owner-pnl-fees";
import { monthWindow } from "./owner-pnl";
import {
  buildAccountantYear,
  monthsInYear,
  type AccountantYearReport,
  type ExpenseDetailSource,
} from "./accountant-export";
import type { OwnerCharge, OwnerPnlDirectory } from "./owner-pnl";

/**
 * Owners only. The flag is checked before the role and before any table or
 * Stripe read. Charges come from one readLivePartnerCharges call for the
 * year. Fees come from the caller, one Eastern Time month at a time, after
 * the charge read. This file does not import Stripe. Page size and page count are the
 * directory limits from Monthly Owner P&L.
 */

type Result<T> = { data: T[] | null; error: { message: string } | null };
type Bounded<T> = { rows: T[]; capped: boolean };

export type AccountantLoad = {
  directory: OwnerPnlDirectory;
  detailRows: ExpenseDetailSource[];
  vehicles: { id: string; label: string }[];
  vendors: { id: string; name: string }[];
  ledgerCapped: boolean;
  namesCapped: boolean;
};

export type AccountantExportResponse =
  | { status: "disabled"; report: null }
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: AccountantYearReport };

const LEDGER_CAP = `Records Reached The Existing Page Limit (${OWNER_DIRECTORY_MAX_PAGES} Pages Of ${OWNER_DIRECTORY_PAGE.toLocaleString("en-US")}). Totals That Depend On Them Are Blank.`;
const NAME_CAP = "Vehicle Or Vendor Names Reached The Existing Page Limit. The Expense Detail Is Omitted.";
const CHARGE_CAP = "Stripe Charge List Reached Its Page Limit. Revenue, Unattributed Charges, And Deposits Collected Are Blank.";

export async function runAccountantExport(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  year: string;
  now?: Date;
  load: () => Promise<AccountantLoad | null>;
  readCharges: (window: { gte: number; lt: number }) => Promise<{ ok: true; charges: OwnerCharge[] } | { ok: false; reason: string; capped?: boolean }>;
  readFees: (window: { gte: number; lt: number }) => Promise<OwnerFeeRead>;
}): Promise<AccountantExportResponse> {
  if (!input.enabled) return { status: "disabled", report: null };
  if (!input.userId || !tierAllows(input.tier, "owner")) throw new Error("Forbidden");
  const now = input.now ?? new Date();
  const months = monthsInYear(input.year, now);
  const first = months ? monthWindow(months[0]!) : null;
  const last = months ? monthWindow(months[months.length - 1]!) : null;
  if (!months || !first || !last) return { status: "unavailable", reason: "Choose a year through the current year", report: null };
  const loaded = await input.load();
  if (!loaded) return { status: "unavailable", reason: "Year records were incomplete", report: null };
  const charges = await input.readCharges({ gte: first.gte, lt: last.lt });
  if (!charges.ok && !charges.capped) return { status: "unavailable", reason: charges.reason, report: null };
  const feesByMonth: Record<string, OwnerFeeRead> = {};
  for (const month of months) {
    const window = monthWindow(month);
    if (!window) return { status: "unavailable", reason: "The year could not be dated", report: null };
    feesByMonth[month] = await settleFees(input.readFees, { gte: window.gte, lt: window.lt });
  }
  const warnings: string[] = [];
  if (loaded.ledgerCapped) warnings.push(LEDGER_CAP);
  if (loaded.namesCapped) warnings.push(NAME_CAP);
  if (!charges.ok && charges.capped) warnings.push(CHARGE_CAP);
  const blankLedger = loaded.ledgerCapped;
  const report = buildAccountantYear({
    year: input.year,
    now,
    directory: loaded.directory,
    charges: charges.ok ? charges.charges : [],
    detailRows: loaded.detailRows,
    vehicles: loaded.vehicles,
    vendors: loaded.vendors,
    blankRevenue: blankLedger || !charges.ok,
    blankExpenses: blankLedger,
    blankRefunds: blankLedger,
    omitDetails: blankLedger || loaded.namesCapped,
    warnings,
    feesByMonth,
  });
  return report ? { status: "ready", report } : { status: "unavailable", reason: "The year could not be dated", report: null };
}

export async function loadAccountantSources(
  supabase: SupabaseClient<Database>,
  signal?: AbortSignal,
): Promise<AccountantLoad | null> {
  const expenses = await readBounded(async (cursor) => {
    let query = supabase.from("vehicle_expenses").select("id,vehicle_id,category,amount,incurred_on,maintenance_record_id,vendor_id,description,receipt_path").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const maintenance = await readBounded(async (cursor) => {
    let query = supabase.from("maintenance_records").select("id,vehicle_id,category,company_share,total_cost,performed_on,completed_at,created_at").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const rentals = await readBounded(async (cursor) => {
    let query = supabase.from("rentals").select("id,vehicle_id,stripe_customer_id,stripe_subscription_id").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const payments = await readBounded(async (cursor) => {
    let query = supabase.from("payments").select("id,vehicle_id,rental_id,type,status,payment_method,amount,refunded_amount,refunded_at,paid_date,stripe_payment_intent_id,stripe_invoice_id,stripe_subscription_id").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const refunds = await readBounded(async (cursor) => {
    let query = supabase.from("payment_refunds").select("id,amount,status,created_at,payment_ids").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const vehicles = await readBounded(async (cursor) => {
    let query = supabase.from("vehicles").select("id,year,make,model,license_plate,unit_number").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const vendors = await readBounded(async (cursor) => {
    let query = supabase.from("vendors").select("id,name").order("id", { ascending: true }).limit(OWNER_DIRECTORY_PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  if (!expenses || !maintenance || !rentals || !payments || !refunds || !vehicles || !vendors) return null;
  const ledgerCapped = expenses.capped || maintenance.capped || rentals.capped || payments.capped || refunds.capped;
  const namesCapped = vehicles.capped || vendors.capped;
  return {
    ledgerCapped,
    namesCapped,
    directory: {
      expenses: expenses.rows.map((row) => ({
        id: row.id, vehicleId: row.vehicle_id, category: row.category, amount: row.amount,
        incurredOn: row.incurred_on, maintenanceRecordId: row.maintenance_record_id,
      })),
      maintenance: maintenance.rows.map((row) => ({
        id: row.id, vehicleId: row.vehicle_id, category: row.category, companyShare: row.company_share,
        totalCost: row.total_cost, performedOn: row.performed_on, completedAt: row.completed_at, createdAt: row.created_at,
      })),
      rentals: rentals.rows.map((row) => ({
        id: row.id, vehicleId: row.vehicle_id, customerId: row.stripe_customer_id, subscriptionId: row.stripe_subscription_id,
      })),
      payments: payments.rows.map((row) => ({
        id: row.id, vehicleId: row.vehicle_id, rentalId: row.rental_id, type: row.type, status: row.status,
        paymentMethod: row.payment_method, amount: row.amount, refundedAmount: row.refunded_amount,
        refundedAt: row.refunded_at, paidDate: row.paid_date, paymentIntentId: row.stripe_payment_intent_id,
        invoiceId: row.stripe_invoice_id, subscriptionId: row.stripe_subscription_id,
      })),
      vehicles: vehicles.rows.map((row) => ({
        id: row.id, year: row.year, make: row.make, model: row.model, licensePlate: row.license_plate,
      })),
      refunds: refunds.rows.map((row) => ({
        id: row.id, amount: row.amount, status: row.status, createdAt: row.created_at, paymentIds: row.payment_ids ?? [],
      })),
    },
    detailRows: expenses.rows.map((row) => ({
      incurredOn: row.incurred_on,
      vehicleId: row.vehicle_id,
      category: row.category,
      vendorId: row.vendor_id,
      description: row.description,
      amount: row.amount,
      receiptOnFile: typeof row.receipt_path === "string" && row.receipt_path.trim() !== "",
    })),
    vehicles: vehicles.rows.map((row) => ({
      id: row.id,
      label: [row.unit_number?.trim() ? `Unit ${row.unit_number.trim()}` : "", [row.year, row.make, row.model].filter((part) => part !== null && String(part).trim() !== "").join(" "), row.license_plate?.trim() ?? ""].filter(Boolean).join(" · "),
    })),
    vendors: vendors.rows.map((row) => ({ id: row.id, name: row.name })),
  };
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

async function readBounded<T extends { id: string }>(
  load: (cursor: string | null) => PromiseLike<Result<T>>,
  signal?: AbortSignal,
): Promise<Bounded<T> | null> {
  async function scan(): Promise<Bounded<T> | null> {
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
      if (response.data.length < OWNER_DIRECTORY_PAGE) return { rows, capped: false };
    }
    return { rows: [], capped: true };
  }
  const first = await scan();
  const second = await scan();
  if (!first || !second || first.capped !== second.capped) return null;
  if (first.capped) return { rows: [], capped: true };
  if (JSON.stringify(first.rows) !== JSON.stringify(second.rows)) return null;
  return first;
}
