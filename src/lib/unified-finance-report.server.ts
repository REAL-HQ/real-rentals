import { tierFromRoles } from "./roles";
import { summarizeFinance } from "./unified-finance";
import { reconcileFinance } from "./unified-finance-reconciliation";
import { adaptFinanceSnapshots } from "./unified-finance-adapters";
import { FINANCE_SOURCES, unifiedFinanceRequestSchema, type FinanceReadPlan, type UnifiedFinanceReport, type UnifiedFinanceRequest, type UnifiedFinanceResponse } from "./unified-finance-contract";
import { readFinanceSnapshots } from "./unified-finance-readers.server";
export { UNIFIED_FINANCE_ENDPOINT_ENABLED } from "./unified-finance-flag";

// Compile-time closed. No environment variable or client request can activate this endpoint.
// UNIFIED_FINANCE_ENDPOINT_ENABLED only installs the root session observer. This module's
// production caller still returns disabledUnifiedFinanceResponse.
export function assertUnifiedFinanceAccess(userId: string | null, roles: string[]): "owner" | "manager" {
  const tier = tierFromRoles(roles);
  if (!userId || (tier !== "owner" && tier !== "manager")) throw new Error("Forbidden");
  return tier;
}
export function disabledUnifiedFinanceResponse(userId: string | null, roles: string[]): UnifiedFinanceResponse {
  assertUnifiedFinanceAccess(userId, roles);
  return { status: "disabled", report: null };
}
/** Not an endpoint: injected mock orchestration only. Production function never calls this. */
export async function buildMockUnifiedFinanceReport(requestInput: UnifiedFinanceRequest, identity: { userId: string | null; roles: string[] }, plan: FinanceReadPlan, signal?: AbortSignal): Promise<UnifiedFinanceReport> {
  const tier = assertUnifiedFinanceAccess(identity.userId, identity.roles);
  const request = unifiedFinanceRequestSchema.parse(requestInput);
  const snapshots = await readFinanceSnapshots(plan, tier, signal);
  const adapted = adaptFinanceSnapshots(snapshots, request, tier);
  const verified = reconcileFinance(adapted.verified, { basis: request.basis });
  const posted = reconcileFinance(adapted.posted, { basis: request.basis });
  const sourceComplete = FINANCE_SOURCES.every(source => snapshots[source].coverage.state === "complete");
  const coverage = sourceComplete && adapted.complete ? "complete" : "incomplete";
  const verifiedCollections = summarizeFinance({ events: verified.events, ...request, coverage: verified.complete ? coverage : "incomplete" });
  const postedLedger = summarizeFinance({ events: posted.events, ...request, coverage: posted.complete ? coverage : "incomplete" });
  return { request, financialScope: tier === "manager" ? "operating_only" : "authorized_owner", sources: Object.fromEntries(FINANCE_SOURCES.map(s => [s, snapshots[s].coverage])) as UnifiedFinanceReport["sources"],
    verifiedCollections, postedLedger, reconciliation: { verified, posted }, attributionComplete: adapted.attributionComplete,
    issues: adapted.issues, complete: sourceComplete && adapted.complete && verifiedCollections.complete && postedLedger.complete };
}