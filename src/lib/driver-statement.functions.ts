import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DRIVER_STATEMENT_ENABLED } from "./driver-statement-flag";
import { readLiveDriverStatement } from "./driver-statement-read.server";
import { loadStatementDirectory, runDriverStatement, type DriverStatementResponse } from "./driver-statement.server";

/** Read-only. The flag returns before roles, driver rows, and Stripe. */
export const getDriverStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown): { driverId: string } => {
    const driverId = data && typeof data === "object" && "driverId" in data ? (data as { driverId?: unknown }).driverId : "";
    return { driverId: typeof driverId === "string" ? driverId : "" };
  })
  .handler(async ({ data, context }): Promise<DriverStatementResponse> => {
    if (!DRIVER_STATEMENT_ENABLED) return { status: "disabled", report: null };
    if (!context.userId) throw new Error("Forbidden");
    const { data: roles, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (error || !roles) throw new Error("Forbidden");
    return runDriverStatement({
      enabled: DRIVER_STATEMENT_ENABLED,
      userId: context.userId,
      roles: roles.map((row) => row.role),
      driverId: data.driverId,
      load: () => loadStatementDirectory(context.supabase),
      readStripe: () => readLiveDriverStatement(),
    });
  });
