import { easternDay, stripeId, subscriptionIdOf } from "@/lib/stripe-unmatched";
import { tierAllows, tierFromRoles } from "@/lib/roles";

export type LinkResult =
  | { status: "disabled" }
  | { status: "linked"; paymentId: string }
  | { status: "refused"; reason: string };

type LinkStripe = {
  invoices: {
    retrieve: (id: string, params: { expand: ["payments"] }) => Promise<unknown>;
  };
};

/**
 * Records one paid Stripe invoice on a rental. The caller passes `enabled`
 * from STRIPE_UNMATCHED_LINK_ENABLED. Amount, paid date, and payment intent
 * come from the Stripe invoice, never from the client.
 */
export async function runUnmatchedLink(args: {
  enabled: boolean;
  supabase: any;
  stripe: LinkStripe;
  userId: string;
  invoiceId: string;
  rentalId: string;
}): Promise<LinkResult> {
  if (!args.enabled) return { status: "disabled" };
  const { data: roles, error: roleError } = await args.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", args.userId);
  const names = Array.isArray(roles) ? roles.map((row: { role?: string }) => String(row.role ?? "")) : [];
  if (roleError || !tierAllows(tierFromRoles(names), "manager")) {
    throw new Error("Forbidden");
  }

  let invoice: any;
  try {
    invoice = await args.stripe.invoices.retrieve(args.invoiceId, { expand: ["payments"] });
  } catch {
    return { status: "refused", reason: "Stripe check unavailable" };
  }
  if (!invoice || invoice.id !== args.invoiceId || invoice.livemode === false) {
    return { status: "refused", reason: "Stripe check unavailable" };
  }
  if (invoice.status !== "paid") {
    return { status: "refused", reason: "Stripe says this invoice is not paid." };
  }
  if (String(invoice.currency ?? "").toLowerCase() !== "usd") {
    return { status: "refused", reason: "Stripe check unavailable" };
  }
  const amountCents = invoice.amount_paid;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { status: "refused", reason: "Stripe check unavailable" };
  }
  const paidAt = Number(invoice.status_transitions?.paid_at);
  const paidOn = Number.isFinite(paidAt) && paidAt > 0 ? easternDay(new Date(paidAt * 1000)) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) {
    return { status: "refused", reason: "Stripe did not return a paid date." };
  }
  const intents = paymentIntentIds(invoice);
  if (intents == null) {
    return { status: "refused", reason: "Stripe did not return every payment on this invoice." };
  }
  if (intents.length > 1) {
    return { status: "refused", reason: "This invoice has more than one payment, so it was not recorded." };
  }

  const invoiceHit = await args.supabase.from("payments").select("id").eq("stripe_invoice_id", args.invoiceId);
  if (invoiceHit.error) throw new Error("Could not record this payment.");
  if (Array.isArray(invoiceHit.data) && invoiceHit.data.length > 0) {
    return { status: "refused", reason: "This invoice is already recorded." };
  }
  const paymentIntentId = intents[0] ?? null;
  if (paymentIntentId) {
    const intentHit = await args.supabase.from("payments").select("id").eq("stripe_payment_intent_id", paymentIntentId);
    if (intentHit.error) throw new Error("Could not record this payment.");
    if (Array.isArray(intentHit.data) && intentHit.data.length > 0) {
      return { status: "refused", reason: "This invoice is already recorded." };
    }
  }

  const rentalResult = await args.supabase
    .from("rentals")
    .select("id, application_id, vehicle_id")
    .eq("id", args.rentalId)
    .maybeSingle();
  if (rentalResult.error) throw new Error("Could not record this payment.");
  const rental = rentalResult.data;
  if (!rental || rental.id !== args.rentalId) {
    return { status: "refused", reason: "That rental was not found." };
  }

  const inserted = await args.supabase.from("payments").insert({
    rental_id: rental.id,
    driver_id: rental.application_id ?? null,
    vehicle_id: rental.vehicle_id ?? null,
    amount: Number((amountCents / 100).toFixed(2)),
    balance_due: 0,
    type: "rent",
    reason: "rent",
    status: "paid",
    due_date: paidOn,
    paid_date: paidOn,
    stripe_invoice_id: args.invoiceId,
    stripe_subscription_id: subscriptionIdOf(invoice),
    stripe_payment_intent_id: paymentIntentId,
    failure_reason: null,
    notified_status: "paid",
  }).select("id");
  if (inserted.error?.code === "23505") {
    return { status: "refused", reason: "This invoice is already recorded." };
  }
  if (inserted.error || !inserted.data?.[0]?.id) throw new Error("Could not record this payment.");
  return { status: "linked", paymentId: String(inserted.data[0].id) };
}

function paymentIntentIds(invoice: any): string[] | null {
  const page = invoice.payments;
  if (!page || !Array.isArray(page.data) || page.has_more !== false) return null;
  const ids: string[] = [];
  for (const item of page.data) {
    const payment = item && typeof item === "object" && item.payment && typeof item.payment === "object" ? item.payment : null;
    const intent = stripeId(payment?.payment_intent);
    if (intent && !ids.includes(intent)) ids.push(intent);
  }
  return ids;
}
