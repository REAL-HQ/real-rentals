/* eslint-disable @typescript-eslint/no-explicit-any -- the service-role client is used untyped here, as in rentals.functions.ts */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { RESERVATION_FEE_REFUND_REASONS } from "@/lib/reservation-fee-refund";

export const refundReservationFeePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        paymentId: z.string().uuid().optional(),
        applicationId: z.string().uuid().optional(),
        rentalId: z.string().uuid().optional(),
        reason: z.enum(RESERVATION_FEE_REFUND_REASONS),
        note: z.string().trim().max(500).nullable().optional(),
      })
      .strict()
      .refine((v) => !!(v.paymentId || v.applicationId || v.rentalId), { message: "Say which Reservation Fee to refund." })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { refundReservationFee } = await import("@/lib/reservation-fee-refund.server");
    return refundReservationFee(supabaseAdmin as any, {
      paymentId: data.paymentId ?? null,
      applicationId: data.applicationId ?? null,
      rentalId: data.rentalId ?? null,
      reason: data.reason,
      note: data.note ?? null,
      source: "staff",
      actor: { userId: actor.userId, email: actor.email ?? null, role: actor.role },
    });
  });

export const setRenterPolicyDeclined = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ applicationId: z.string().uuid(), note: z.string().trim().max(500).nullable().optional() }).strict().parse(d),
  )
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { markRenterPolicyDeclined } = await import("@/lib/reservation-fee-refund.server");
    return markRenterPolicyDeclined(supabaseAdmin as any, {
      applicationId: data.applicationId,
      note: data.note ?? null,
      actor: { userId: actor.userId, email: actor.email ?? null, role: actor.role },
    });
  });

export const getRenterPolicyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }): Promise<{ status: "pending" | "issued" | "declined" | null }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadRenterPolicyStatus } = await import("@/lib/reservation-fee-refund.server");
    return { status: await loadRenterPolicyStatus(supabaseAdmin as any, data.applicationId) };
  });
