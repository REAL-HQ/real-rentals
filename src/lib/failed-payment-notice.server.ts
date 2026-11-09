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
  const now = deps.now ?? new Date();
  // One schedule with the rent reminders: claim today's slot in the shared
  // ledger (overdue first, then daily) so the hourly scheduler never repeats
  // it. If the ledger table is not there yet, behave exactly as before.
  const slot = await webhookReminderSlot(admin, input.rentalId, input.invoice, "sms", now, { phone: input.phone });
  if (slot.kind === "taken") return { sent: false, reason: "already_sent" };
  let body = failedPaymentSmsBody({ firstName: input.firstName, amount: input.amount, invoiceUrl: link });
  if (slot.kind === "claimed" && slot.useReminderTemplate) {
    const rendered = await renderWebhookReminder(admin, slot, input, link, now);
    if (rendered) body = rendered.sms;
  }
  const send: SmsSender = deps.sendSms ?? (async (a) => (await import("@/lib/sms.server")).sendSms(a) as any);
  try {
    const res = await send({
      to: input.phone,
      body,
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


// ------------------------------------------------------------------ shared ledger

export type WebhookSlot =
  | { kind: "legacy" }
  | { kind: "taken" }
  | { kind: "claimed"; dueDate: string; ledgerStage: string; useReminderTemplate: boolean };

/**
 * Claim the shared rent-reminder ledger slot for a failed Stripe invoice.
 * "legacy" = no ledger yet (migration not applied): send as before.
 * "taken"  = today's reminder for this week already went out: send nothing.
 */
export async function webhookReminderSlot(
  admin: any,
  rentalId: string,
  invoice: any,
  channel: "sms" | "email",
  now: Date,
  opts: { phone?: string | null } = {},
): Promise<WebhookSlot> {
  try {
    const { claimedStages, claimReminder, recentInvoiceNotice, rentTextedToday } = await import("@/lib/rent-reminders.server");
    const { easternDateOf, easternParts, webhookLedgerStage, STAGE_SWITCH } = await import("@/lib/rent-reminders");
    const dueDate = Number.isFinite(Number(invoice?.created)) && invoice?.created ? easternDateOf(Number(invoice.created)) : easternParts(now).date;
    const sent = await claimedStages(admin, rentalId, dueDate, channel);
    if (!sent) return { kind: "legacy" };
    // A text about this same invoice already went out today (e.g. a staff text
    // with the invoice link): not a second one the same day.
    let priorNoticeOn: string | null = null;
    if (channel === "sms") {
      const prior = await recentInvoiceNotice(admin, {
        rentalId, phone: opts.phone ?? null, mode: "stripe",
        invoiceId: typeof invoice?.id === "string" ? invoice.id : null,
        invoiceUrl: typeof invoice?.hosted_invoice_url === "string" ? invoice.hosted_invoice_url : null,
      }, now);
      if (prior !== "unavailable") priorNoticeOn = prior;
      // One rent text per renter per day: a newer invoice failing after today's
      // reminder waits for tomorrow's (which lists it with its own link).
      const texted = await rentTextedToday(admin, rentalId, opts.phone ?? null, now);
      if (texted === "unavailable" || texted) return { kind: "taken" };
    }
    const ledgerStage = webhookLedgerStage(sent, now, priorNoticeOn, { onePerDay: channel === "sms" });
    if (!ledgerStage) return { kind: "taken" };
    const claim = await claimReminder(admin, { rentalId, dueDate, stage: ledgerStage, channel, source: "webhook", at: now });
    if (claim === "taken") return { kind: "taken" };
    if (claim === "unavailable") return { kind: "legacy" };
    const stageKey = ledgerStage === "overdue" ? STAGE_SWITCH.overdue : STAGE_SWITCH.daily;
    const useReminderTemplate = gateFor(await loadAutomationControls(admin), stageKey) === "send";
    return { kind: "claimed", dueDate, ledgerStage, useReminderTemplate };
  } catch {
    return { kind: "legacy" };
  }
}

/** The editable Overdue/Daily reminder text for a failed invoice (with the late fee), or null. */
export async function renderWebhookReminder(
  admin: any,
  slot: Extract<WebhookSlot, { kind: "claimed" }>,
  input: { invoice: any; amount: number; rentalId: string; applicationId: string | null; firstName: string | null; phone: string | null },
  link: string,
  now: Date,
) {
  try {
    const { loadReminderTemplates } = await import("@/lib/rent-reminders.server");
    const { renderReminder } = await import("@/lib/rent-reminders");
    const templates = await loadReminderTemplates(admin);
    const w = await admin.from("rent_late_fee_waivers").select("due_date, waived_through").eq("rental_id", input.rentalId);
    return renderReminder(templates, slot.ledgerStage === "overdue" ? "overdue" : "daily", {
      rentalId: input.rentalId, applicationId: input.applicationId, firstName: input.firstName, phone: input.phone, email: null,
      weeklyRate: input.amount, mode: "stripe", dueDate: slot.dueDate, owing: true, rentOwed: input.amount, invoiceUrl: link,
      invoiceId: typeof input.invoice?.id === "string" ? input.invoice.id : null,
      waivers: (w.error ? [] : w.data ?? []).map((x: any) => ({ dueDate: x.due_date, waivedThrough: x.waived_through ?? null })),
    }, now);
  } catch {
    return null;
  }
}
