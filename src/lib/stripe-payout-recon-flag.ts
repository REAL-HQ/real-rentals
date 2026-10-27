/**
 * Stripe Payout Reconciliation is off until this constant is turned on in source.
 * false returns before auth and before any payment or Stripe read,
 * omits the tab, and sends a direct link to Overview.
 * There is no environment variable for this flag.
 */
export const STRIPE_PAYOUT_RECON_ENABLED = false;
export const STRIPE_PAYOUT_RECON_OFF = "Stripe Payout Reconciliation Is Off";
