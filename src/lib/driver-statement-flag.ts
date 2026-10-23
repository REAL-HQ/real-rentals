/** Exact env string only. Unset, "TRUE", "1", and surrounding spaces stay off. */
export function driverStatementEnabled(env: { DRIVER_STATEMENT_ENABLED?: string } = process.env): boolean {
  return env.DRIVER_STATEMENT_ENABLED === "true";
}
