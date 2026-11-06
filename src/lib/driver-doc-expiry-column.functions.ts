import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DOC_EXPIRY_REFUSED,
  DRIVER_DOC_EXPIRY_ROW_CAP,
  assertDriverDocExpiryEnabled,
  type DriverDocExpiryResult,
} from "./driver-doc-expiry-column";

const driverDocExpiryGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  assertDriverDocExpiryEnabled();
  return next();
});

const idle = (): DriverDocExpiryResult => ({
  failed: false,
  truncated: false,
  cap: DRIVER_DOC_EXPIRY_ROW_CAP,
  drivers: [],
});

export const getDriverDocExpiry = createServerFn({ method: "GET" })
  .middleware([driverDocExpiryGate, requireSupabaseAuth])
  .handler(async ({ context }): Promise<DriverDocExpiryResult> => {
    if (DOC_EXPIRY_REFUSED) {
      assertDriverDocExpiryEnabled();
      return idle();
    }
    const { loadDriverDocExpiry } = await import("./driver-doc-expiry-load");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadDriverDocExpiry(supabaseAdmin);
  });
