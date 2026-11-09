// Automated, correct-link follow-ups for Stripe invoices. Both pieces are
// Back Office → Automations switches that are OFF until an Owner turns them on:
//
//   payment_failed_text       text the renter the failed invoice's own page
//   stripe_subscription_link  link an unlinked subscription to its one renter,
//                             or alert staff when a renter has a second one
//
// Neither ever creates, changes or cancels anything in Stripe, and neither
// ever sends a generic Payment Link (see failed-payment-link.ts for why).
import { gateFor, loadAutomationControls } from "@/lib/automation-controls.server";
import {
  failedInvoiceLink,
  failedPaymentSmsBody,
  matchSubscriptionToRental,
  withinTextingHours,
  type RentalContact,
} from "@/lib/failed-payment-link";

export type SmsSender = (args: {
  to: string;
  body: string;
  kind?: string;
  applicationId?: string | null;
  rentalId?: string | null;
  vehicleId?: string | null;
  requireConsent?: boolean;
  fromId?: string | null;
  noticeTimeout?: boolean;
}) => Promise<{ ok: boolean; skipped?: boolean; reason?: string; error?: string }>;

export type FailedTextOutcome =
  | { sent: true }
  | { sent: false; reason: "off" | "held" | "no_link" | "no_phone" | "quiet_hours" | "send_failed" | string };

/**
 * Text the renter after a declined weekly invoice. Call only after the
 * webhook's per-attempt notice claim, so a replayed event never texts twice
 * (sendSms also drops an identical text to the same number within 2 minutes).
 *
 * Consent: this is a transactional billing notice about the renter's own
 * rental, so it does not need the marketing opt-in; an opt-out (STOP) always
 * wins inside sendSms.
 */
export async function sendFailedPaymentText(
  admin: unknown,
  input: {
    invoice: any;
    amount: number;
    rentalId: string;
    vehicleId?: string | null;
    applicationId: string | null;
    firstName: string | null;
    phone: string | null;
  },
  deps: { sendSms?: SmsSender; now?: Date } = {},
): Promise<FailedTextOutcome> {
  const gate = gateFor(await loadAutomationControls(admin), "payment_failed_text");
  if (gate !== "send") return { sent: false, reason: gate };
  const link = failedInvoiceLink(input.invoice);
  if (!link) return { sent: false, reason: "no_link" };
  if (!input.phone) return { sent: false, reason: "no_phone" };
  if (!withinTextingHours(deps.now ?? new Date())) return { sent: false, reason: "quiet_hours" };
  const send: SmsSender = deps.sendSms ?? (async (a) => (await import("@/lib/sms.server")).sendSms(a) as any);
  try {
    const res = await send({
      to: input.phone,
      body: failedPaymentSmsBody({ firstName: input.firstName, amount: input.amount, invoiceUrl: link }),
      kind: "payment_failed",
      applicationId: input.applicationId,
      rentalId: input.rentalId,
      vehicleId: input.vehicleId ?? null,
      requireConsent: false,
      // 888 (default line) unless PAYMENT_FAILED_SMS_FROM names another allowlisted Quo number, e.g. 813.
      fromId: process.env.PAYMENT_FAILED_SMS_FROM?.trim() || null,
      noticeTimeout: true,
    });
    if (res.ok) return { sent: true };
    return { sent: false, reason: res.reason ?? res.error ?? "send_failed" };
  } catch (err) {
    console.error("[payments] failed-payment text failed", err);
    return { sent: false, reason: "send_failed" };
  }
}

export type SubscriptionLinkOutcome =
  | { kind: "off" | "none" | "ambiguous" | "error" }
  | { kind: "linked"; rentalId: string }
  | { kind: "duplicate"; rentalId: string };

/**
 * An invoice arrived for a subscription no rental holds. When the switch is
 * on, match the invoice's customer email/phone to exactly one active rental:
 * link it if that rental has no subscription, or alert staff once if it
 * already has a different one (a second weekly subscription = double billing).
 */
export async function linkOrFlagSubscription(
  admin: any,
  invoice: any,
  subscriptionId: string,
  status: "paid" | "failed",
  deps: { alert?: (a: any) => Promise<unknown> } = {},
): Promise<SubscriptionLinkOutcome> {
  try {
    const gate = gateFor(await loadAutomationControls(admin), "stripe_subscription_link");
    if (gate !== "send") return { kind: "off" };
    const customer = { email: invoice?.customer_email ?? null, phone: invoice?.customer_phone ?? null };
    if (!customer.email && !customer.phone) return { kind: "none" };

    const rentals = await admin.from("rentals").select("id, application_id, stripe_subscription_id").eq("status", "active");
    if (rentals.error) return { kind: "error" };
    const list: any[] = rentals.data ?? [];
    const appIds = [...new Set(list.map((r) => r.application_id).filter(Boolean))];
    if (!appIds.length) return { kind: "none" };
    const apps = await admin.from("applications").select("id, email, phone, full_name").in("id", appIds);
    if (apps.error) return { kind: "error" };
    const appById = new Map<string, any>((apps.data ?? []).map((a: any) => [a.id, a]));
    const contacts: RentalContact[] = list.map((r) => ({
      rentalId: r.id,
      applicationId: r.application_id ?? null,
      email: appById.get(r.application_id)?.email ?? null,
      phone: appById.get(r.application_id)?.phone ?? null,
      stripeSubscriptionId: r.stripe_subscription_id ?? null,
    }));
    const match = matchSubscriptionToRental(customer, subscriptionId, contacts);

    if (match.kind === "link") {
      const customerId = typeof invoice?.customer === "string" ? invoice.customer : invoice?.customer?.id ?? null;
      const upd = await admin.from("rentals")
        .update({ stripe_subscription_id: subscriptionId, ...(customerId ? { stripe_customer_id: customerId } : {}), autopay_active: true })
        .eq("id", match.rentalId)
        .or("stripe_subscription_id.is.null")
        .select("id");
      if (upd.error || !upd.data?.length) return { kind: "error" };
      await admin.from("notifications").insert({
        title: "Subscription Linked",
        body: `Stripe subscription ${subscriptionId} linked to ${appById.get(match.applicationId ?? "")?.full_name ?? "a renter"}'s active rental.`,
        kind: "payment",
        read: false,
      }).then(() => {}, () => {});
      return { kind: "linked", rentalId: match.rentalId };
    }

    if (match.kind === "duplicate") {
      const name = appById.get(match.applicationId ?? "")?.full_name ?? null;
      const body = `${name ?? "A renter"} has a second Stripe subscription ${subscriptionId} (rental has ${match.existingSubscriptionId}). They may be billed twice.`;
      const seen = await admin.from("notifications").select("id").eq("title", "Possible Duplicate Subscription").eq("body", body).limit(1);
      if (!seen.error && !(seen.data?.length)) {
        await admin.from("notifications").insert({ title: "Possible Duplicate Subscription", body, kind: "payment", read: false }).then(() => {}, () => {});
        const amountCents = status === "paid" ? Number(invoice?.amount_paid ?? invoice?.amount_due ?? 0) : Number(invoice?.amount_due ?? 0);
        const alert = deps.alert ?? (async (a: any) => (await import("@/lib/email.server")).sendDuplicateSubscriptionAlertEmail(a));
        try {
          await alert({
            driverName: name,
            applicationId: match.applicationId,
            rentalId: match.rentalId,
            existingSubscriptionId: match.existingSubscriptionId,
            newSubscriptionId: subscriptionId,
            invoiceId: typeof invoice?.id === "string" ? invoice.id : null,
            amount: (Number.isFinite(amountCents) ? amountCents : 0) / 100,
            status,
          });
        } catch (err) {
          console.error("[payments] duplicate subscription alert failed", err);
        }
      }
      return { kind: "duplicate", rentalId: match.rentalId };
    }
    return { kind: match.kind === "ambiguous" ? "ambiguous" : "none" };
  } catch (err) {
    console.error("[payments] subscription matching failed", err);
    return { kind: "error" };
  }
}
