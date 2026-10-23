/** Live Stripe is read only when this variable is exactly the string "true". */
export function stripeMatchReportEnabled(env: { STRIPE_MATCH_REPORT_ENABLED?: string } = process.env): boolean {
  return env.STRIPE_MATCH_REPORT_ENABLED === "true";
}
