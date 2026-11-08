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
export function initialPortalTab<T extends string>(search: string, fallback: T): T | "payments" {
  try {
    return new URLSearchParams(search).get("pay") === "balance" ? "payments" : fallback;
  } catch {
    return fallback;
  }
}
