/**
 * Send one team alert: an email to team@drivereal.com and a text. Gated per
 * kind by app_settings.team_alerts (all OFF by default) and claimed once per
 * dedupe key in public.team_alert_sends (proposed/team-alerts-v1.sql). No
 * table, or the kind is off: nothing is sent and the outcome says why.
 *
 * bot_handoff texts follow staff coverage: the other company Quo line during
 * Rosa's hours, the Pickup Schedule field-rep numbers otherwise. Injuries also
 * go to the field rep at any hour. Other kinds (GPS, late pickup, overnight
 * roadside) still text the field-rep numbers. Emails go to the team inbox
 * anytime. Renter phone numbers never appear.
 *
 * applicant_approved (FLEET, Nov 17 2026: staff now make the approval call)
 * routes like bot_handoff but keeps 8 AM-9 PM ET for the text, and also
 * emails the on-duty coverage person's work inbox (Rosa during her hours).
 */
import {
  readTeamAlertSettings,
  scrubPhones,
  STAFF_WORK_EMAILS,
  TEAM_ALERT_EMAIL,
  TEAM_ALERTS_SETTINGS_KEY,
  teamAlertSms,
  type TeamAlertKind,
  type TeamAlertSettings,
} from "@/lib/team-alerts";
import { loadFieldRepSmsNumbers, planStaffHandoffSms } from "@/lib/staff-coverage.server";
import { displayPhone } from "@/lib/team-alert-copy";

type Admin = any;

export type TeamAlert = {
  kind: TeamAlertKind;
  /** Claimed once: the same key never alerts twice. */
  dedupeKey: string;
  title: string;
  /** Email body lines (plain text; escaped here). */
  lines: string[];
  link?: string | null;
  rentalId?: string | null;
  vehicleId?: string | null;
  /** PN id or E.164 of the renter's company line, for other-line routing. */
  activeLine?: string | null;
  /** bot_handoff reason, e.g. "injury". */
  handoffReason?: string | null;
  /** One short gray status line under the heading. */
  status?: string | null;
  /** Link for the staff text (e.g. the short /d/<id> link); default `link`. */
  smsLink?: string | null;
  /**
   * Staff-only email body: a tap-to-call link for the person to call, from
   * the database row (never a subject, a text, or code). E.164.
   */
  callPhone?: string | null;
};

export type TeamAlertDeps = {
  settings?: TeamAlertSettings;
  sendSms?: (a: { to: string; body: string; kind: string; requireConsent: false; rentalId?: string | null; vehicleId?: string | null; fromId?: string | null }) => Promise<any>;
  sendEmail?: (a: { to: string; subject: string; html: string; track: { workflow: string }; idempotencyKey: string }) => Promise<any>;
  /** Field-rep SMS destinations from settings. Tests inject these. */
  fieldRepNumbers?: string[];
  now?: () => Date;
};

export type TeamAlertOutcome = {
  key: string;
  status: "sent" | "partial" | "failed" | "off" | "duplicate" | "no_table";
  email?: string;
  sms?: string;
  /** applicant_approved: the on-duty staff inbox result, e.g. "sent", "not_on_duty". */
  staff_email?: string;
  /** applicant_approved / bot_handoff: who the text was routed to. */
  routed_to?: { staff_key: string; name: string; via: string } | null;
};

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function loadTeamAlertSettings(admin: Admin): Promise<TeamAlertSettings> {
  const r = await admin.from("app_settings").select("value").eq("key", TEAM_ALERTS_SETTINGS_KEY).maybeSingle();
  // Unreadable = off (an alert that cannot be gated is not sent).
  return readTeamAlertSettings(r?.error ? null : r?.data?.value);
}

export async function sendTeamAlert(admin: Admin, alert: TeamAlert, deps: TeamAlertDeps = {}): Promise<TeamAlertOutcome> {
  const key = `${alert.kind}:${alert.dedupeKey}`.slice(0, 300);
  const settings = deps.settings ?? (await loadTeamAlertSettings(admin));
  if (!settings[alert.kind]) return { key, status: "off" };

  const claim = await admin.from("team_alert_sends").insert({ key, kind: alert.kind, status: "claimed", rental_id: alert.rentalId ?? null, vehicle_id: alert.vehicleId ?? null });
  if (claim.error) {
    const msg = String(claim.error.message ?? "");
    if (String(claim.error.code) === "42P01" || /does not exist|schema cache/i.test(msg)) return { key, status: "no_table" };
    if (String(claim.error.code) === "23505" || /duplicate key/i.test(msg)) return { key, status: "duplicate" };
    return { key, status: "failed" };
  }

  const title = scrubPhones(alert.title);
  const lines = alert.lines.map(scrubPhones).filter(Boolean);
  const statusLine = alert.status ? scrubPhones(alert.status) : "";
  const call = displayPhone(alert.callPhone ?? null);
  const sendEmail = deps.sendEmail ?? (async (a) => (await import("@/lib/email.server")).sendEmail(a));
  const sendSms = deps.sendSms ?? (async (a) => (await import("@/lib/sms.server")).sendSms(a as any));
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
  <h1 style="font-size:18px;margin:0 0 6px">${esc(title)}</h1>
  ${statusLine ? `<p style="font-size:13px;color:#6B6B75;margin:0 0 14px">${esc(statusLine)}</p>` : ""}
  ${lines.map((l) => `<p style="font-size:14px;line-height:1.5;color:#333;margin:6px 0">${esc(l)}</p>`).join("\n  ")}
  ${call || alert.link ? `<p style="margin-top:16px">` : ""}${call ? `<a href="tel:${esc(call.e164)}" style="display:inline-block;background:#111114;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;margin-right:8px">Call ${esc(call.display)}</a>` : ""}${alert.link ? `<a href="${esc(alert.link)}" style="display:inline-block;background:#D03020;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open In Admin</a>` : ""}${call || alert.link ? "</p>" : ""}
</div>`;
  let email = "failed";
  let sms = "failed";
  try {
    const e = await sendEmail({ to: TEAM_ALERT_EMAIL, subject: title.slice(0, 180), html, track: { workflow: `team_alert_${alert.kind}` }, idempotencyKey: `team-alert:${key}` });
    email = e?.ok ? "sent" : e?.blocked ? `blocked:${e.blocked}` : "failed";
  } catch { email = "failed"; }
  // "REAL: <subject> <link>". The subject is scrubbed; the link is ours.
  const body = teamAlertSms(title, alert.smsLink ?? alert.link ?? null);
  const fieldRepNumbers = deps.fieldRepNumbers ?? (await loadFieldRepSmsNumbers(admin));
  let smsTargets: { to: string; fromId?: string | null }[] = fieldRepNumbers.map((to) => ({ to, fromId: null }));
  let staffEmail: string | undefined;
  let routedTo: TeamAlertOutcome["routed_to"];
  if (alert.kind === "bot_handoff" || alert.kind === "applicant_approved") {
    const approved = alert.kind === "applicant_approved";
    const plan = await planStaffHandoffSms({
      admin,
      now: (deps.now ?? (() => new Date()))(),
      reason: approved ? null : alert.handoffReason,
      activeLine: alert.activeLine,
      fieldRepNumbers,
      // Handoffs may text staff at any hour (D20); a call-this-applicant alert waits for 8 AM-9 PM ET.
      ignoreQuietHours: !approved,
    });
    const on = plan.coverage.onDuty;
    routedTo = on ? { staff_key: on.staffKey, name: on.name, via: plan.targets[0]?.via ?? on.source } : null;
    if (plan.quietHours) {
      smsTargets = [];
      sms = "quiet_hours";
    } else {
      smsTargets = plan.targets.map((t) => ({ to: t.to, fromId: t.fromId }));
    }
    if (approved) {
      const inbox = on && on.source === "coverage" ? STAFF_WORK_EMAILS[on.staffKey] : undefined;
      if (!inbox) staffEmail = "not_on_duty";
      else {
        try {
          const e = await sendEmail({ to: inbox, subject: title.slice(0, 180), html, track: { workflow: `team_alert_${alert.kind}_staff` }, idempotencyKey: `team-alert:${key}:staff` });
          staffEmail = e?.ok ? "sent" : e?.blocked ? `blocked:${e.blocked}` : "failed";
        } catch { staffEmail = "failed"; }
      }
    }
  }
  if (sms !== "quiet_hours") {
    if (!smsTargets.length) sms = "no_destination";
    else {
      let okAny = false;
      let lastFail = "failed";
      for (const t of smsTargets) {
        try {
          const s = await sendSms({ to: t.to, body, kind: `team_alert_${alert.kind}`, requireConsent: false, rentalId: alert.rentalId ?? null, vehicleId: alert.vehicleId ?? null, fromId: t.fromId });
          if (s?.ok) okAny = true;
          else lastFail = String(s?.reason ?? s?.error ?? "failed").slice(0, 80);
        } catch { lastFail = "failed"; }
      }
      sms = okAny ? "sent" : lastFail;
    }
  }
  // An applicant_approved alert outside texting hours is email-only by design.
  const smsOk = sms === "sent" || (alert.kind === "applicant_approved" && sms === "quiet_hours");
  const status = email === "sent" && smsOk ? "sent" : email === "sent" || sms === "sent" ? "partial" : "failed";
  await admin.from("team_alert_sends").update({ status, detail: `email:${email} sms:${sms}${staffEmail ? ` staff_email:${staffEmail}` : ""}` }).eq("key", key);
  return { key, status, email, sms, ...(staffEmail ? { staff_email: staffEmail } : {}), ...(alert.kind === "applicant_approved" && routedTo !== undefined ? { routed_to: routedTo } : {}) };
}
