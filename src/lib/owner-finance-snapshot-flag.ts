/**
 * Owner Weekly Finance Snapshot is off until this constant is turned on in source.
 * false throws before the owner check and before any payment, reconciliation, or Stripe read,
 * omits the tab, and sends a direct link to Overview.
 * There is no environment variable for this flag.
 */
export const OWNER_FINANCE_SNAPSHOT_ENABLED = false;
export const OWNER_FINANCE_SNAPSHOT_OFF = "Owner Weekly Finance Snapshot Is Off";
