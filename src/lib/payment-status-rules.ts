// Which staff status changes a payment row may take, and who may make them.
//
// Shared by the Payments screen (to offer only allowed actions) and by
// changePaymentStatus (which enforces them and writes the audit row).
//
// The four outcomes are different things and are kept apart:
// - Paid: money was received. Stripe charges are marked paid by the webhook;
//   staff mark paid only for money received outside Stripe (cash, Zelle...).
// - Refund: money returned. Only in the Stripe Dashboard; the webhook records
//   it through apply_payment_refund. Never set from the app.
// - Void: the charge should never have existed (entered in error, replaced).
// - Waive: a legitimate debt is forgiven. Owner only.
// A paid, refunded, waived or void row is settled: the app never changes it,
// so a confirmed payment can't be un-paid (and charged again) by a misclick.
import type { StaffTier } from "@/lib/roles";
import { tierAllows } from "@/lib/roles";

/** Owed (or not yet due) and not being collected by Stripe right now. */
export const OPEN_STATUSES = ["upcoming", "current", "overdue", "past_due", "late", "failed", "unpaid", "collections"] as const;
/** A Stripe charge may still be in flight; the webhook settles it. */
export const IN_FLIGHT_STATUSES = ["pending"] as const;
export const SETTLED_STATUSES = ["paid", "refunded", "waived", "void"] as const;

export type PaymentStatusAction = "set_open_status" | "mark_paid" | "waive" | "void";

export const ACTION_LABEL: Record<PaymentStatusAction, string> = {
  set_open_status: "Change Status",
  mark_paid: "Mark as Paid (Received Outside Stripe)",
  waive: "Waive (Forgive Debt)",
  void: "Void (Entered In Error)",
};

const isOpen = (s: string) => (OPEN_STATUSES as readonly string[]).includes(s);

/** Minimum tier for an action from a given status, or null if the action is never allowed from it. */
export function requiredTier(action: PaymentStatusAction, from: string): StaffTier | null {
  switch (action) {
    case "set_open_status":
    case "void":
      return isOpen(from) ? "manager" : null;
    case "mark_paid":
      // From pending only the Owner, after confirming in Stripe that the webhook missed it.
      if (isOpen(from)) return "manager";
      return from === "pending" ? "owner" : null;
    case "waive":
      return isOpen(from) ? "owner" : null;
  }
}

export function canTake(tier: StaffTier | null, action: PaymentStatusAction, from: string): boolean {
  const need = requiredTier(action, from);
  return need != null && tierAllows(tier, need);
}

/** The status an action produces; set_open_status takes `to`, which must be open and different. */
export function targetStatus(action: PaymentStatusAction, from: string, to?: string | null): string | null {
  if (action === "set_open_status") return to && isOpen(to) && to !== from ? to : null;
  return { mark_paid: "paid", waive: "waived", void: "void" }[action];
}
