/**
 * The document vault's expiry reading.
 *
 * Same comparison DocumentVault used inline: no date is not expired, a
 * negative day-count is expired, and under 30 days is soon. Day 30 is not
 * soon. Callers pass `now` so a test can pin the clock; the vault passes
 * Date.now().
 */
export type DocumentExpiryTone = "expired" | "soon" | null;

export function documentExpiryTone(
  expiresAt: string | null | undefined,
  now = Date.now(),
): DocumentExpiryTone {
  if (!expiresAt) return null;
  const days = (new Date(expiresAt).getTime() - now) / 86400000;
  if (days < 0) return "expired";
  if (days < 30) return "soon";
  return null;
}
