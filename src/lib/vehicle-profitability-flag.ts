/**
 * Compile-time gate for Vehicle Profitability.
 *
 * false: the admin tab is omitted, the panel is not mounted, and the server
 * handler returns before any vehicle, expense, rental, payment, or Stripe read.
 * true: managers and owners see Vehicle Profit. Activation is changing this
 * constant and rebuilding. No environment variable can open it.
 */
export const VEHICLE_PROFITABILITY_ENABLED = false;
