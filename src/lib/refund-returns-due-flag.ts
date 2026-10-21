/**
 * Refunds & Deposit Returns Due is off until an owner turns this constant on
 * in source. false omits the tab, sends a direct link to Overview, and the
 * server throws before the role check and before any table or Stripe read.
 * There is no environment variable for this flag.
 */
export const REFUND_RETURNS_DUE_ENABLED = false;

export const REFUND_RETURNS_DUE_OFF = "Refunds & Deposit Returns Due Is Off";
