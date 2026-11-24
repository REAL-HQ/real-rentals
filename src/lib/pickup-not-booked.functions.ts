import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PickupLinkResult, PickupLinkSendResult, PickupNotBookedState } from "@/lib/pickup-not-booked.server";

const UUID = z.string().uuid();

async function requireManager(userId: string) {
  const { requireManager: gate } = await import("@/lib/roles.server");
  return gate(userId);
}

/** Overview / Rental Next Step: whether this lead is Pickup Not Booked. */
export const getPickupNotBooked = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: UUID }).parse(d))
  .handler(async ({ context, data }): Promise<PickupNotBookedState> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadPickupNotBooked } = await import("@/lib/pickup-not-booked.server");
    return loadPickupNotBooked(supabaseAdmin, data.applicationId);
  });

/** Show or refresh the renter slot-picker link. Does not email or text. */
export const prepareStaffPickupLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: UUID }).parse(d))
  .handler(async ({ context, data }): Promise<PickupLinkResult> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { preparePickupLink } = await import("@/lib/pickup-not-booked.server");
    return preparePickupLink(supabaseAdmin, data.applicationId);
  });

/** Email that link from team@ when staff click Send. No SMS. */
export const sendStaffPickupLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: UUID }).parse(d))
  .handler(async ({ context, data }): Promise<PickupLinkSendResult> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendPickupLink } = await import("@/lib/pickup-not-booked.server");
    return sendPickupLink(supabaseAdmin, data.applicationId);
  });
