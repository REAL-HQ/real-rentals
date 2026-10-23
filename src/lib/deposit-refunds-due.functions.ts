import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { DEPOSIT_REFUNDS_DUE_ENABLED } from "./deposit-refunds-due-flag";
import type { DepositRefundsDueResponse } from "./deposit-refunds-due";

export const getDepositRefundsDue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({}).parse(data ?? {}))
  .handler(async ({ context }): Promise<DepositRefundsDueResponse> => {
    if (!DEPOSIT_REFUNDS_DUE_ENABLED) return { status: "disabled" };
    const { runDepositRefundsDue } = await import("./deposit-refunds-due.server");
    return runDepositRefundsDue({
      enabled: DEPOSIT_REFUNDS_DUE_ENABLED,
      supabase: context.supabase,
      userId: context.userId,
      now: new Date(),
    });
  });
