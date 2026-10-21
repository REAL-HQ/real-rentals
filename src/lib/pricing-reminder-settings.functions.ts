import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertPricingReminderSettingsEnabled, loadPricingReminderSettings } from "@/lib/pricing-reminder-settings";

/**
 * Read-only pricing and reminder schedule. The flag refusal runs before
 * auth, before the role check, and again before any settings read.
 */
const pricingReminderGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  assertPricingReminderSettingsEnabled();
  return next();
});

export const getPricingReminderSettings = createServerFn({ method: "GET" })
  .middleware([pricingReminderGate, requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertPricingReminderSettingsEnabled();
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadPricingReminderSettings(supabaseAdmin);
  });
