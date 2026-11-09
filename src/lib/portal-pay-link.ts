// The "Pay Now" link in renter payment emails.
//
// It is one fixed address with no token or amount in it. Opening it only
// shows the driver portal's Payments tab; paying still goes through the
// portal's existing Pay Now (payRentalBalance): the renter must be signed in,
// the rental must be theirs, the balance is recomputed on the server, a
// payment still processing blocks another, and nothing owed means nothing
// is charged. So a forwarded or old email can never pay the wrong amount,
// pay someone else's balance, or pay twice. No Stripe Checkout Session or
// Payment Link is created for it.
export const PORTAL_PAY_URL = "https://drivereal.com/portal?pay=balance";

/** Which portal tab to open first: Payments when the email link was used. */
export function initialPortalTab<T extends string>(search: string, fallback: T, store?: Store | null): T | "payments" {
  const fromUrl = wantsPay(search);
  const fromStore = takePayIntent(store);
  return fromUrl || fromStore ? "payments" : fallback;
}

// ---- Keeping "pay" through sign-in -------------------------------------------
// A renter who opens Pay Now while signed out goes /portal → /login → (code,
// password or the emailed one-time link) → /portal. The intent rides in the
// URL (?pay=balance) and, for the emailed link that opens a new tab, in this
// browser's localStorage for 2 hours. It is a single allowlisted word, never
// a URL, so it cannot redirect anywhere else, and it carries nothing secret.
export const PAY_INTENT_KEY = "rr:portal-pay-intent";
const PAY_INTENT_MS = 2 * 60 * 60 * 1000;
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function rememberPayIntent(store: Store | null | undefined, now = Date.now()): void {
  try { store?.setItem(PAY_INTENT_KEY, String(now)); } catch { /* private mode */ }
}

/** True once if a fresh intent was stored; clears it either way. */
export function takePayIntent(store: Store | null | undefined, now = Date.now()): boolean {
  try {
    const v = store?.getItem(PAY_INTENT_KEY);
    if (v == null) return false;
    store?.removeItem(PAY_INTENT_KEY);
    const at = Number(v);
    return Number.isFinite(at) && now - at >= 0 && now - at < PAY_INTENT_MS;
  } catch {
    return false;
  }
}

export function wantsPay(search: string): boolean {
  try { return new URLSearchParams(search).get("pay") === "balance"; } catch { return false; }
}
