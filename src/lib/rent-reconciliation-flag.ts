/**
 * Rent Payment Reconciliation is off until this constant is turned on in source.
 * false throws before the manager check and before any payment or Stripe read,
 * omits the tab, and sends a direct link to Overview.
 * There is no environment variable for this flag.
 */
export const RENT_RECONCILIATION_ENABLED = false;
export const RENT_RECONCILIATION_OFF = "Rent Payment Reconciliation Is Off";
