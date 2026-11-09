/**
 * Compile-time gate for Stripe Payout Breakdown.
 *
 * false: the admin tab is omitted, a direct link falls back to Overview, and
 * getPayoutBreakdown returns disabled before the owner check and before any
 * Stripe or table read.
 * true: an owner sees payouts in an Eastern Time range, the balance
 * transactions inside each one, and a browser CSV.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding. Leave it false until an owner does that.
 */
export const PAYOUT_BREAKDOWN_ENABLED = false;
