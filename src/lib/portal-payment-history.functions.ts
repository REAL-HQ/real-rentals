import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PORTAL_PAYMENT_HISTORY_ENABLED, readOwnPaymentHistory, type PortalPaymentHistory } from "@/lib/portal-payment-history";

const previewInput = (value: unknown): { previewDriverId?: string } => {
  const id = (value as { previewDriverId?: unknown } | null)?.previewDriverId;
  if (id == null || id === "") return {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid driver");
  return { previewDriverId: id };
};

/** Refuses before auth. The only driver id is verified by portalScope. */
const portalPaymentHistoryGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (PORTAL_PAYMENT_HISTORY_ENABLED !== true) throw new Error("Payment history is not enabled.");
  return next();
});

export const getPortalPaymentHistory = createServerFn({ method: "GET" })
  .middleware([portalPaymentHistoryGate, requireSupabaseAuth])
  .inputValidator(previewInput)
  .handler(async ({ context, data: input }): Promise<PortalPaymentHistory> => {
    if (PORTAL_PAYMENT_HISTORY_ENABLED !== true) throw new Error("Payment history is not enabled.");
    const { supabase, userId } = await (await import("@/lib/driver-preview.server")).portalScope(context, input, "payment_history");
    return readOwnPaymentHistory(supabase, userId);
  });
