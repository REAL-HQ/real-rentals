// The single rent-reminder scheduler. Runs hourly from /api/public/cron/rent-reminders.
// Every stage is a Back Office → Automations switch, all OFF by default; with
// every stage off this returns before reading anything else or calling Stripe.
//
// Per active rental: work out what is owed (Stripe: from Stripe itself, since
// the rental's own dates can be stale; manual payers: next_payment_due and the
// payments recorded against it), pick the one stage owed now, claim it in
// rent_reminder_log (unique per rental + due date + stage + channel), then
// text and email. A claim that already exists means it was sent: skip.
import { gateFor, loadAutomationControls } from "@/lib/automation-controls.server";
import {
  DEFAULT_TEMPLATES,
  RENT_REMINDER_SWITCHES,
  STAGE_SWITCH,
  STAGE_WORKFLOW,
  PRIOR_NOTICE_DAYS,
  decideStage,
  easternDateOf,
  easternParts,
  manualOwed,
  mergeTemplates,
  parseTs,
  renderReminder,
  withinQuietHoursAllowed,
  type ClaimMap,
  type LateFeeWaiver,
  type RentReminderTemplates,
  type RentalBillingState,
} from "@/lib/rent-reminders";
import { isHostedInvoiceUrl } from "@/lib/failed-payment-link";

export const RENT_REMINDER_TEMPLATES_KEY = "rent_reminder_templates";

export type StripeBillingSnapshot = {
  /** Next automatic charge, ET date. */
  nextChargeOn: string | null;
  /** Open invoices Stripe already tried to charge (failed), oldest first. */
  failedInvoices: { id: string; hostedUrl: string | null; amountDue: number; createdOn: string; createdAt?: number | null }[];
};

export type ReminderDeps = {
  now?: Date;
  stripeSnapshot?: (subscriptionId: string) => Promise<StripeBillingSnapshot | null>;
  sendSms?: (a: any) => Promise<{ ok: boolean; skipped?: boolean; reason?: string; error?: string }>;
  sendEmail?: (a: { to: string; subject: string; text: string; link: string | null; linkLabel: string | null; workflow: string }) => Promise<{ ok: boolean; blocked?: string; error?: string }>;
};

export type ReminderRun = {
  ran: boolean;
  reason?: string;
  examined: number;
  sms: number;
  email: number;
  skipped: Record<string, number>;
};

function bump(run: ReminderRun, reason: string) {
  run.skipped[reason] = (run.skipped[reason] ?? 0) + 1;
}

export async function loadReminderTemplates(admin: any): Promise<RentReminderTemplates> {
  try {
    const { data } = await admin.from("app_settings").select("value").eq("key", RENT_REMINDER_TEMPLATES_KEY).maybeSingle();
    return mergeTemplates(data?.value);
  } catch {
    return DEFAULT_TEMPLATES;
  }
}

/** Read Stripe for one subscription: next charge date and failed open invoices. */
export async function liveStripeSnapshot(subscriptionId: string): Promise<StripeBillingSnapshot | null> {
  const { createStripeClient } = await import("@/lib/stripe.server");
  const env = process.env.RENT_REMINDER_STRIPE_ENV === "sandbox" ? "sandbox" : "live";
  const stripe: any = createStripeClient(env, { timeout: 8000 });
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  if (!sub || sub.status === "canceled") return null;
  const periodEnd = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end ?? null;
  const invoices = await stripe.invoices.list({ subscription: subscriptionId, status: "open", limit: 10 });
  const failed = (invoices.data ?? [])
    .filter((i: any) => Number(i.attempt_count ?? 0) > 0 && Number(i.amount_due ?? 0) > 0)
    .map((i: any) => ({ id: i.id, hostedUrl: i.hosted_invoice_url ?? null, amountDue: Number(i.amount_due) / 100, createdOn: easternDateOf(i.created), createdAt: Number(i.created) || null }))
    .sort((a: any, b: any) => (a.createdOn < b.createdOn ? -1 : 1));
  return { nextChargeOn: periodEnd ? easternDateOf(periodEnd) : null, failedInvoices: failed };
}

/**
 * Ledger claims for a rental + due date + channel: stage -> ET date claimed.
 * Null when the ledger cannot be read (callers then send nothing new).
 */
export async function claimedStages(admin: any, rentalId: string, dueDate: string, channel: "sms" | "email"): Promise<ClaimMap | null> {
  const res = await admin.from("rent_reminder_log").select("stage, created_at").eq("rental_id", rentalId).eq("due_date", dueDate).eq("channel", channel);
  if (res.error) return null;
  const out: ClaimMap = new Map();
  for (const r of res.data ?? []) {
    const ms = parseTs(r.created_at);
    out.set(String(r.stage), ms != null ? easternParts(new Date(ms)).date : "0000-01-01");
  }
  return out;
}

/**
 * ET date of the latest text in the last PRIOR_NOTICE_DAYS that already told
 * this renter about this week: for a Stripe renter, any outbound text naming
 * the failed invoice (Payment Failed Text, or a staff text with the invoice
 * link); for a manual payer, an earlier overdue/daily notice. Null = none;
 * "unavailable" = could not read (callers hold the overdue notice).
 */
export async function recentInvoiceNotice(
  admin: any,
  s: { rentalId: string; phone?: string | null; mode: "stripe" | "manual"; invoiceId?: string | null; invoiceUrl?: string | null },
  now: Date,
): Promise<string | null | "unavailable"> {
  const since = now.getTime() - PRIOR_NOTICE_DAYS * 86400000;
  const rows = await renterTexts(admin, s.rentalId, s.phone ?? null);
  if (rows === "unavailable") return "unavailable";
  let latest: number | null = null;
  for (const r of rows) {
    const at = parseTs(r.created_at);
    if (at == null || at < since || at > now.getTime()) continue;
    if ((r.channel ?? "sms") !== "sms") continue;
    if (!["sent", "queued", "delivered"].includes(String(r.status ?? ""))) continue;
    const body = String(r.body ?? "");
    const kind = String(r.kind ?? "");
    const about = s.mode === "stripe"
      ? Boolean((s.invoiceUrl && body.includes(s.invoiceUrl.trim())) || (s.invoiceId && body.includes(s.invoiceId)))
      : /^rent_reminder_(overdue|daily)$/.test(kind);
    if (about && (latest == null || at > latest)) latest = at;
  }
  return latest == null ? null : easternParts(new Date(latest)).date;
}

async function renterTexts(admin: any, rentalId: string, phoneRaw: string | null): Promise<any[] | "unavailable"> {
  const rows: any[] = [];
  const byRental = await admin.from("outbound_messages").select("created_at, body, kind, status, channel").eq("rental_id", rentalId);
  if (byRental.error) return "unavailable";
  rows.push(...(byRental.data ?? []));
  const { toE164 } = await import("@/lib/sms.server");
  const phone = toE164(phoneRaw);
  if (phone) {
    const byPhone = await admin.from("outbound_messages").select("created_at, body, kind, status, channel").eq("to_address", phone);
    if (byPhone.error) return "unavailable";
    rows.push(...(byPhone.data ?? []));
  }
  return rows;
}

/**
 * At most one rent text per renter per ET day, across all their invoices: true
 * when a payment-failed / rent reminder text (or any text with an invoice link)
 * already went out today. "unavailable" = could not read (callers hold the text).
 */
export async function rentTextedToday(admin: any, rentalId: string, phone: string | null, now: Date): Promise<boolean | "unavailable"> {
  const rows = await renterTexts(admin, rentalId, phone);
  if (rows === "unavailable") return "unavailable";
  const today = easternParts(now).date;
  return rows.some((r) => {
    const at = parseTs(r.created_at);
    if (at == null || at > now.getTime() || easternParts(new Date(at)).date !== today) return false;
    if ((r.channel ?? "sms") !== "sms") return false;
    if (!["sent", "queued", "delivered"].includes(String(r.status ?? ""))) return false;
    const kind = String(r.kind ?? "");
    return kind === "payment_failed" || kind.startsWith("rent_reminder_") || String(r.body ?? "").includes("invoice.stripe.com/");
  });
}

/** Claim one send. True only for the caller that inserted the row. */
export async function claimReminder(
  admin: any,
  row: { rentalId: string; dueDate: string; stage: string; channel: "sms" | "email"; source: "scheduler" | "webhook"; at?: Date },
): Promise<"claimed" | "taken" | "unavailable"> {
  const res = await admin.from("rent_reminder_log").insert({
    rental_id: row.rentalId, due_date: row.dueDate, stage: row.stage, channel: row.channel, source: row.source,
    ...(row.at ? { created_at: row.at.toISOString() } : {}),
  });
  if (!res.error) return "claimed";
  if (res.error.code === "23505") return "taken";
  return "unavailable";
}

async function finish(admin: any, row: { rentalId: string; dueDate: string; stage: string; channel: string }, outcome: string, detail?: string) {
  await admin.from("rent_reminder_log").update({ outcome, detail: detail?.slice(0, 500) ?? null })
    .eq("rental_id", row.rentalId).eq("due_date", row.dueDate).eq("stage", row.stage).eq("channel", row.channel)
    .then(() => {}, () => {});
}

/** Build each active rental's billing state. Stripe state comes from Stripe. */
export async function loadBillingStates(admin: any, deps: ReminderDeps, today: string): Promise<{ states: RentalBillingState[]; errors: number }> {
  const rentals = await admin.from("rentals")
    .select("id, application_id, status, weekly_rate, next_payment_due, stripe_subscription_id, stripe_customer_id")
    .eq("status", "active");
  if (rentals.error) throw new Error(rentals.error.message);
  const list: any[] = rentals.data ?? [];
  const appIds = [...new Set(list.map((r) => r.application_id).filter(Boolean))];
  const apps = appIds.length ? await admin.from("applications").select("id, full_name, phone, email").in("id", appIds) : { data: [] };
  const appById = new Map<string, any>((apps.data ?? []).map((a: any) => [a.id, a]));
  const ids = list.map((r) => r.id);
  const waiverRes = ids.length ? await admin.from("rent_late_fee_waivers").select("rental_id, due_date, waived_through").in("rental_id", ids) : { data: [] };
  const waiversBy = new Map<string, LateFeeWaiver[]>();
  for (const w of waiverRes.error ? [] : waiverRes.data ?? []) {
    const arr = waiversBy.get(w.rental_id) ?? [];
    arr.push({ dueDate: w.due_date, waivedThrough: w.waived_through ?? null });
    waiversBy.set(w.rental_id, arr);
  }
  const stripeSnap = deps.stripeSnapshot ?? liveStripeSnapshot;
  const states: RentalBillingState[] = [];
  let errors = 0;
  for (const r of list) {
    const app = appById.get(r.application_id) ?? {};
    const base = {
      rentalId: r.id, applicationId: r.application_id ?? null, firstName: app.full_name ?? null,
      phone: app.phone ?? null, email: app.email ?? null, weeklyRate: Number(r.weekly_rate ?? 0),
      waivers: waiversBy.get(r.id) ?? [],
    };
    if (r.stripe_subscription_id) {
      let snap: StripeBillingSnapshot | null = null;
      try { snap = await stripeSnap(r.stripe_subscription_id); } catch { errors++; continue; }
      if (!snap) continue; // canceled: nothing to remind about
      const failed = snap.failedInvoices[0];
      if (failed) {
        // {{amount}} is the linked invoice's own amount; newer open invoices are listed separately.
        states.push({
          ...base, mode: "stripe", dueDate: failed.createdOn, owing: true, rentOwed: Math.round(failed.amountDue * 100) / 100,
          invoiceUrl: failed.hostedUrl, invoiceId: failed.id, invoiceCreatedAt: failed.createdAt ?? null,
          otherInvoices: snap.failedInvoices.slice(1).map((i) => ({ url: i.hostedUrl, amount: i.amountDue, createdOn: i.createdOn })),
        });
      } else {
        states.push({
          ...base, mode: "stripe", dueDate: snap.nextChargeOn, owing: false, rentOwed: 0,
          stripeCustomerId: (r.stripe_customer_id as string | null) ?? null,
          stripeSubscriptionId: r.stripe_subscription_id as string,
        });
      }
    } else {
      const due = (r.next_payment_due as string | null) ?? null;
      let paid = 0;
      if (due) {
        const p = await admin.from("payments").select("amount, status, type").eq("rental_id", r.id).eq("due_date", due).eq("status", "paid");
        if (p.error) { errors++; continue; }
        paid = (p.data ?? []).filter((x: any) => (x.type ?? "rent") === "rent").reduce((s: number, x: any) => s + Number(x.amount ?? 0), 0);
      }
      const owed = manualOwed({ dueDate: due, today, weeklyRate: base.weeklyRate, paidTowardDue: paid });
      states.push({ ...base, mode: "manual", dueDate: due, owing: owed.owing, rentOwed: owed.rentOwed });
    }
  }
  return { states, errors };
}

export async function runRentReminders(admin: any, deps: ReminderDeps = {}): Promise<ReminderRun> {
  const run: ReminderRun = { ran: false, examined: 0, sms: 0, email: 0, skipped: {} };
  const controls = await loadAutomationControls(admin);
  if (controls.status === "error") return { ...run, reason: "settings_unreadable" };
  const gates = Object.fromEntries(RENT_REMINDER_SWITCHES.map((k) => [k, gateFor(controls, k)]));
  if (!Object.values(gates).some((g) => g === "send")) return { ...run, reason: "all_off" };

  const now = deps.now ?? new Date();
  const { date: today, hour } = easternParts(now);
  const templates = await loadReminderTemplates(admin);
  const { states, errors } = await loadBillingStates(admin, deps, today);
  if (errors) run.skipped.read_error = errors;
  run.ran = true;

  const sendSms = deps.sendSms ?? (async (a: any) => (await import("@/lib/sms.server")).sendSms(a) as any);
  const sendMail = deps.sendEmail ?? (async (a: any) => (await import("@/lib/email.server")).sendRentReminderEmail(a));
  const smsFrom = process.env.RENT_REMINDER_SMS_FROM?.trim() || process.env.PAYMENT_FAILED_SMS_FROM?.trim() || null;
  // Overdue is only sent for failures after its switch went on (no catch-up blast).
  const overdueEnabledAt = gates[STAGE_SWITCH.overdue] === "send" ? (controls.value?.on?.[STAGE_SWITCH.overdue]?.at ?? null) : undefined;

  for (const s of states) {
    run.examined++;
    if (!s.dueDate) { bump(run, "no_due_date"); continue; }
    let priorNoticeOn: string | null = null;
    if (s.owing) {
      const prior = await recentInvoiceNotice(admin, s, now);
      if (prior === "unavailable") { bump(run, "outbound_unavailable"); continue; }
      priorNoticeOn = prior;
    }
    for (const channel of ["sms", "email"] as const) {
      const sent = await claimedStages(admin, s.rentalId, s.dueDate, channel);
      if (!sent) { bump(run, "ledger_unavailable"); continue; }
      const d = decideStage(s, now, sent, { overdueEnabledAt, priorNoticeOn });
      if (!d.send) { bump(run, d.reason); continue; }
      if (gates[STAGE_SWITCH[d.stage]] !== "send") { bump(run, "stage_off"); continue; }
      if (channel === "sms" && !withinQuietHoursAllowed(hour)) { bump(run, "quiet_hours"); continue; }
      if (channel === "sms" && !s.phone) { bump(run, "no_phone"); continue; }
      if (channel === "email" && !s.email) { bump(run, "no_email"); continue; }
      if (channel === "sms") {
        const texted = await rentTextedToday(admin, s.rentalId, s.phone, now);
        if (texted === "unavailable") { bump(run, "outbound_unavailable"); continue; }
        if (texted) { bump(run, "texted_today"); continue; }
      }

      const state = s;
      const msg = renderReminder(templates, d.stage, state, now);
      if (!msg) { bump(run, "no_safe_link"); continue; }
      if (state.mode === "stripe" && d.stage !== "due_tomorrow" && !isHostedInvoiceUrl(msg.link)) { bump(run, "no_safe_link"); continue; }
      // The autopay heads-up never carries a link of any kind.
      if (state.mode === "stripe" && d.stage === "due_tomorrow" && (msg.link || /https?:\/\//i.test(`${msg.sms} ${msg.email}`))) { bump(run, "no_safe_link"); continue; }

      const key = { rentalId: s.rentalId, dueDate: d.dueDate, stage: d.ledgerStage, channel };
      const claim = await claimReminder(admin, { ...key, source: "scheduler", at: now });
      if (claim !== "claimed") { bump(run, claim === "taken" ? "already_sent" : "ledger_unavailable"); continue; }
      try {
        if (channel === "sms") {
          const res = await sendSms({
            to: s.phone!, body: msg.sms, kind: `rent_reminder_${d.stage}`, applicationId: s.applicationId, rentalId: s.rentalId,
            requireConsent: false, fromId: smsFrom, noticeTimeout: true,
          });
          await finish(admin, key, res.ok ? "sent" : `skipped:${res.reason ?? res.error ?? "unknown"}`);
          if (res.ok) run.sms++; else bump(run, `sms_${res.reason ?? "failed"}`);
        } else {
          const res = await sendMail({ to: s.email!, subject: msg.subject, text: msg.email, link: msg.link, linkLabel: msg.linkLabel, workflow: STAGE_WORKFLOW[d.stage] });
          await finish(admin, key, res.ok ? "sent" : `skipped:${res.blocked ?? res.error ?? "unknown"}`);
          if (res.ok) run.email++; else bump(run, "email_not_sent");
        }
      } catch (err) {
        await finish(admin, key, "error", String((err as Error)?.message ?? err));
        bump(run, "send_error");
      }
    }
  }
  return run;
}

// ------------------------------------------------------------------ staff actions

export type RecordPaymentInput = {
  rentalId: string;
  amount: number;
  method: string;
  reference: string | null;
  paidOn: string; // YYYY-MM-DD
};

/**
 * Record a manual (Cash App / Venmo / Zelle / Cash / Other) rent payment.
 * Refused for Stripe renters: their rent is collected by their subscription.
 * Once the due week is covered, next_payment_due moves forward a week, which
 * stops that week's reminders. Sends nothing.
 */
export async function recordManualRentPayment(admin: any, input: RecordPaymentInput): Promise<{ paymentId: string; covered: boolean; nextDue: string | null }> {
  const { MANUAL_METHODS, addDaysIso, paymentCoversWeek } = await import("@/lib/rent-reminders");
  if (!(input.amount > 0) || input.amount > 10000) throw new Error("Enter An Amount Between $0.01 And $10,000.");
  if (!MANUAL_METHODS.some((m) => m.value === input.method)) throw new Error("Choose A Payment Method.");
  const r = await admin.from("rentals")
    .select("id, application_id, vehicle_id, status, weekly_rate, next_payment_due, stripe_subscription_id")
    .eq("id", input.rentalId).maybeSingle();
  if (r.error || !r.data) throw new Error("Rental not found.");
  const rental = r.data;
  if (rental.stripe_subscription_id) throw new Error("This renter pays by Stripe autopay. Their payments are recorded from Stripe.");
  if (rental.status !== "active") throw new Error("Only active rentals can take a payment here.");
  const due: string | null = rental.next_payment_due ?? null;
  const ins = await admin.from("payments").insert({
    type: "rent", status: "paid", amount: Math.round(input.amount * 100) / 100, paid_date: input.paidOn,
    due_date: due ?? input.paidOn, payment_method: input.method, notes: input.reference?.slice(0, 200) || null,
    rental_id: rental.id, driver_id: rental.application_id, vehicle_id: rental.vehicle_id, balance_due: 0,
    notified_status: "paid",
  }).select("id").single();
  if (ins.error || !ins.data) throw new Error("Could not record the payment. Nothing was changed.");
  let covered = false;
  let nextDue = due;
  if (due) {
    const p = await admin.from("payments").select("amount, type").eq("rental_id", rental.id).eq("due_date", due).eq("status", "paid");
    const paid = (p.data ?? []).filter((x: any) => (x.type ?? "rent") === "rent").reduce((s: number, x: any) => s + Number(x.amount ?? 0), 0);
    covered = paymentCoversWeek(paid, Number(rental.weekly_rate ?? 0));
    if (covered) {
      nextDue = addDaysIso(due, 7);
      const u = await admin.from("rentals").update({ next_payment_due: nextDue, payment_status: "current" }).eq("id", rental.id);
      if (u.error) throw new Error("Payment saved, but the next due date could not be moved. Please refresh and check.");
    }
  }
  return { paymentId: ins.data.id, covered, nextDue };
}

/** Waive the late fee for a rental's current due week (whole week, or through a date). Sends nothing. */
export async function waiveRentLateFee(
  admin: any,
  input: { rentalId: string; dueDate: string; waivedThrough: string | null; reason: string; amountWaived: number | null },
  actor: { userId: string; email: string | null },
): Promise<{ id: string }> {
  if (!input.reason.trim()) throw new Error("A Reason Is Required.");
  if (input.waivedThrough && input.waivedThrough < input.dueDate) throw new Error("Waive Through must be on or after the due date.");
  const row = {
    rental_id: input.rentalId, due_date: input.dueDate, waived_through: input.waivedThrough,
    amount_waived: input.amountWaived, reason: input.reason.trim().slice(0, 500),
    waived_by: actor.userId, waived_by_email: actor.email,
  };
  const res = await admin.from("rent_late_fee_waivers").upsert(row, { onConflict: "rental_id,due_date" }).select("id").single();
  if (res.error || !res.data) throw new Error("Could not save the waiver. Nothing was changed.");
  return { id: res.data.id };
}
