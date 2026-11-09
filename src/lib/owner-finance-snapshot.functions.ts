import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { OWNER_FINANCE_SNAPSHOT_ENABLED, OWNER_FINANCE_SNAPSHOT_OFF } from "./owner-finance-snapshot-flag";
import type { AgingDirectoryClient } from "./receivables-aging.server";
import type { DepositDirectoryClient } from "./deposit-ledger.server";
import type { ForecastDirectoryClient } from "./revenue-forecast.server";
import type { RentDirectoryClient } from "./rent-reconciliation.server";
import type { OwnerFinanceSnapshotResponse } from "./owner-finance-snapshot.server";
import { depositsHeldCents, forecastTotalCents, outstandingBalanceCents, refundsDueCents } from "./owner-finance-snapshot";

/** Read-only. While the flag is off this throws before the owner check and before any read. */
export const getOwnerFinanceSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<OwnerFinanceSnapshotResponse> => {
    if (!OWNER_FINANCE_SNAPSHOT_ENABLED) throw new Error(OWNER_FINANCE_SNAPSHOT_OFF);
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const weekStart = weekStartOf(data);
    const { runOwnerFinanceSnapshot, rentCollectedCents } = await import("./owner-finance-snapshot.server");
    const { readPaymentReport } = await import("./revenue-report");
    const { loadRentReconciliation, runRentReconciliation } = await import("./rent-reconciliation.server");
    const { readLiveRentStripe } = await import("./rent-reconciliation-stripe.server");
    const { loadReceivablesAging, runReceivablesAging } = await import("./receivables-aging.server");
    const { etToday: agingToday } = await import("./receivables-aging");
    const { loadDepositLedger, runDepositLedger } = await import("./deposit-ledger.server");
    const { readLiveDepositStripe } = await import("./deposit-ledger-stripe.server");
    const { etToday: depositToday } = await import("./deposit-ledger");
    const { loadRevenueForecast, runRevenueForecast } = await import("./revenue-forecast.server");
    const { etToday: forecastToday } = await import("./revenue-forecast");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runOwnerFinanceSnapshot({
      enabled: OWNER_FINANCE_SNAPSHOT_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      now: new Date(),
      weekStart,
      rentCollected: async (week) => rentCollectedCents(await readPaymentReport(supabaseAdmin, (query) => query), week),
      reconciliation: (week) => runRentReconciliation({
        enabled: true,
        userId: actor.userId,
        tier: actor.tier,
        now: new Date(),
        weekStart: week.from,
        load: () => loadRentReconciliation(supabaseAdmin as unknown as RentDirectoryClient),
        stripe: (request) => readLiveRentStripe(request),
      }),
      outstanding: async () => {
        const result = await runReceivablesAging({
          enabled: true,
          userId: actor.userId,
          tier: actor.tier,
          today: agingToday(),
          load: () => loadReceivablesAging(supabaseAdmin as unknown as AgingDirectoryClient),
        });
        return result.status === "ready" ? outstandingBalanceCents(result.report) : null;
      },
      deposits: async () => {
        const result = await runDepositLedger({
          enabled: true,
          userId: actor.userId,
          tier: actor.tier,
          today: depositToday(),
          load: () => loadDepositLedger(supabaseAdmin as unknown as DepositDirectoryClient),
          stripe: (payments) => readLiveDepositStripe(payments),
        });
        if (result.status !== "ready") return { heldCents: null, dueBackCents: null };
        return { heldCents: depositsHeldCents(result.report), dueBackCents: refundsDueCents(result.report) };
      },
      forecast: async () => {
        const result = await runRevenueForecast({
          enabled: true,
          userId: actor.userId,
          tier: actor.tier,
          today: forecastToday(),
          load: () => loadRevenueForecast(supabaseAdmin as unknown as ForecastDirectoryClient),
        });
        return result.status === "ready" ? forecastTotalCents(result.report) : null;
      },
    });
  });

function weekStartOf(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("weekStart" in data)) return null;
  const value = (data as { weekStart?: unknown }).weekStart;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
