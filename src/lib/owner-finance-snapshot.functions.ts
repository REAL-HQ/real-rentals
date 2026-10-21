import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { OWNER_FINANCE_SNAPSHOT_ENABLED, OWNER_FINANCE_SNAPSHOT_OFF } from "./owner-finance-snapshot-flag";
import type { RentDirectoryClient } from "./rent-reconciliation.server";
import type { OwnerFinanceSnapshotResponse } from "./owner-finance-snapshot.server";

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
    });
  });

function weekStartOf(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("weekStart" in data)) return null;
  const value = (data as { weekStart?: unknown }).weekStart;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
