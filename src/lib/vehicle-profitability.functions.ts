import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { VEHICLE_PROFITABILITY_ENABLED } from "./vehicle-profitability-flag";
import { readLiveProfitCharges } from "./vehicle-profitability-read.server";
import { loadVehicleProfitDirectory, runVehicleProfit, vehicleProfitEnabled, type VehicleProfitResponse } from "./vehicle-profitability.server";

const input = z.object({ period: z.enum(["this_month", "last_month", "last_90"]) });

/** Read-only. The flag returns before roles, tables, and Stripe. */
export const getVehicleProfitReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }): Promise<VehicleProfitResponse> => {
    if (!vehicleProfitEnabled()) return { status: "disabled", report: null };
    if (!context.userId) throw new Error("Forbidden");
    const { data: roles, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (error || !roles) throw new Error("Forbidden");
    return runVehicleProfit({
      enabled: VEHICLE_PROFITABILITY_ENABLED,
      userId: context.userId,
      roles: roles.map((row) => row.role),
      period: data.period,
      signal: undefined,
      load: () => loadVehicleProfitDirectory(context.supabase),
      readCharges: (window) => readLiveProfitCharges(window),
    });
  });
