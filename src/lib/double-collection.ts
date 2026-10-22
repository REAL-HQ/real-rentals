/** A manual payment Stripe later collected. No schema: the note lives on failure_reason. */

export const DOUBLE_COLLECTION_PREFIX = "Possible double collection:";

export function doubleCollectionMessage(amountCents: number, easternDate: string): string {
  const dollars = Number.isFinite(amountCents) ? amountCents / 100 : 0;
  return `${DOUBLE_COLLECTION_PREFIX} row marked paid manually, then Stripe collected $${dollars.toFixed(2)} on ${easternDate}; a refund may be owed.`;
}

export function isDoubleCollectionReason(reason: unknown): boolean {
  return typeof reason === "string" && reason.startsWith(DOUBLE_COLLECTION_PREFIX);
}

/** Calendar day in America/New_York for a Stripe unix timestamp. */
export function easternCollectionDay(unixSeconds: number): string | null {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return null;
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unixSeconds * 1000));
  return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : null;
}
