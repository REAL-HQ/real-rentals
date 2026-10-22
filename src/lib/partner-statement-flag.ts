/**
 * Compile-time gate for Partner Statement.
 *
 * false: the admin tab is omitted, and getPartnerStatement returns disabled
 * before the owner check and before any table or Stripe read.
 * true: owners get a per-partner statement for an Eastern Time period.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding. Leave it false until an owner does that.
 */
export const PARTNER_STATEMENT_ENABLED = false;
