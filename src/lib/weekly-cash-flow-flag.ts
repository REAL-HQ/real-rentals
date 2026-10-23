/** Exact env string only. Unset, "TRUE", "1", and surrounding spaces stay off. */
export function weeklyCashFlowEnabled(env: { WEEKLY_CASH_FLOW_ENABLED?: string } = process.env): boolean {
  return env.WEEKLY_CASH_FLOW_ENABLED === "true";
}
