/**
 * Deposits & Refunds Ledger is off until this constant is turned on in source.
 * false returns disabled before the role check and before any deposit or Stripe read.
 * There is no environment variable for this flag.
 */
export const DEPOSITS_LEDGER_ENABLED = false;
