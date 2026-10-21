import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PORTAL_PAYMENT_HISTORY_ENABLED } from "@/lib/portal-payment-history-flag";
import { readOwnPaymentHistory, type PortalPaymentHistory } from "@/lib/portal-payment-history";

/** Refuses before auth. The handler never receives a driver id from the client. */
const portalPaymentHistoryGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (PORTAL_PAYMENT_HISTORY_ENABLED !== true) throw new Error("Payment history is not enabled.");
  return next();
});

export const getPortalPaymentHistory = createServerFn({ method: "GET" })
  .middleware([portalPaymentHistoryGate, requireSupabaseAuth])
  .handler(async ({ context }): Promise<PortalPaymentHistory> => {
    if (PORTAL_PAYMENT_HISTORY_ENABLED !== true) throw new Error("Payment history is not enabled.");
    const userId = context.userId;
    if (typeof userId !== "string" || userId.trim() === "") throw new Error("Payment history could not be loaded.");
    return readOwnPaymentHistory(context.supabase, userId);
  });
