/**
 * Staff card-link handoff. A card row lasts 72 hours. Once it is about 71
 * hours old (under an hour of life left) it is not offered again.
 */
export const CARD_LINK_MS = 72 * 60 * 60 * 1000;
export const CARD_LINK_MAX_AGE_MS = 71 * 60 * 60 * 1000;

export type CachedCardLink = { link: string; expiresAt: number };

export function cardLinkFresh(expiresAt: number, now = Date.now()): boolean {
  return Number.isFinite(expiresAt) && expiresAt - now > CARD_LINK_MS - CARD_LINK_MAX_AGE_MS;
}

export function readCachedCardLink(
  cache: Map<string, CachedCardLink>,
  applicationId: string,
  now = Date.now(),
): CachedCardLink | null {
  const entry = cache.get(applicationId);
  if (!entry) return null;
  if (!cardLinkFresh(entry.expiresAt, now)) {
    cache.delete(applicationId);
    return null;
  }
  return entry;
}

export function rememberCachedCardLink(
  cache: Map<string, CachedCardLink>,
  applicationId: string,
  entry: CachedCardLink,
): void {
  cache.set(applicationId, entry);
}

export function forgetCachedCardLink(cache: Map<string, CachedCardLink>, applicationId: string): void {
  cache.delete(applicationId);
}

export function cardTextHref(phone: string, link: string): string {
  const text = `Save your card on file for Real Rentals: ${link}`;
  return `sms:${phone}?&body=${encodeURIComponent(text)}`;
}

export function cardEmailHref(email: string, link: string): string {
  const text = `Save your card on file for Real Rentals: ${link}`;
  return `mailto:${email}?subject=${encodeURIComponent("Save your card on file")}&body=${encodeURIComponent(text)}`;
}
