/**
 * Compile-time gate for the owner partner statement.
 *
 * false: the admin tab is omitted, and getJvStatement returns disabled
 * before the owner check and before any table or Stripe read.
 * true: an owner can open one vehicle for an Eastern Time period.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding. Leave it false until an owner does that.
 */
export const FINANCE_JV_STATEMENT_ENABLED = false;
