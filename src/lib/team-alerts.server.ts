/**
 * Send one team alert: an email to team@drivereal.com and a text to the field
 * rep (FIELD_REP_ALERT_NUMBER, a constant). Gated per kind by
 * app_settings.team_alerts (all OFF by default) and claimed once per dedupe
 * key in public.team_alert_sends (proposed/team-alerts-v1.sql). No table, or
 * the kind is off: nothing is sent and the outcome says why.
 *
 * Text goes from the main line through sendSms (requireConsent false: staff
 * number). Renter phone numbers never appear: the body is built here from a
 * title and an admin link, and anything shaped like a phone number is removed.
 */
import {
  FIELD_REP_ALERT_NUMBER,
  readTeamAlertSettings,
  scrubPhones,
  TEAM_ALERT_EMAIL,
  TEAM_ALERTS_SETTINGS_KEY,
  teamAlertSms,
  type TeamAlertKind,
  type TeamAlertSettings,
} from "@/lib/team-alerts";

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
};

export type TeamAlertDeps = {
  settings?: TeamAlertSettings;
  sendSms?: (a: { to: string; body: string; kind: string; requireConsent: false; rentalId?: string | null; vehicleId?: string | null }) => Promise<any>;
  sendEmail?: (a: { to: string; subject: string; html: string; track: { workflow: string }; idempotencyKey: string }) => Promise<any>;
};

export type TeamAlertOutcome = { key: string; status: "sent" | "partial" | "failed" | "off" | "duplicate" | "no_table"; email?: string; sms?: string };

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
  const lines = alert.lines.map(scrubPhones);
  const sendEmail = deps.sendEmail ?? (async (a) => (await import("@/lib/email.server")).sendEmail(a));
  const sendSms = deps.sendSms ?? (async (a) => (await import("@/lib/sms.server")).sendSms(a as any));
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
  <h1 style="font-size:18px">${esc(title)}</h1>
  ${lines.map((l) => `<p style="font-size:14px;line-height:1.5;color:#333;margin:6px 0">${esc(l)}</p>`).join("\n  ")}
  ${alert.link ? `<p style="margin-top:16px"><a href="${esc(alert.link)}" style="display:inline-block;background:#D03020;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open In Admin</a></p>` : ""}
</div>`;
  let email = "failed";
  let sms = "failed";
  try {
    const e = await sendEmail({ to: TEAM_ALERT_EMAIL, subject: title.slice(0, 180), html, track: { workflow: `team_alert_${alert.kind}` }, idempotencyKey: `team-alert:${key}` });
    email = e?.ok ? "sent" : e?.blocked ? `blocked:${e.blocked}` : "failed";
  } catch { email = "failed"; }
  try {
    const s = await sendSms({ to: FIELD_REP_ALERT_NUMBER, body: teamAlertSms(title, alert.link ?? null), kind: `team_alert_${alert.kind}`, requireConsent: false, rentalId: alert.rentalId ?? null, vehicleId: alert.vehicleId ?? null });
    sms = s?.ok ? "sent" : String(s?.reason ?? s?.error ?? "failed").slice(0, 80);
  } catch { sms = "failed"; }
  const status = email === "sent" && sms === "sent" ? "sent" : email === "sent" || sms === "sent" ? "partial" : "failed";
  await admin.from("team_alert_sends").update({ status, detail: `email:${email} sms:${sms}` }).eq("key", key);
  return { key, status, email, sms };
}
