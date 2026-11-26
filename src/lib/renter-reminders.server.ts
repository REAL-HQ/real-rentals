/**
 * Pickup reminders and unsigned-agreement texts (Dolmar, t298s1611).
 *
 * Run by /api/public/cron/renter-reminders every 5 minutes. Two switches in
 * Back Office -> Automations, both OFF until an Owner turns them on:
 *
 *  pickup_reminders       reserved rentals with a pickup time:
 *                           "booked"   within 12 hours of the booking
 *                           "evening"  6-9 PM ET the evening before pickup
 *                           "two_hour" 2 hours to 1 hour before pickup
 *  agreement_sign_texts   agreements still sent/viewed (not signed, voided
 *                         or expired):
 *                           "four_hour" 4-6 hours after it was sent
 *                           "morning"   9-11 AM ET the day after it was sent
 *
 * Texts go from the default REAL Rentals line, (888) 833-8280, through
 * sendSms, which refuses anyone without SMS consent or who replied STOP.
 * When the text is refused for consent, the same reminder goes by email
 * (except "booked": the booking email already carries those details).
 * No text goes out before 8 AM or after 9 PM ET; a step whose window has
 * passed is skipped, never sent late.
 *
 * Each step is claimed once in renter_reminder_sends (key primary key)
 * before anything is sent. No table, nothing sent.
 */
import { slotIso, zoneDate, PICKUP_TIMEZONE } from "@/lib/pickup-schedule";
import { readReservationDetails } from "@/lib/reservations";
import { tableMissing } from "@/lib/fleet-api.server";

type Admin = any;

export const PICKUP_REMINDERS_KEY = "pickup_reminders";
export const AGREEMENT_TEXTS_KEY = "agreement_sign_texts";
export const DEFAULT_PICKUP_ADDRESS = "3500 E Hillsborough Ave, Tampa, FL 33610";
const PHONE = "(888) 833-8280";
const TZ = PICKUP_TIMEZONE;

export type PickupStep = "booked" | "evening" | "two_hour";
export type AgreementStep = "four_hour" | "morning";

export type ReminderDeps = {
  now?: () => Date;
  sendSms?: (a: { to: string; body: string; kind: string; applicationId: string; rentalId?: string | null; requireConsent?: boolean }) => Promise<any>;
  sendEmail?: (a: { to: string; subject: string; html: string; track: { workflow: string }; idempotencyKey: string }) => Promise<any>;
  gates?: { pickup: "send" | "off" | "held"; agreement: "send" | "off" | "held" };
  dryRun?: boolean;
};

/** Minutes since midnight in ET plus the ET date. */
function etClock(at: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { date: zoneDate(at, TZ).date, minutes: h * 60 + m };
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function textingHours(at: Date): boolean {
  const { minutes } = etClock(at);
  return minutes >= 8 * 60 && minutes < 21 * 60;
}

/** "Wed 11/18" */
export function dayLabel(date: string): string {
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${date}T12:00:00Z`).getUTCDay()];
  const [, mo, d] = date.split("-").map(Number);
  return `${wd} ${mo}/${d}`;
}

/** "9:30 AM" */
export function timeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Which pickup step is due now, if any. */
export function duePickupStep(r: { start_date: string; pickupTime: string; created_at: string }, now: Date): PickupStep[] {
  const start = new Date(slotIso(r.start_date, r.pickupTime, TZ)).getTime();
  const t = now.getTime();
  const created = new Date(r.created_at).getTime();
  if (t >= start) return [];
  const due: PickupStep[] = [];
  const { date, minutes } = etClock(now);
  if (t - created <= 12 * 3600_000 && start - t > 2 * 3600_000) due.push("booked");
  if (addDays(date, 1) === r.start_date && minutes >= 18 * 60 && minutes < 21 * 60 && t - created >= 2 * 3600_000) due.push("evening");
  if (start - t <= 2 * 3600_000 && start - t > 3600_000) due.push("two_hour");
  return due;
}

/** Which agreement step is due now, if any. */
export function dueAgreementStep(a: { sent_at: string }, now: Date): AgreementStep[] {
  const sent = new Date(a.sent_at).getTime();
  const t = now.getTime();
  const due: AgreementStep[] = [];
  const { date, minutes } = etClock(now);
  // 4 to 6 hours after sending, inside texting hours; missed overnight, the morning text covers it.
  if (t - sent >= 4 * 3600_000 && t - sent < 6 * 3600_000 && textingHours(now)) due.push("four_hour");
  if (addDays(zoneDate(new Date(sent), TZ).date, 1) === date && minutes >= 9 * 60 && minutes < 11 * 60 && t - sent >= 4 * 3600_000) due.push("morning");
  return due.includes("morning") ? ["morning"] : due;
}

export type PickupFacts = { firstName: string; date: string; time: string; location: string; vehicle: string | null };

export function pickupSms(step: PickupStep, f: PickupFacts): string {
  const when = `${dayLabel(f.date)} ${timeLabel(f.time)} ET`;
  if (step === "booked") {
    return `Real Rentals: You're booked, ${f.firstName}! Pickup is ${when} at ${f.location}${f.vehicle ? ` for your ${f.vehicle}` : ""}. Bring your driver's license. Need to change it? Reply here or call ${PHONE}. Reply STOP to opt out.`;
  }
  if (step === "evening") {
    return `Real Rentals: Reminder, your pickup is tomorrow, ${when}, at ${f.location}. Bring your driver's license. Need to change it? Reply here or call ${PHONE}. Reply STOP to opt out.`;
  }
  return `Real Rentals: See you today at ${timeLabel(f.time)} ET at ${f.location}. Bring your driver's license. If anything changes, reply here or call ${PHONE}. Reply STOP to opt out.`;
}

export function agreementSms(step: AgreementStep): string {
  if (step === "four_hour") {
    return `Real Rentals: Your rental agreement is ready to sign. Open the signing link we sent you by text and email to finish. Need a new link? Reply here or call ${PHONE}. Reply STOP to opt out.`;
  }
  return `Real Rentals: Good morning! Your rental agreement is still waiting for your signature. Sign it from the link we sent you so we can get you on the road. Need a new link? Reply here or call ${PHONE}. Reply STOP to opt out.`;
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function emailShell(title: string, body: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px">
  <h1 style="font-size:20px;color:#111">${esc(title)}</h1>
  ${body}
  <p style="color:#888;font-size:12px;margin-top:20px">Questions? Reply to this email or call ${PHONE}.</p>
</div>`;
}

export function pickupEmail(step: Exclude<PickupStep, "booked">, f: PickupFacts): { subject: string; html: string } {
  const when = `${dayLabel(f.date)}, ${timeLabel(f.time)} ET`;
  const p = (t: string) => `<p style="color:#444;font-size:15px;line-height:1.55">${t}</p>`;
  const details = p(`<strong>Pickup:</strong> ${esc(when)}<br><strong>Location:</strong> ${esc(f.location)}${f.vehicle ? `<br><strong>Vehicle:</strong> ${esc(f.vehicle)}` : ""}`);
  if (step === "evening") {
    return {
      subject: "Reminder: Your REAL RENTALS Pickup Is Tomorrow",
      html: emailShell("Your pickup is tomorrow", p(`Hi ${esc(f.firstName)}, this is a reminder about your pickup tomorrow.`) + details + p("Bring your driver's license. Need to change it? Reply to this email or call us.")),
    };
  }
  return {
    subject: "Your REAL RENTALS Pickup Is Today",
    html: emailShell("See you soon", p(`Hi ${esc(f.firstName)}, your pickup is in about 2 hours.`) + details + p("Bring your driver's license. If anything changes, reply to this email or call us.")),
  };
}

export function agreementEmail(step: AgreementStep, firstName: string): { subject: string; html: string } {
  const p = (t: string) => `<p style="color:#444;font-size:15px;line-height:1.55">${t}</p>`;
  if (step === "four_hour") {
    return {
      subject: "Your REAL RENTALS Agreement Is Ready To Sign",
      html: emailShell("Your rental agreement is ready", p(`Hi ${esc(firstName)}, your rental agreement is ready to sign. Open the signing link in the email we sent you to finish.`) + p("Need a new link? Reply to this email and our team will send one.")),
    };
  }
  return {
    subject: "Reminder: Your REAL RENTALS Agreement Is Waiting",
    html: emailShell("Your Rental Agreement Is Still Waiting", p(`Hi ${esc(firstName)}, your rental agreement still needs your signature before we can hand over the keys. Open the signing link in the email we sent you to sign.`) + p("Need a new link? Reply to this email and our team will send one.")),
  };
}

function firstNameOf(full: unknown): string {
  return String(full ?? "").trim().split(/\s+/)[0] || "there";
}

/** Claim a step. true = ours to send; false = already claimed; null = no table. */
async function claim(admin: Admin, row: Record<string, unknown>): Promise<boolean | null> {
  const { error } = await admin.from("renter_reminder_sends").insert(row);
  if (!error) return true;
  if (tableMissing(error, "renter_reminder_sends")) return null;
  if (String(error.code) === "23505" || /duplicate key/i.test(String(error.message))) return false;
  throw new Error(String(error.message));
}

async function finish(admin: Admin, key: string, channel: string, status: string, detail: string | null): Promise<void> {
  await admin.from("renter_reminder_sends").update({ channel, status, detail }).eq("key", key);
}

export type ReminderOutcome = { key: string; kind: string; channel: "sms" | "email" | "none"; status: string; body?: string };

/** Send one claimed reminder: text first, email when the text is refused for consent. */
async function deliver(
  admin: Admin,
  deps: Required<Pick<ReminderDeps, "sendSms" | "sendEmail">>,
  key: string,
  kind: string,
  app: { id: string; phone: string | null; email: string | null },
  sms: string,
  email: { subject: string; html: string; workflow: string } | null,
  rentalId: string | null,
): Promise<ReminderOutcome> {
  const { sendRenterSms, sendRenterEmail, renterEmailTargets } = await import("@/lib/driver-contacts.server");
  const fan = await sendRenterSms({
    admin, applicationId: app.id, body: sms, kind, rentalId, sendSms: deps.sendSms, app,
  });
  const res = fan.results.find((r) => r?.ok) ?? fan.results[0] ?? { ok: false, skipped: true, reason: "no_phone" };
  if (fan.sent > 0) {
    await finish(admin, key, "sms", "sent", null);
    return { key, kind, channel: "sms", status: "sent", body: sms };
  }
  const consentReasons = ["no_consent", "no_consent_for_number", "opted_out", "invalid_phone", "no_phone", "not_enabled"];
  const consentRefusal = fan.targets.every((t) => !t.canText) || (res?.skipped && consentReasons.includes(String(res.reason)));
  if (!consentRefusal) {
    await finish(admin, key, "sms", "failed", String(res?.error ?? res?.reason ?? "send failed").slice(0, 300));
    return { key, kind, channel: "sms", status: "failed" };
  }
  const emails = email ? await renterEmailTargets(admin, app.id, app) : [];
  if (!email || !emails.length) {
    await finish(admin, key, "none", "skipped", `text not allowed (${res.reason ?? "no_phone"}); no email fallback`);
    return { key, kind, channel: "none", status: "skipped" };
  }
  const mail = await sendRenterEmail({
    admin, applicationId: app.id, subject: email.subject, html: email.html,
    track: { workflow: email.workflow }, idempotencyKey: `renter-reminder:${key}`,
    sendEmail: deps.sendEmail, app,
  });
  const er = mail.results.find((r) => r?.ok) ?? mail.results[0] ?? {};
  const status = er?.ok ? "sent" : er?.blocked ? `blocked:${er.blocked}` : "failed";
  await finish(admin, key, "email", status, er?.ok ? null : String(er?.error ?? "send failed").slice(0, 300));
  return { key, kind, channel: "email", status };
}

/** Pickup texts also go to approved additional drivers who consented. Rent and payment texts do not. */
async function copyVehicleNotice(
  admin: Admin,
  send: { sendSms: ReminderDeps["sendSms"] },
  args: { key: string; kind: string; sms: string; applicationId: string; rentalId: string },
): Promise<ReminderOutcome[]> {
  if (!send.sendSms) return [];
  const { consentedAdditionalDriverPhones } = await import("@/lib/additional-drivers.server");
  const drivers = await consentedAdditionalDriverPhones(admin, { rentalId: args.rentalId, applicationId: args.applicationId });
  const outcomes: ReminderOutcome[] = [];
  for (const driver of drivers) {
    const key = `${args.key}:driver:${driver.id}`;
    const claimed = await claim(admin, { key, kind: args.kind, application_id: args.applicationId, rental_id: args.rentalId, status: "claimed" });
    if (claimed === null) return outcomes;
    if (!claimed) continue;
    const result = await send.sendSms({ to: driver.phone, body: args.sms, kind: args.kind, applicationId: args.applicationId, rentalId: args.rentalId, requireConsent: false });
    const status = result.ok ? "sent" : result.skipped ? `skipped:${result.reason}` : "failed";
    await finish(admin, key, "sms", status, result.ok ? null : String(("error" in result ? result.error : result.reason) ?? "").slice(0, 300));
    outcomes.push({ key, kind: args.kind, channel: "sms", status, body: args.sms });
  }
  return outcomes;
}

/** Each unsigned additional driver gets their own signing reminder. It does not include a new link. */
async function remindUnsignedAdditionalDrivers(
  admin: Admin,
  send: { sendSms: ReminderDeps["sendSms"] },
  args: { agreementId: string; applicationId: string; rentalId: string | null; step: string; sms: string },
): Promise<ReminderOutcome[]> {
  if (!send.sendSms) return [];
  const { data: recipients } = await admin.from("esign_recipients").select("id,email,status,role").eq("document_id", args.agreementId).eq("role", "signer");
  const openEmails = new Set((recipients ?? []).filter((r: { status?: string; email?: string }) => r.status !== "signed" && r.email).map((r: { email: string }) => r.email.trim().toLowerCase()));
  const { consentedAdditionalDriverPhones } = await import("@/lib/additional-drivers.server");
  const drivers = await consentedAdditionalDriverPhones(admin, { applicationId: args.applicationId, rentalId: args.rentalId });
  const outcomes: ReminderOutcome[] = [];
  for (const driver of drivers) {
    const { data: row } = await admin.from("rental_additional_drivers").select("email").eq("id", driver.id).maybeSingle();
    const email = String(row?.email ?? "").trim().toLowerCase();
    if (!email || !openEmails.has(email)) continue;
    const key = `agreement:${args.agreementId}:${args.step}:driver:${driver.id}`;
    const kind = `agreement_sign_${args.step}`;
    const claimed = await claim(admin, { key, kind, application_id: args.applicationId, rental_id: args.rentalId, agreement_id: args.agreementId, status: "claimed" });
    if (claimed === null) return outcomes;
    if (!claimed) continue;
    const result = await send.sendSms({ to: driver.phone, body: args.sms, kind, applicationId: args.applicationId, rentalId: args.rentalId, requireConsent: false });
    const status = result.ok ? "sent" : result.skipped ? `skipped:${result.reason}` : "failed";
    await finish(admin, key, "sms", status, result.ok ? null : String(("error" in result ? result.error : result.reason) ?? "").slice(0, 300));
    outcomes.push({ key, kind, channel: "sms", status, body: args.sms });
  }
  return outcomes;
}

export async function runRenterReminders(admin: Admin, deps: ReminderDeps = {}): Promise<{ ok: boolean; reason?: string; outcomes: ReminderOutcome[] }> {
  const now = deps.now ? deps.now() : new Date();
  let gates = deps.gates;
  if (!gates) {
    const { gateFor, loadAutomationControls } = await import("@/lib/automation-controls.server");
    const state = await loadAutomationControls(admin);
    gates = { pickup: gateFor(state, PICKUP_REMINDERS_KEY), agreement: gateFor(state, AGREEMENT_TEXTS_KEY) };
  }
  const send = {
    sendSms: deps.sendSms ?? (async (a) => (await import("@/lib/sms.server")).sendSms(a)),
    sendEmail: deps.sendEmail ?? (async (a) => (await import("@/lib/email.server")).sendEmail(a)),
  };
  const outcomes: ReminderOutcome[] = [];
  const texting = textingHours(now);

  if (gates.pickup === "send" && texting) {
    const { data: rentals } = await admin
      .from("rentals")
      .select("id,status,application_id,vehicle_id,start_date,reservation_note,created_at")
      .eq("status", "reserved")
      .gte("start_date", zoneDate(now, TZ).date)
      .lte("start_date", addDays(zoneDate(now, TZ).date, 30))
      .limit(200);
    for (const r of (rentals ?? []) as any[]) {
      const d = readReservationDetails(r.reservation_note);
      if (!d.pickupTime || !r.application_id) continue;
      const steps = duePickupStep({ start_date: r.start_date, pickupTime: d.pickupTime, created_at: r.created_at }, now);
      if (!steps.length) continue;
      const [{ data: app }, { data: v }] = await Promise.all([
        admin.from("applications").select("id,full_name,phone,email").eq("id", r.application_id).maybeSingle(),
        r.vehicle_id ? admin.from("vehicles").select("year,make,model").eq("id", r.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (!app) continue;
      const facts: PickupFacts = {
        firstName: firstNameOf(app.full_name),
        date: r.start_date,
        time: d.pickupTime,
        location: (d.pickupLocation || "").trim() || DEFAULT_PICKUP_ADDRESS,
        vehicle: v ? [v.year, v.make, v.model].filter(Boolean).join(" ") || null : null,
      };
      for (const step of steps) {
        const key = `pickup:${r.id}:${r.start_date}T${d.pickupTime}:${step}`;
        const kind = `pickup_reminder_${step}`;
        const sms = pickupSms(step, facts);
        if (deps.dryRun) { outcomes.push({ key, kind, channel: "sms", status: "would_send", body: sms }); continue; }
        const c = await claim(admin, { key, kind, application_id: app.id, rental_id: r.id, status: "claimed" });
        if (c === null) return { ok: false, reason: "renter_reminder_sends table missing; nothing sent", outcomes };
        if (!c) continue;
        const email = step === "booked" ? null : { ...pickupEmail(step, facts), workflow: "pickup_reminder" };
        outcomes.push(await deliver(admin, send, key, kind, app, sms, email, r.id));
        outcomes.push(...await copyVehicleNotice(admin, send, { key, kind, sms, applicationId: app.id, rentalId: r.id }));
      }
    }
  }

  if (gates.agreement === "send" && texting) {
    const since = new Date(now.getTime() - 48 * 3600_000).toISOString();
    const { data: ags } = await admin
      .from("agreements")
      .select("id,status,application_id,rental_id,sent_at,signed_at,voided_at,token_expires_at,signer_email")
      .in("status", ["sent", "viewed"])
      .gte("sent_at", since)
      .limit(200);
    for (const a of (ags ?? []) as any[]) {
      if (!a.application_id || !a.sent_at || a.signed_at || a.voided_at) continue;
      if (a.token_expires_at && new Date(a.token_expires_at).getTime() <= now.getTime()) continue;
      const steps = dueAgreementStep({ sent_at: a.sent_at }, now);
      if (!steps.length) continue;
      const { data: app } = await admin.from("applications").select("id,full_name,phone,email").eq("id", a.application_id).maybeSingle();
      if (!app) continue;
      for (const step of steps) {
        const key = `agreement:${a.id}:${step}`;
        const kind = `agreement_sign_${step}`;
        const sms = agreementSms(step);
        if (deps.dryRun) { outcomes.push({ key, kind, channel: "sms", status: "would_send", body: sms }); continue; }
        const c = await claim(admin, { key, kind, application_id: app.id, rental_id: a.rental_id ?? null, agreement_id: a.id, status: "claimed" });
        if (c === null) return { ok: false, reason: "renter_reminder_sends table missing; nothing sent", outcomes };
        if (!c) continue;
        const email = { ...agreementEmail(step, firstNameOf(app.full_name)), workflow: "agreement_sign_reminder" };
        outcomes.push(await deliver(admin, send, key, kind, { ...app, email: a.signer_email || app.email }, sms, email, a.rental_id ?? null));
        outcomes.push(...await remindUnsignedAdditionalDrivers(admin, send, { agreementId: a.id, applicationId: app.id, rentalId: a.rental_id ?? null, step, sms }));
      }
    }
  }

  return { ok: true, outcomes };
}
