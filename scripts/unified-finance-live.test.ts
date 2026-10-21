import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UNIFIED_FINANCE_ENDPOINT_ENABLED } from "../src/lib/unified-finance-flag";
import { loadUnifiedFinanceReport } from "../src/lib/unified-finance-live.server";
import { vehicleProfitability, type ProfitExpense, type ProfitMaintenance, type ProfitPayment, type ProfitVehicle } from "../src/lib/unified-finance-vehicles";
import type { UnifiedFinanceRequest } from "../src/lib/unified-finance-contract";

const period = { from: "2026-10-01", to: "2026-11-01" };
const request: UnifiedFinanceRequest = { period, basis: "cash", currency: "USD" };
const vehicleId = "00000000-0000-4000-8000-0000000000aa";
const vehicle: ProfitVehicle = { id: vehicleId, year: 2020, make: "Toyota", model: "Camry", licensePlate: "ABC123" };
const rent = (overrides: Partial<ProfitPayment> = {}): ProfitPayment => ({
  vehicleId, status: "paid", type: "rent", netCollected: 125.5, paidDate: "2026-10-15", dueDate: "2026-10-01", ...overrides,
});
const expense = (overrides: Partial<ProfitExpense> = {}): ProfitExpense => ({ vehicleId, amount: 10, incurredOn: "2026-10-10", ...overrides });
const maintenance = (overrides: Partial<ProfitMaintenance> = {}): ProfitMaintenance => ({
  vehicleId, companyShare: 4, totalCost: 9, performedOn: "2026-10-20", completedAt: null, createdAt: "2026-10-20T15:00:00Z", ...overrides,
});

describe("per-vehicle profitability from existing columns", () => {
  it("counts paid and refunded rent, late fees, and other charges, and excludes deposits", () => {
    const result = vehicleProfitability(period, {
      payments: [
        rent(),
        rent({ status: "refunded", type: "late_fee", netCollected: 2, paidDate: "2026-10-16" }),
        rent({ type: "other", netCollected: 3, paidDate: "2026-10-17" }),
        rent({ type: "deposit", netCollected: 500, paidDate: "2026-10-18" }),
        rent({ status: "pending", netCollected: 80, paidDate: "2026-10-19" }),
      ],
      expenses: [expense(), expense({ incurredOn: "2026-11-01", amount: 99 })],
      maintenance: [maintenance()],
      vehicles: [vehicle],
    });
    expect(result.complete).toBe(true);
    expect(result.rows).toEqual([{
      vehicleId, label: "2020 Toyota Camry · ABC123",
      revenueCents: 12550 + 200 + 300, expenseCents: 1000, maintenanceCents: 400, netCents: 12550 + 200 + 300 - 1000 - 400,
    }]);
  });

  it("uses paid date before due date and keeps the end date outside the window", () => {
    const excluded = vehicleProfitability(period, {
      payments: [rent({ paidDate: "2026-11-01", dueDate: "2026-10-02" })], expenses: [], maintenance: [], vehicles: [vehicle],
    });
    expect(excluded.rows[0].revenueCents).toBe(0);
    const due = vehicleProfitability(period, {
      payments: [rent({ paidDate: null, dueDate: "2026-10-02" })], expenses: [], maintenance: [], vehicles: [vehicle],
    });
    expect(due.rows[0].revenueCents).toBe(12550);
  });

  it("returns no dollar rows when a qualifying amount cannot be placed", () => {
    const undated = vehicleProfitability(period, {
      payments: [rent({ paidDate: null, dueDate: null })], expenses: [], maintenance: [], vehicles: [vehicle],
    });
    expect(undated.complete).toBe(false);
    expect(undated.rows).toEqual([]);
    const badAmount = vehicleProfitability(period, {
      payments: [rent({ netCollected: 10.129 })], expenses: [], maintenance: [], vehicles: [vehicle],
    });
    expect(badAmount.complete).toBe(false);
    expect(badAmount.rows).toEqual([]);
    const outside = vehicleProfitability(period, {
      payments: [rent({ paidDate: "2026-09-01", netCollected: null })], expenses: [], maintenance: [], vehicles: [vehicle],
    });
    expect(outside.complete).toBe(true);
    expect(outside.rows[0].revenueCents).toBe(0);
  });

  it("uses company share and does not invent a maintenance date from a later timestamp when the first date is invalid", () => {
    const share = vehicleProfitability(period, {
      payments: [], expenses: [], maintenance: [maintenance({ companyShare: null, totalCost: 6 })], vehicles: [vehicle],
    });
    expect(share.rows[0].maintenanceCents).toBe(600);
    const invalid = vehicleProfitability(period, {
      payments: [], expenses: [], maintenance: [maintenance({ performedOn: "not-a-date", completedAt: "2026-10-20T15:00:00Z" })], vehicles: [vehicle],
    });
    expect(invalid.complete).toBe(false);
    expect(invalid.rows).toEqual([]);
  });
});

type Row = Record<string, unknown> & { id?: string };
function chain(rows: Row[]) {
  const state = { cursor: null as string | null };
  const builder = {
    select() { return builder; },
    order() { return builder; },
    limit() { return builder; },
    gt(_column: string, value: string) { state.cursor = value; return builder; },
    abortSignal() { return builder; },
    eq() { return Promise.resolve({ data: rows, error: null }); },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      const data = state.cursor ? rows.filter((row) => String(row.id) > state.cursor!) : rows;
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

function client(tables: Record<string, Row[]>, userId = "manager-1") {
  return {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from(table: string) { return chain(tables[table] ?? []); },
  };
}

const dbVehicle = { id: vehicleId, year: 2020, make: "Toyota", model: "Camry", license_plate: "ABC123" };
const dbPayment = {
  id: "00000000-0000-4000-8000-0000000000bb", vehicle_id: vehicleId, status: "paid", type: "rent",
  net_collected: 125.5, paid_date: "2026-10-15", due_date: "2026-10-01",
};

describe("live report behind the same flag", () => {
  it("stays compiled off", () => { expect(UNIFIED_FINANCE_ENDPOINT_ENABLED).toBe(false); });

  it("refuses a coordinator before any table read", async () => {
    const supabase = { auth: { getUser: () => { throw new Error("read"); } }, from() { throw new Error("read"); } };
    await expect(loadUnifiedFinanceReport({ request, userId: "coordinator-1", roles: ["coordinator"], supabase: supabase as never })).rejects.toThrow("Forbidden");
  });

  it("shows per-vehicle revenue and expenses to a manager without a combined total", async () => {
    const supabase = client({
      user_roles: [{ role: "team" }],
      payments: [dbPayment, { ...dbPayment, id: "00000000-0000-4000-8000-0000000000bc", type: "deposit", net_collected: 500 }],
      vehicle_expenses: [{ id: "00000000-0000-4000-8000-0000000000cc", vehicle_id: vehicleId, amount: 10, incurred_on: "2026-10-10" }],
      maintenance_records: [{ id: "00000000-0000-4000-8000-0000000000dd", vehicle_id: vehicleId, company_share: 4, total_cost: 9, performed_on: "2026-10-20", completed_at: null, created_at: "2026-10-20T15:00:00Z" }],
      vehicles: [dbVehicle],
    });
    const result = await loadUnifiedFinanceReport({ request, userId: "manager-1", roles: ["team"], supabase: supabase as never });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.report.complete).toBe(false);
    expect(result.report.financialScope).toBe("operating_only");
    expect(result.report.verifiedCollections.grossCollected).toEqual({ value: null, complete: false });
    expect(result.report.verifiedCollections.operatingResult.value).toBeNull();
    expect(result.report.sources.stripe.state).toBe("incomplete");
    expect(result.report.sources.payments.state).toBe("incomplete");
    expect(JSON.stringify(result.report.reconciliation)).not.toContain("12550");
    expect(result.vehicles.complete).toBe(true);
    expect(result.vehicles.rows[0]).toMatchObject({ label: "2020 Toyota Camry · ABC123", revenueCents: 12550, expenseCents: 1000, maintenanceCents: 400, netCents: 11150 });
  });

  it("drops the vehicle section when the second read disagrees", async () => {
    let reads = 0;
    const supabase = client({ user_roles: [{ role: "team" }], vehicles: [dbVehicle] });
    const original = supabase.from.bind(supabase);
    supabase.from = (table: string) => {
      if (table !== "payments") return original(table);
      reads += 1;
      return chain([{ ...dbPayment, net_collected: reads % 2 === 1 ? 125.5 : 130 }]);
    };
    const result = await loadUnifiedFinanceReport({ request, userId: "manager-1", roles: ["team"], supabase: supabase as never });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.vehicles).toEqual({ complete: false, rows: [], reasons: ["Vehicle profitability evidence was incomplete or changed during the read"] });
    expect(result.report.verifiedCollections.grossCollected.value).toBeNull();
  });

  it("keeps the screen and the handler behind the constant", () => {
    const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
    const admin = readFileSync("src/routes/admin.tsx", "utf8");
    const panel = readFileSync("src/components/admin/UnifiedFinancePanel.tsx", "utf8");
    const live = readFileSync("src/lib/unified-finance-live.server.ts", "utf8");
    expect(nav).toContain('label: "Unified Finance"');
    expect(nav).toContain('!UNIFIED_FINANCE_ENDPOINT_ENABLED || !tierAllows(tier, "manager")');
    expect(admin).toContain('urlTab === "finance"');
    expect(admin).toContain("UNIFIED_FINANCE_ENDPOINT_ENABLED && tab === \"finance\" && <UnifiedFinancePanel />");
    expect(panel).toContain("Per-Vehicle Profitability");
    expect(panel).toContain("Not Complete");
    expect(live).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(|\bfetch\s*\(|supabaseAdmin|client\.server|from\s+["']stripe["']|process\.env/);
    expect(live).toContain('createStripeClient("live")');
    expect(live).toContain("readStripeFinanceWindow");
    const endpoint = readFileSync("src/lib/unified-finance.functions.ts", "utf8");
    expect(endpoint).not.toContain("readStripeFinanceWindow");
    expect(endpoint).not.toContain("createStripeClient");
  });
});
