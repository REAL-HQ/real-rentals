/**
 * Stripe Disputes & Failed-Payment Monitor is off until this constant is turned on in source.
 * false throws before the manager check and before any driver or Stripe read,
 * omits the tab, and sends a direct link to Overview.
 * There is no environment variable for this flag.
 */
export const STRIPE_RISK_MONITOR_ENABLED = false;
export const STRIPE_RISK_MONITOR_OFF = "Stripe Disputes & Failed-Payment Monitor Is Off";
