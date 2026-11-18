/**
 * Public server functions for the Payment Received page. No login: the
 * Checkout Session id from Stripe's return URL is the only key, and
 * payment-received.server.ts scopes it to a paid Reservation Fee Checkout and
 * returns only what the page shows.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CHECKOUT_SESSION_ID_RE, type BookPickupResult, type PaymentReceivedView } from "@/lib/payment-received";

const SessionId = z.string().regex(CHECKOUT_SESSION_ID_RE);

export const getPaymentReceived = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ sessionId: SessionId }).parse(d))
  .handler(async ({ data }): Promise<PaymentReceivedView> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { lookupPaymentReceived } = await import("@/lib/payment-received.server");
    return lookupPaymentReceived(supabaseAdmin, data.sessionId);
  });

export const bookPaymentReceivedPickup = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ sessionId: SessionId, startAt: z.string().min(16).max(40) }).parse(d))
  .handler(async ({ data }): Promise<BookPickupResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { bookRenterPickup } = await import("@/lib/payment-received.server");
    return bookRenterPickup(supabaseAdmin, { sessionId: data.sessionId, startAt: data.startAt });
  });
