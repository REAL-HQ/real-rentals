import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { TOLLS_UNBILLED_ENABLED } from "./tolls-unbilled-flag";
import { buildUnbilledTolls, type UnbilledTollsResponse } from "./tolls-unbilled";

/**
 * Runs before requireSupabaseAuth. Returning `result` does not call next(),
 * so a hard-off flag never reads the bearer token or the database.
 */
const gateUnbilledTolls = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (!TOLLS_UNBILLED_ENABLED) {
    return { result: { status: "disabled", report: null } } as any;
  }
  return next();
});

export const getUnbilledTolls = createServerFn({ method: "POST" })
  .middleware([gateUnbilledTolls, requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({}).parse(data ?? {}))
  .handler(async ({ context }): Promise<UnbilledTollsResponse> => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { loadUnbilledTolls } = await import("./tolls-unbilled.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const loaded = await loadUnbilledTolls(supabaseAdmin as { from: (table: string) => any });
    if (!loaded) return { status: "unavailable", reason: "The toll read did not complete.", report: null };
    return { status: "ready", report: buildUnbilledTolls(loaded, new Date()) };
  });
