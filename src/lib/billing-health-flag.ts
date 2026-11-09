/**
 * Billing Health is off until an owner turns this constant on in source.
 * false omits the tab, sends a direct link to Overview, and the server
 * returns disabled before the owner check and before any Stripe or table read.
 * There is no environment variable for this flag.
 */
export const BILLING_HEALTH_ENABLED = false;
