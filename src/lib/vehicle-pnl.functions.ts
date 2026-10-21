import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { VEHICLE_PNL_ENABLED } from "./vehicle-pnl-flag";
import type { VehiclePnlResponse } from "./vehicle-pnl";

const DISABLED: VehiclePnlResponse = { status: "disabled", report: null };

/** Read-only. While the flag is off this returns before the manager check and before any read. */
export const getVehiclePnl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<VehiclePnlResponse> => {
    if (!VEHICLE_PNL_ENABLED) return DISABLED;
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { loadVehiclePnl, runVehiclePnl } = await import("./vehicle-pnl.server");
    const { readVehiclePnlStripe } = await import("./vehicle-pnl-stripe.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const month = monthFrom(data);
    return runVehiclePnl({
      enabled: VEHICLE_PNL_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      month,
      load: () => loadVehiclePnl(supabaseAdmin as unknown as Parameters<typeof loadVehiclePnl>[0], readVehiclePnlStripe, month),
    });
  });

function monthFrom(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const month = (data as { month?: unknown }).month;
  return typeof month === "string" ? month : "";
}
