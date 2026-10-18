import { z } from "zod";
import { assertPeriod, type FinanceCoverage, type FinanceEvent, type FinanceReport } from "./unified-finance";
import type { DatedVehicleAllocation, ReconciliationResult, Representation } from "./unified-finance-reconciliation";

export const unifiedFinanceRequestSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }).strict(),
  basis: z.enum(["cash", "accrual"]), currency: z.literal("USD"),
  customerId: z.string().uuid().optional(), rentalId: z.string().uuid().optional(), vehicleId: z.string().uuid().optional(),
}).strict().superRefine((input, context) => {
  try { assertPeriod(input.period); } catch { context.addIssue({ code: "custom", message: "Invalid half-open reporting period" }); }
});
export type UnifiedFinanceRequest = z.infer<typeof unifiedFinanceRequestSchema>;
export const FINANCE_SOURCES = ["stripe", "payments", "ledger", "settlements", "expenses", "relationships"] as const;
export type FinanceSource = typeof FINANCE_SOURCES[number];
export type SourceCoverage = { state: FinanceCoverage; reasons: string[]; pages: number };
export type Visibility = "operating" | "owner_only";
/** Narrow normalized DTOs, not raw database/provider objects. No live mappings exist in Phase 2. */
export type FinanceSourceRow = {
  id: string; representation?: Representation; visibility: Visibility;
  posting?: "draft" | "posted" | "reversed";
  reversesId?: string | null; correctsId?: string | null;
  expenseId?: string | null;
  relationship?: { eventId: string; customerId: string | null; rentalId: string | null;
    servicePeriod: { from: string; to: string } | null; allocations: DatedVehicleAllocation[] };
  settlement?: { paymentId: string; obligationId: string; amountCents: number; currency: string };
};
export type SourceSnapshot = { rows: FinanceSourceRow[]; coverage: SourceCoverage };
export type FinanceSnapshots = Record<FinanceSource, SourceSnapshot>;
export type AdapterResult = {
  verified: Representation[]; posted: Representation[]; issues: string[]; complete: boolean;
  attributionComplete: { customer: boolean; rental: boolean; vehicle: boolean };
  settlements: { id: string; amountCents: number }[];
};
export type UnifiedFinanceReport = {
  request: UnifiedFinanceRequest; sources: Record<FinanceSource, SourceCoverage>;
  verifiedCollections: FinanceReport; postedLedger: FinanceReport;
  reconciliation: { verified: ReconciliationResult; posted: ReconciliationResult };
  attributionComplete: AdapterResult["attributionComplete"];
  issues: string[]; complete: boolean;
};
export type UnifiedFinanceResponse = { status: "disabled"; report: null } | { status: "ready"; report: UnifiedFinanceReport };
export type FinancePage = { rows: FinanceSourceRow[]; nextCursor: string | null };
export type FinancePageReader = (cursor: string | null, signal?: AbortSignal) => Promise<FinancePage>;
export type FinanceReadPlan = Partial<Record<FinanceSource, FinancePageReader>>;
export type FinanceEventDTO = FinanceEvent;