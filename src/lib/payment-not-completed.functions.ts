/**
 * Public server functions for the Payment Not Completed page. No login: the
 * Checkout Session id from Stripe's cancel return URL is the only key, and
 * payment-not-completed.server.ts scopes it to a Reservation Fee Checkout and
 * returns only what the page shows.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CHECKOUT_SESSION_ID_RE } from "@/lib/payment-received";
import type { PaymentNotCompletedView, RestartCheckoutResult } from "@/lib/payment-not-completed";

const SessionId = z.string().regex(CHECKOUT_SESSION_ID_RE);

export const getPaymentNotCompleted = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ sessionId: SessionId }).parse(d))
  .handler(async ({ data }): Promise<PaymentNotCompletedView> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { lookupPaymentNotCompleted } = await import("@/lib/payment-not-completed.server");
    return lookupPaymentNotCompleted(supabaseAdmin, data.sessionId);
  });

export const restartPaymentNotCompletedCheckout = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ sessionId: SessionId }).parse(d))
  .handler(async ({ data }): Promise<RestartCheckoutResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { restartReservationFeeCheckout } = await import("@/lib/payment-not-completed.server");
    return restartReservationFeeCheckout(supabaseAdmin, data.sessionId);
  });
