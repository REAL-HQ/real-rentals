import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { readFinanceDatabaseEvidence, type DatabaseEvidence } from "./unified-finance-database-transport.server";
import { assembleUnifiedFinanceReport, assertUnifiedFinanceAccess } from "./unified-finance-report.server";
import { createStripeClient } from "./stripe.server";
import { readStripeFinanceWindow } from "./unified-finance-stripe-read.server";
import { buildVerifiedCollections, verifiedCollectionReport, type VerifiedPayment, type VerifiedRefundRow } from "./unified-finance-verified";
import { applyOperatingCards, assessOperating, type OperatingAssessment, type OperatingExpenseRow, type OperatingMaintenanceRow, type WaivedFeeRow } from "./unified-finance-operating";
import { unifiedFinanceRequestSchema, type FinanceSnapshots, type SourceCoverage, type SourceSnapshot, type UnifiedFinanceReport, type UnifiedFinanceRequest, type UnifiedFinanceResponse, type VehicleProfitSection } from "./unified-finance-contract";
import { vehicleProfitability, type ProfitExpense, type ProfitMaintenance, type ProfitPayment, type ProfitVehicle } from "./unified-finance-vehicles";

const UNVERIFIED = "Rows exist but reviewed contracts cannot verify them without inventing fees, currency, or provider evidence";
const VEHICLE_READ = "Vehicle profitability evidence was incomplete or changed during the read";
const PAGE = 1000;

/**
 * Flag-on report. Called only from the handler's true branch.
 * Stripe list/retrieve uses the same live client as Collections. Fees stay on
 * the balance transaction; nothing is written back. Per-vehicle lines stay separate.
 */
export async function loadUnifiedFinanceReport(input: {
  request: UnifiedFinanceRequest;
  userId: string;
  roles: string[];
  supabase: SupabaseClient<Database>;
  signal?: AbortSignal;
}): Promise<UnifiedFinanceResponse> {
  const tier = assertUnifiedFinanceAccess(input.userId, input.roles);
  const request = unifiedFinanceRequestSchema.parse(input.request);
  const context = { userId: input.userId, supabase: input.supabase };
  const [payments, ledger, settlements, expenses] = await Promise.all([
    readFinanceDatabaseEvidence(context, "payments", { signal: input.signal }),
    readFinanceDatabaseEvidence(context, "financial_transactions", { signal: input.signal }),
    readFinanceDatabaseEvidence(context, "financial_settlements", { signal: input.signal }),
    readFinanceDatabaseEvidence(context, "vehicle_expenses", { signal: input.signal }),
  ]);
  const snapshots: FinanceSnapshots = {
    stripe: unavailable("No approved reader"),
    relationships: unavailable("No approved reader"),
    payments: unverifiedSnapshot(payments),
    ledger: unverifiedSnapshot(ledger),
    settlements: unverifiedSnapshot(settlements),
    expenses: unverifiedSnapshot(expenses),
  };
  const assembled = assembleUnifiedFinanceReport(request, tier, snapshots);
  const verified = await readVerifiedCollections(input.supabase, request, input.signal);
  const operating = await readOperating(input.supabase, request.period, input.signal);
  const verifiedCollections = applyOperatingCards(verified?.cards ?? assembled.verifiedCollections, operating.assessment);
  const report: UnifiedFinanceReport = {
    ...assembled,
    verifiedCollections,
    unmatched: { ...(verified?.unmatched ?? { charges: 0, refunds: 0, payouts: 0, payments: 0, balanceTransactions: 0 }), ...operating.assessment.counts },
    gaps: operating.assessment.gaps,
    sources: {
      ...assembled.sources,
      ...(verified ? { stripe: verified.stripe, payments: verified.payments } : {}),
      expenses: operating.coverage,
    },
  };
  const vehicles = await readVehicleSection(input.supabase, request.period, input.signal);
  return { status: "ready", report, vehicles };
}

async function readVerifiedCollections(
  supabase: SupabaseClient<Database>,
  request: UnifiedFinanceRequest,
  signal?: AbortSignal,
): Promise<{ cards: UnifiedFinanceReport["verifiedCollections"]; unmatched: NonNullable<UnifiedFinanceReport["unmatched"]>; stripe: SourceCoverage; payments: SourceCoverage } | null> {
  const blocked = (reason: string) => {
    const coverage: SourceCoverage = { state: "incomplete", reasons: [reason], pages: 0 };
    return {
      cards: verifiedCollectionReport({ period: request.period, basis: request.basis, events: [], complete: false }),
      unmatched: { charges: 0, refunds: 0, payouts: 0, payments: 0, balanceTransactions: 0 },
      stripe: coverage,
      payments: coverage,
    };
  };
  try {
    const refundRows = await readStable(async (cursor) => {
      let query = supabase.from("payment_refunds").select("id,amount,status,stripe_charge_id,stripe_payment_intent_id,stripe_refund_id,payment_ids").order("id", { ascending: true }).limit(PAGE);
      if (cursor) query = query.gt("id", cursor);
      if (signal) query = query.abortSignal(signal);
      return query;
    }, signal);
    const paymentRows = await readStable(async (cursor) => {
      let query = supabase.from("payments").select("id,amount,refunded_amount,status,type,payment_method,paid_date,stripe_payment_intent_id").order("id", { ascending: true }).limit(PAGE);
      if (cursor) query = query.gt("id", cursor);
      if (signal) query = query.abortSignal(signal);
      return query;
    }, signal);
    if (!refundRows || !paymentRows) return null;
    const refunds: VerifiedRefundRow[] = refundRows.map((row) => ({
      id: row.id, amount: row.amount, status: row.status, chargeId: row.stripe_charge_id, paymentIntentId: row.stripe_payment_intent_id,
      refundId: row.stripe_refund_id, paymentIds: row.payment_ids ?? [],
    }));
    const payments: VerifiedPayment[] = paymentRows.map((row) => ({
      id: row.id, type: row.type, status: row.status, amount: row.amount, refundedAmount: row.refunded_amount, method: row.payment_method,
      paidDate: row.paid_date, paymentIntentId: row.stripe_payment_intent_id,
    }));
    let evidence: Awaited<ReturnType<typeof readStripeFinanceWindow>>;
    try {
      const stripe = createStripeClient("live");
      evidence = await readStripeFinanceWindow(stripe, request.period, { signal, retrieveChargeIds: refunds.flatMap((row) => row.chargeId ? [row.chargeId] : []) });
    } catch {
      evidence = { ok: false, reason: "Stripe evidence was incomplete or timed out" };
    }
    if (!evidence.ok) return blocked(evidence.reason);
    const match = buildVerifiedCollections({ period: request.period, basis: request.basis, charges: evidence.charges, balances: evidence.balances, payouts: evidence.payouts, payments, refunds });
    const coverage = (reasons: string[]): SourceCoverage => ({ state: match.complete ? "complete" : "incomplete", reasons, pages: match.complete ? 1 : 0 });
    return { cards: verifiedCollectionReport({ period: request.period, basis: request.basis, events: match.events, complete: match.complete }), unmatched: match.unmatched, stripe: coverage(match.reasons), payments: coverage(match.reasons) };
  } catch {
    return null;
  }
}

async function readOperating(
  supabase: SupabaseClient<Database>,
  period: { from: string; to: string },
  signal?: AbortSignal,
): Promise<{ assessment: OperatingAssessment; coverage: SourceCoverage }> {
  const failed: SourceCoverage = { state: "incomplete", reasons: ["Operating expense evidence was incomplete or changed during the read"], pages: 0 };
  try {
    const [expenses, maintenance, payments] = await Promise.all([
      readStable(async (cursor) => {
        let query = supabase.from("vehicle_expenses").select("id,vehicle_id,amount,incurred_on,maintenance_record_id").order("id", { ascending: true }).limit(PAGE);
        if (cursor) query = query.gt("id", cursor);
        if (signal) query = query.abortSignal(signal);
        return query;
      }, signal),
      readStable(async (cursor) => {
        let query = supabase.from("maintenance_records").select("id,vehicle_id,company_share,performed_on,completed_at,created_at").order("id", { ascending: true }).limit(PAGE);
        if (cursor) query = query.gt("id", cursor);
        if (signal) query = query.abortSignal(signal);
        return query;
      }, signal),
      readStable(async (cursor) => {
        let query = supabase.from("payments").select("id,status,type,amount,paid_date,due_date").order("id", { ascending: true }).limit(PAGE);
        if (cursor) query = query.gt("id", cursor);
        if (signal) query = query.abortSignal(signal);
        return query;
      }, signal),
    ]);
    if (!expenses || !maintenance || !payments) return { assessment: blankOperating(period), coverage: failed };
    const assessment = assessOperating({
      period,
      expenses: expenses.map(mapOperatingExpense),
      maintenance: maintenance.map(mapOperatingMaintenance),
      waivedFees: payments.map(mapWaivedFee),
    });
    if (!expenses.length && !maintenance.length && assessment.expensesComplete) {
      return { assessment, coverage: { state: "complete", reasons: [], pages: 1 } };
    }
    return {
      assessment,
      coverage: { state: assessment.expensesComplete ? "complete" : "incomplete", reasons: assessment.reasons, pages: assessment.expensesComplete ? 1 : 0 },
    };
  } catch {
    return { assessment: blankOperating(period), coverage: failed };
  }
}

function blankOperating(period: { from: string; to: string }): OperatingAssessment {
  return { ...assessOperating({ period, expenses: [], maintenance: [], waivedFees: [] }), expensesComplete: false, expenseCents: null };
}

function mapOperatingExpense(row: { id: string; vehicle_id: string | null; amount: number | null; incurred_on: string | null; maintenance_record_id: string | null }): OperatingExpenseRow {
  return { id: row.id, vehicleId: text(row.vehicle_id), amount: money(row.amount), incurredOn: text(row.incurred_on), maintenanceRecordId: text(row.maintenance_record_id) };
}
function mapOperatingMaintenance(row: { id: string; vehicle_id: string | null; company_share: number | null; performed_on: string | null; completed_at: string | null; created_at: string | null }): OperatingMaintenanceRow {
  return { id: row.id, vehicleId: text(row.vehicle_id), companyShare: money(row.company_share), performedOn: text(row.performed_on), completedAt: text(row.completed_at), createdAt: text(row.created_at) };
}
function mapWaivedFee(row: { id: string; status: string | null; type: string | null; amount: number | null; paid_date: string | null; due_date: string | null }): WaivedFeeRow {
  return { id: row.id, status: text(row.status), type: text(row.type), amount: money(row.amount), paidDate: text(row.paid_date), dueDate: text(row.due_date) };
}

function unavailable(reason: string): SourceSnapshot {
  return { rows: [], coverage: { state: "unavailable", reasons: [reason], pages: 0 } };
}
function unverifiedSnapshot(evidence: DatabaseEvidence): SourceSnapshot {
  if (evidence.coverage !== "complete") return { rows: [], coverage: { state: evidence.coverage, reasons: evidence.reasons, pages: 0 } };
  if (evidence.rows.length === 0) return { rows: [], coverage: { state: "complete", reasons: [], pages: 0 } };
  return { rows: [], coverage: { state: "incomplete", reasons: [UNVERIFIED], pages: 0 } };
}

async function readVehicleSection(
  supabase: SupabaseClient<Database>,
  period: { from: string; to: string },
  signal?: AbortSignal,
): Promise<VehicleProfitSection> {
  try {
    const [payments, expenses, maintenance, vehicles] = await Promise.all([
      readStable(async (cursor) => {
        let query = supabase.from("payments").select("id,vehicle_id,status,type,net_collected,paid_date,due_date").order("id", { ascending: true }).limit(PAGE);
        if (cursor) query = query.gt("id", cursor);
        if (signal) query = query.abortSignal(signal);
        return query;
      }, signal),
      readStable(async (cursor) => {
        let query = supabase.from("vehicle_expenses").select("id,vehicle_id,amount,incurred_on,maintenance_record_id").order("id", { ascending: true }).limit(PAGE);
        if (cursor) query = query.gt("id", cursor);
        if (signal) query = query.abortSignal(signal);
        return query;
      }, signal),
      readStable(async (cursor) => {
        let query = supabase.from("maintenance_records").select("id,vehicle_id,company_share,total_cost,performed_on,completed_at,created_at").order("id", { ascending: true }).limit(PAGE);
        if (cursor) query = query.gt("id", cursor);
        if (signal) query = query.abortSignal(signal);
        return query;
      }, signal),
      readStable(async (cursor) => {
        let query = supabase.from("vehicles").select("id,year,make,model,license_plate").order("id", { ascending: true }).limit(PAGE);
        if (cursor) query = query.gt("id", cursor);
        if (signal) query = query.abortSignal(signal);
        return query;
      }, signal),
    ]);
    if (!payments || !expenses || !maintenance || !vehicles) return { complete: false, rows: [], reasons: [VEHICLE_READ] };
    return vehicleProfitability(period, {
      payments: payments.map(mapPayment),
      expenses: expenses.map(mapExpense),
      maintenance: maintenance.map(mapMaintenance),
      vehicles: vehicles.map(mapVehicle),
    });
  } catch {
    return { complete: false, rows: [], reasons: [VEHICLE_READ] };
  }
}

async function readStable<T extends { id: string }>(
  load: (cursor: string | null) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
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

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function money(value: unknown): string | number | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}
function mapPayment(row: { id: string; vehicle_id: string | null; status: string; type: string; net_collected: number | null; paid_date: string | null; due_date: string | null }): ProfitPayment {
  return { vehicleId: text(row.vehicle_id), status: text(row.status), type: text(row.type), netCollected: money(row.net_collected), paidDate: text(row.paid_date), dueDate: text(row.due_date) };
}
function mapExpense(row: { id: string; vehicle_id: string; amount: number; incurred_on: string; maintenance_record_id: string | null }): ProfitExpense {
  return { vehicleId: text(row.vehicle_id), amount: money(row.amount), incurredOn: text(row.incurred_on), maintenanceRecordId: text(row.maintenance_record_id) };
}
function mapMaintenance(row: { id: string; vehicle_id: string; company_share: number; total_cost: number; performed_on: string | null; completed_at: string | null; created_at: string }): ProfitMaintenance {
  return {
    id: row.id,
    vehicleId: text(row.vehicle_id),
    companyShare: money(row.company_share),
    totalCost: money(row.total_cost),
    performedOn: text(row.performed_on),
    completedAt: text(row.completed_at),
    createdAt: text(row.created_at),
  };
}
function mapVehicle(row: { id: string; year: number | null; make: string | null; model: string | null; license_plate: string | null }): ProfitVehicle {
  return { id: row.id, year: typeof row.year === "number" ? row.year : null, make: text(row.make), model: text(row.model), licensePlate: text(row.license_plate) };
}
