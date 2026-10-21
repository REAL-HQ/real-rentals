import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { VEHICLE_PROFITABILITY_ENABLED, VEHICLE_PROFITABILITY_OFF } from "./vehicle-profitability-flag";
import type { VehicleProfitClient, VehicleProfitResponse } from "./vehicle-profitability.server";

/** Read-only. While the flag is off this throws before the manager check and before any read. */
export const getVehicleProfitReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<VehicleProfitResponse> => {
    if (!VEHICLE_PROFITABILITY_ENABLED) throw new Error(VEHICLE_PROFITABILITY_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { loadVehicleProfitDirectory, runVehicleProfit } = await import("./vehicle-profitability.server");
    return runVehicleProfit({
      enabled: VEHICLE_PROFITABILITY_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      now: new Date(),
      range: rangeFrom(data),
      load: () => loadVehicleProfitDirectory(context.supabase as unknown as VehicleProfitClient),
    });
  });

function rangeFrom(data: unknown): { from: string; through: string } | null {
  if (!data || typeof data !== "object") return null;
  const from = (data as { from?: unknown }).from;
  const through = (data as { through?: unknown }).through;
  if (typeof from !== "string" || typeof through !== "string") return null;
  return { from, through };
}
