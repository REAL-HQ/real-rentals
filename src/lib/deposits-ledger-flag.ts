/** Exact env string only. Unset, "TRUE", "1", and surrounding spaces stay off. */
export function depositsLedgerEnabled(env: { DEPOSITS_LEDGER_ENABLED?: string } = process.env): boolean {
  return env.DEPOSITS_LEDGER_ENABLED === "true";
}
