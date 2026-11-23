// Staff review queue for a succeeded Stripe charge that could not be tied to
// exactly one active rental. Pure labels and the row shape. No phone numbers.

export const UNMATCHED_PAYMENT_STATUSES = ["open", "assigned", "dismissed"] as const;
export type UnmatchedPaymentStatus = (typeof UNMATCHED_PAYMENT_STATUSES)[number];

export const UNMATCHED_STATUS_LABEL: Record<UnmatchedPaymentStatus, string> = {
  open: "Open",
  assigned: "Assigned",
  dismissed: "Dismissed",
};

export const UNMATCHED_WHY_LABEL = {
  no_match: "No Match",
  ambiguous: "More Than One Match",
} as const;

export type UnmatchedWhy = keyof typeof UNMATCHED_WHY_LABEL;

export type UnmatchedPaymentRow = {
  id: string;
  status: UnmatchedPaymentStatus;
  why: UnmatchedWhy;
  amountCents: number;
  currency: string;
  renterName: string | null;
  email: string | null;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  stripeChargeId: string | null;
  stripeCustomerId: string | null;
  rentalId: string | null;
  paymentId: string | null;
  note: string | null;
  createdAt: string | null;
};

export function unmatchedWhyLabel(why: string | null | undefined): string {
  if (why === "ambiguous") return UNMATCHED_WHY_LABEL.ambiguous;
  return UNMATCHED_WHY_LABEL.no_match;
}

export function formatUnmatchedAmount(cents: number, currency = "usd"): string {
  if (!Number.isSafeInteger(cents)) return "Unknown";
  try {
    return (cents / 100).toLocaleString("en-US", { style: "currency", currency: currency.toUpperCase() });
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}
