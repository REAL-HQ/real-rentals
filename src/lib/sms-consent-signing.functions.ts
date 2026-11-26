/**
 * Public Reservation Fee consent write. The Checkout Session id or the
 * signing ticket identifies the person. The phone is read in the server
 * module, never accepted here.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { CHECKOUT_SESSION_ID_RE } from "@/lib/payment-received";

const Input = z.object({
  consent: z.boolean(),
  ticket: z.string().min(20).max(4000).optional(),
  sessionId: z.string().regex(CHECKOUT_SESSION_ID_RE).optional(),
}).refine((d) => Boolean(d.ticket) !== Boolean(d.sessionId), { message: "Choose one consent key" });

export const recordReservationFeeSmsConsent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { captureReservationFeeSmsConsent } = await import("@/lib/sms-consent-signing.server");
    const { requestMeta } = await import("@/lib/esign.server");
    const meta = requestMeta(getRequest());
    return captureReservationFeeSmsConsent(supabaseAdmin, {
      consent: data.consent,
      ticket: data.ticket ?? null,
      sessionId: data.sessionId ?? null,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });
