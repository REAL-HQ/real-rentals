/**
 * The only Stripe client the partner portal uses: Connect onboarding
 * (accounts.create, accountLinks.create, accounts.retrieve). Callers check
 * PARTNER_STRIPE_CONNECT_ENABLED first; this refuses too, so a stray import
 * cannot reach Stripe while the gate is closed.
 */
import { PARTNER_STRIPE_CONNECT_ENABLED } from "@/lib/partner-portal";

export const PARTNER_CONNECT_STRIPE_ENV = "live" as const;

export async function connectStripe() {
  if (!PARTNER_STRIPE_CONNECT_ENABLED) throw new Error("Partner payouts setup is not enabled");
  const { createStripeClient } = await import("@/lib/stripe.server");
  return createStripeClient(PARTNER_CONNECT_STRIPE_ENV, { timeout: 10000 });
}
