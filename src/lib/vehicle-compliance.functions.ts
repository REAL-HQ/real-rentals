import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { VEHICLE_COMPLIANCE_ENABLED } from "./vehicle-compliance-flag";
import { COMPLIANCE_DISABLED, complianceToday, type VehicleComplianceResponse } from "./vehicle-compliance";

/** Read-only. While the flag is off this returns before the role check and before any read. */
export const getVehicleCompliance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data ?? {})
  .handler(async ({ context }): Promise<VehicleComplianceResponse> => {
    if (!VEHICLE_COMPLIANCE_ENABLED) return COMPLIANCE_DISABLED;
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    const { runVehicleCompliance, loadVehicleCompliance } = await import("./vehicle-compliance.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runVehicleCompliance({
      enabled: VEHICLE_COMPLIANCE_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      today: complianceToday(),
      load: () => loadVehicleCompliance(supabaseAdmin as unknown as Parameters<typeof loadVehicleCompliance>[0]),
    });
  });
