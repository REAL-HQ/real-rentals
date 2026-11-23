import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { UnmatchedPaymentRow } from "@/lib/unmatched-payments";

const idSchema = z.string().uuid();

async function manager(userId: string) {
  const { requireManager } = await import("@/lib/roles.server");
  return requireManager(userId);
}

export const listUnmatchedPaymentQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({}).parse(data ?? {}))
  .handler(async ({ context }): Promise<{ rows: UnmatchedPaymentRow[] }> => {
    await manager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listUnmatchedPayments } = await import("@/lib/unmatched-payments.server");
    return { rows: await listUnmatchedPayments(supabaseAdmin) };
  });

export const assignUnmatchedPaymentQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: idSchema, rentalId: idSchema }).parse(data))
  .handler(async ({ context, data }): Promise<{ ok: true; paymentId: string | null }> => {
    const actor = await manager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { assignUnmatchedPayment } = await import("@/lib/unmatched-payments.server");
    const result = await assignUnmatchedPayment(supabaseAdmin, { id: data.id, rentalId: data.rentalId, actorId: actor.userId });
    return { ok: true, paymentId: result.paymentId };
  });

export const dismissUnmatchedPaymentQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: idSchema, note: z.string().trim().min(3).max(500) }).parse(data))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const actor = await manager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { dismissUnmatchedPayment } = await import("@/lib/unmatched-payments.server");
    await dismissUnmatchedPayment(supabaseAdmin, { id: data.id, note: data.note, actorId: actor.userId });
    return { ok: true };
  });
