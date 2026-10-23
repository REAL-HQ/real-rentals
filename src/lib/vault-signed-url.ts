/**
 * A vault download link is the signed URL adminListDriverDocuments already
 * stored on the row. withUrls signs it for 15 minutes. The token's exp is
 * the only clock on the URL. A link with no readable exp is "unknown": the
 * caller refreshes once through that same list, which is the vault's signer.
 */

export type VaultSignedUrlState = "usable" | "expired" | "unknown";

export function vaultSignedUrlState(url: string | null | undefined, now = Date.now()): VaultSignedUrlState {
  if (!url) return "unknown";
  const exp = signedUrlExpiryMs(url);
  if (exp == null) return "unknown";
  return exp <= now ? "expired" : "usable";
}

function signedUrlExpiryMs(url: string): number | null {
  const token = /[?&]token=([^&]+)/.exec(url)?.[1];
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    const exp = typeof payload.exp === "number" ? payload.exp : Number(payload.exp);
    if (!Number.isFinite(exp)) return null;
    return exp * 1000;
  } catch {
    return null;
  }
}

export type DocumentLink = { href: string | null; showExpired: boolean; shouldRefresh: boolean };

/**
 * Use a stored signed URL while it is still inside its exp. Once it is
 * expired, or its exp cannot be read, ask for one refresh through the vault
 * list. After that refresh a still-expired URL is not opened.
 */
export function quickReviewDocumentLink(input: {
  url: string | null;
  refreshState: "idle" | "pending" | "done";
  now?: number;
}): DocumentLink {
  const state = vaultSignedUrlState(input.url, input.now);
  if (input.url && state === "usable") return { href: input.url, showExpired: false, shouldRefresh: false };
  if (!input.url) return { href: null, showExpired: false, shouldRefresh: false };
  if (input.refreshState !== "done") return { href: null, showExpired: false, shouldRefresh: true };
  if (state === "unknown") return { href: input.url, showExpired: false, shouldRefresh: false };
  return { href: null, showExpired: true, shouldRefresh: false };
}
