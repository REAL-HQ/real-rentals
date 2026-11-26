/**
 * Staff email when a homepage submission matches a phone on file but the
 * email does not. Nothing on the application changes and no secure link is
 * sent. This tells the team so they can reach the person.
 *
 * One email per lead per hour, recorded in outbound_messages (the same ledger
 * other staff notices use). Resend's idempotency key covers two requests that
 * pass that check together. A failed send is not recorded, so a later try can
 * still go out. This never throws: the applicant's screen does not depend on it.
 *
 * The renter's phone is not accepted here. Callers pass the last four digits
 * only, and a longer value is dropped.
 */
import { driverRecordPath } from "@/lib/admin-record-links";
import { publicAppUrl } from "@/lib/public-app-url";
import { scrubPhones, TEAM_ALERT_EMAIL } from "@/lib/team-alerts";

export const PHONE_MATCH_ALERT_KIND = "phone_match_email_differs";
export const PHONE_MATCH_ALERT_DEDUPE_MS = 60 * 60 * 1000;

export type PhoneMatchAlertArgs = {
  leadId: string;
  applicantName: string;
  /** The email they just typed, which does not match the application. */
  newEmail: string;
  /** Exactly four digits, or the phone line is omitted. */
  phoneLast4: string;
};

export type PhoneMatchAlertResult = { status: "sent" | "deduped" | "failed" };

type SendEmail = (a: {
  to: string;
  subject: string;
  html: string;
  track: { workflow: string; meta?: Record<string, unknown> };
  idempotencyKey: string;
}) => Promise<{ ok?: boolean } | undefined>;

type Admin = {
  from: (table: string) => any;
};

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Four digits only. Anything else, including a full number, becomes "". */
export function phoneEnding(last4: string | null | undefined): string {
  const d = String(last4 ?? "");
  return /^\d{4}$/.test(d) ? d : "";
}

export function formatPhoneMatchAlertTime(at: Date): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
  return `${formatted} ET`;
}

export function phoneMatchAlertContent(args: PhoneMatchAlertArgs, at: Date): { subject: string; text: string; html: string; link: string } {
  const name = scrubPhones(args.applicantName).replace(/\s+/g, " ").trim().slice(0, 120) || "Applicant";
  const email = String(args.newEmail ?? "").trim().slice(0, 254);
  const when = formatPhoneMatchAlertTime(at);
  const ending = phoneEnding(args.phoneLast4);
  const link = publicAppUrl(driverRecordPath(args.leadId));
  const subject = `Email Doesn't Match: ${name}`.slice(0, 180);
  const lines = [
    `${name} submitted a form with a phone number that matches an application, and a different email. Nothing was changed and no secure link was sent.`,
    `Name: ${name}`,
    `Lead ID: ${args.leadId}`,
    `Time: ${when}`,
    `Email they typed: ${email}`,
    ...(ending ? [`Phone ending in: ${ending}`] : []),
  ];
  const text = lines.join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
  <h1 style="font-size:18px;margin:0 0 12px">Email Doesn't Match</h1>
  ${lines.map((l) => `<p style="font-size:14px;line-height:1.5;color:#333;margin:6px 0">${esc(l)}</p>`).join("\n  ")}
  <p style="margin-top:16px"><a href="${esc(link)}" style="display:inline-block;background:#D03020;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open In Admin</a></p>
</div>`;
  return { subject, text, html, link };
}

export async function sendPhoneMatchEmailDiffersAlert(
  admin: Admin,
  args: PhoneMatchAlertArgs,
  deps: { sendEmail?: SendEmail; now?: () => Date } = {},
): Promise<PhoneMatchAlertResult> {
  try {
    const at = (deps.now ?? (() => new Date()))();
    const since = new Date(at.getTime() - PHONE_MATCH_ALERT_DEDUPE_MS).toISOString();
    const prior = await admin
      .from("outbound_messages")
      .select("id")
      .eq("application_id", args.leadId)
      .eq("kind", PHONE_MATCH_ALERT_KIND)
      .eq("status", "sent")
      .gte("created_at", since)
      .limit(1);
    if (!prior?.error && Array.isArray(prior?.data) && prior.data.length > 0) return { status: "deduped" };

    const content = phoneMatchAlertContent(args, at);
    const windowKey = Math.floor(at.getTime() / PHONE_MATCH_ALERT_DEDUPE_MS);
    const send = deps.sendEmail ?? (await loadSendEmail());
    const result = await send({
      to: TEAM_ALERT_EMAIL,
      subject: content.subject,
      html: content.html,
      track: { workflow: PHONE_MATCH_ALERT_KIND, meta: { applicationId: args.leadId } },
      idempotencyKey: `phone-match-email-differs/${args.leadId}/${windowKey}`,
    });
    if (!result?.ok) return { status: "failed" };

    const recorded = await admin.from("outbound_messages").insert({
      channel: "email",
      to_address: TEAM_ALERT_EMAIL,
      subject: content.subject,
      body: content.text,
      status: "sent",
      provider: "resend",
      kind: PHONE_MATCH_ALERT_KIND,
      application_id: args.leadId,
      created_at: at.toISOString(),
      sent_at: at.toISOString(),
    });
    if (recorded?.error) {
      console.error("[phone-match] alert sent but was not recorded", args.leadId, String(recorded.error.message ?? recorded.error.code ?? ""));
    }
    return { status: "sent" };
  } catch (err) {
    console.error("[phone-match] team alert failed", args.leadId, err instanceof Error ? err.message : "");
    return { status: "failed" };
  }
}

async function loadSendEmail(): Promise<SendEmail> {
  const mod = await import("@/lib/email.server");
  if (typeof mod.sendEmail !== "function") throw new Error("Email sender is unavailable.");
  return mod.sendEmail as SendEmail;
}
