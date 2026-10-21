/**
 * Collections Watch: money that was due and did not arrive.
 *
 * The same list the Overview Collections card and the Payments "overdue"
 * filter use. `current` is issued-but-not-yet-due and is deliberately absent.
 * This is a payments.status list. It does not call Stripe.
 */
export const COLLECTIONS_WATCH_STATUSES = [
  "late",
  "past_due",
  "collections",
  "overdue",
  "failed",
  "unpaid",
] as const;

export type CollectionsWatchStatus = (typeof COLLECTIONS_WATCH_STATUSES)[number];
