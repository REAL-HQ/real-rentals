/**
 * The vault's expiry tone. Expired is before now. Expiring soon is under 30
 * days. A document with no expiry, or one 30 days out, stays quiet.
 */
export function documentExpiryTone(
  expiresAt: string | null | undefined,
  now = Date.now(),
): "expired" | "soon" | null {
  if (!expiresAt) return null;
  const days = (new Date(expiresAt).getTime() - now) / 86400000;
  if (Number.isNaN(days)) return null;
  if (days < 0) return "expired";
  if (days < 30) return "soon";
  return null;
}
