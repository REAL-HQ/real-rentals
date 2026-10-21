import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { readFinanceDatabaseEvidence, type DatabaseEvidence } from "./unified-finance-database-transport.server";
import { assembleUnifiedFinanceReport, assertUnifiedFinanceAccess } from "./unified-finance-report.server";
import { unifiedFinanceRequestSchema, type FinanceSnapshots, type SourceSnapshot, type UnifiedFinanceRequest, type UnifiedFinanceResponse, type VehicleProfitSection } from "./unified-finance-contract";
import { vehicleProfitability, type ProfitExpense, type ProfitMaintenance, type ProfitPayment, type ProfitVehicle } from "./unified-finance-vehicles";

const UNVERIFIED = "Rows exist but reviewed contracts cannot verify them without inventing fees, currency, or provider evidence";
const VEHICLE_READ = "Vehicle profitability evidence was incomplete or changed during the read";
const PAGE = 1000;

/**
 * Flag-on report. Reads the caller's RLS client only.
 * Stripe has no reader and payments do not carry collection fees or provider
 * verification, so combined totals stay incomplete. Per-vehicle lines use the
 * existing profitability columns and are not written back as unified events.
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
  const report = assembleUnifiedFinanceReport(request, tier, snapshots);
  const vehicles = await readVehicleSection(input.supabase, request.period, input.signal);
  return { status: "ready", report, vehicles };
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
        let query = supabase.from("vehicle_expenses").select("id,vehicle_id,amount,incurred_on").order("id", { ascending: true }).limit(PAGE);
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
function mapExpense(row: { id: string; vehicle_id: string; amount: number; incurred_on: string }): ProfitExpense {
  return { vehicleId: text(row.vehicle_id), amount: money(row.amount), incurredOn: text(row.incurred_on) };
}
function mapMaintenance(row: { id: string; vehicle_id: string; company_share: number; total_cost: number; performed_on: string | null; completed_at: string | null; created_at: string }): ProfitMaintenance {
  return {
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
