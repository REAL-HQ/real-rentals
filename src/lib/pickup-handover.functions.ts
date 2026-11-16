import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { FUEL_LEVELS } from "@/lib/pickup-handover";

// Pickup checklist on the field rep's phone (/pickup/<reservation id>).
// Coordinators, Managers and Owners may fill it in; only a Manager or Owner
// completing it can trigger the automatic activation (the activation
// database function refuses anyone else).

async function deps() {
  const rentals = await import("@/lib/rentals.functions");
  return {
    readiness: (admin: any, applicationId: string, vehicleId: string) => rentals.evaluateReadiness(admin, applicationId, vehicleId),
    activate: (actor: any, input: Record<string, unknown>) => rentals.activateRentalCore(actor, input as any),
  };
}

export const getPickupHandover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rentalId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireTier } = await import("@/lib/roles.server");
    const actor = await requireTier(context.userId, "coordinator");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadHandover } = await import("@/lib/pickup-handover.server");
    return loadHandover(supabaseAdmin, actor, data.rentalId, await deps());
  });

export const submitPickupHandover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rentalId: z.string().uuid(),
        odometer: z.number().int().min(0).max(2_000_000),
        fuelLevel: z.enum(FUEL_LEVELS),
        renterSignatureName: z.string().trim().min(3).max(120),
        renterAgreed: z.literal(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { requireTier } = await import("@/lib/roles.server");
    const actor = await requireTier(context.userId, "coordinator");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { submitHandover } = await import("@/lib/pickup-handover.server");
    let ip: string | null = null;
    let userAgent: string | null = null;
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const req = getRequest();
      ip = req?.headers?.get("cf-connecting-ip") ?? req?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      userAgent = req?.headers?.get("user-agent") ?? null;
    } catch {
      /* no request context */
    }
    return submitHandover(supabaseAdmin, actor, { ...data, ip, userAgent }, await deps());
  });
