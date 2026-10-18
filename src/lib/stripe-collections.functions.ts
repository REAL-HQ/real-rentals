import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertCollectionsAccess, STRIPE_COLLECTIONS_ENABLED, type CollectionsReport } from "./stripe-collections";
import { loadStripeCollections } from "./stripe-collections.server";
import { getStripeErrorMessage } from "./stripe.server";

const input = z.object({ environment: z.enum(["sandbox", "live"]), from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) });

export const getStripeCollections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof input>) => input.parse(data))
  .handler(async ({ data, context }): Promise<{ report: CollectionsReport } | { error: string }> => {
    // Role evidence comes from the caller's authenticated/RLS client, not admin credentials.
    const { data: roles, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (error || !roles) throw new Error("Forbidden");
    assertCollectionsAccess(roles.map(r => r.role));
    if (!STRIPE_COLLECTIONS_ENABLED) return { error: "Stripe reporting is disabled" };
    try { return { report: await loadStripeCollections(data.environment, data) }; }
    catch (error) { return { error: getStripeErrorMessage(error) }; }
  });