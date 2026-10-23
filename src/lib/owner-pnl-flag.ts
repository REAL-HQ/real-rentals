/**
 * Compile-time gate for Monthly Owner P&L.
 *
 * false: the admin tab is omitted, a direct link falls back to Overview, and
 * getOwnerPnl returns disabled before the owner check and before any table or
 * Stripe read.
 * true: owners get one Eastern Time month, the previous month beside it, and
 * a browser CSV.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding. Leave it false until an owner does that.
 */
export const OWNER_PNL_ENABLED = false;
