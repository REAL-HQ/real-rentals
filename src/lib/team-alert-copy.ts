/**
 * Wording for staff team alerts (Dolmar, Nov 17 2026: "they look weird").
 * One heading, one short status line, the details once, and a button. No
 * internal codes ("Outside The Approved Templates"), no repeated summary, no
 * "[number removed]". Client-safe and pure; sending is team-alerts.server.ts.
 *
 * An applicant's phone appears only as a tap-to-call link inside the
 * staff-only email body, from the application row. Never in a subject, a
 * text, or code.
 */

/**
 * Subject pattern (Dolmar, Nov 17 10:08 AM): "<STATUS>: <First Last> - <Action>",
 * e.g. "APPROVED: Briana Palmer - Call To Review Terms". The text mirrors it:
 * "REAL: <subject> <link>".
 */
export const HANDOFF_TITLES = {
  complaint: { status: "COMPLAINT", action: "Call Back" },
  injury: { status: "URGENT INJURY", action: "Call Now" },
  payment_dispute: { status: "PAYMENT DISPUTE", action: "Call Back" },
  asked_for_person: { status: "ASKED FOR A PERSON", action: "Call Back" },
  outside_templates: { status: "NEEDS A PERSON", action: "Reply To Them" },
  no_answer: { status: "UNANSWERED", action: "Reply To Them" },
} as const;
export type HandoffReason = keyof typeof HANDOFF_TITLES;

/** "STATUS: Name - Action", or "STATUS: Action" when there is no name. */
export function alertSubject(status: string, name: string | null | undefined, action: string): string {
  const n = personName(name);
  return n ? `${status}: ${n} - ${action}` : `${status}: ${action}`;
}

/** The staff text: "REAL: <subject> <link>". */
export function alertSms(subject: string, link: string | null | undefined): string {
  return `REAL: ${subject}${link ? ` ${link}` : ""}`;
}

/** The one line about the bot pausing; shown once, in the body only. */
export const BOT_PAUSED_LINE = "Bot replies are paused for this person until a team member follows up.";

const clean = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();
const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** "Briana Palmer" from a full name; "" when there is none. */
export function personName(full: string | null | undefined): string {
  return cap(clean(full), 60);
}

/** Short Eastern clock time, e.g. "9:38 AM". */
export function etClock(iso: string | Date | null | undefined): string {
  const t = iso instanceof Date ? iso.getTime() : Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(t));
}

/** US display form of a stored number, "(XXX) XXX-XXXX"; null when it is not a 10-digit US number. */
export function displayPhone(raw: string | null | undefined): { e164: string; display: string } | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d.length === 10 ? d : "";
  if (!ten) return null;
  return { e164: `+1${ten}`, display: `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` };
}

/** Short profile link for texts: /d/<id> redirects to the admin profile (sign-in required). */
export function shortProfileLink(site: string, applicationId: string): string {
  return `${site.replace(/\/$/, "")}/d/${applicationId}`;
}

export type AlertCopy = { subject: string; heading: string; status: string | null; lines: string[]; sms: string };

/**
 * applicant_approved: subject "APPROVED: Briana Palmer - Call To Review Terms",
 * status "Approval texted 9:38 AM · No reply yet · Agreement not sent".
 */
export function approvedApplicantCopy(a: {
  name: string;
  approvalTextedAt?: string | null;
  replied?: boolean | null;
  agreementSent?: boolean | null;
  smsLink: string;
  note?: string | null;
}): AlertCopy {
  const subject = alertSubject("APPROVED", a.name, "Call To Review Terms");
  const parts: string[] = [];
  const at = etClock(a.approvalTextedAt ?? null);
  parts.push(at ? `Approval texted ${at}` : "Approved");
  if (a.replied === true) parts.push("Replied");
  else if (a.replied === false) parts.push("No reply yet");
  if (a.agreementSent === true) parts.push("Agreement sent");
  else if (a.agreementSent === false) parts.push("Agreement not sent");
  const note = clean(a.note);
  return {
    subject,
    heading: subject,
    status: parts.join(" · "),
    lines: [
      ...(note ? [cap(note, 240)] : []),
      "Go over the weekly rate, deposit, start date and car. Then click Move Forward on the Terms Confirmed row, and FLEET sends the agreement.",
    ],
    sms: alertSms(subject, a.smsLink),
  };
}

/** bot_handoff: the summary once, the paused-replies line once. */
export function handoffCopy(a: { reason: HandoffReason; summary: string; name?: string | null; link: string }): AlertCopy {
  const t = HANDOFF_TITLES[a.reason];
  const subject = alertSubject(t.status, a.name, t.action);
  const summary = cap(clean(a.summary), 300);
  const lines = [summary, BOT_PAUSED_LINE];
  if (a.reason === "injury") lines.push("If anyone is hurt they should call 911.");
  return { subject, heading: subject, status: null, lines, sms: alertSms(subject, a.link) };
}

/** roadside_overnight from a bot. */
export function overnightRoadsideCopy(a: { summary: string; name?: string | null; link: string }): AlertCopy {
  const subject = alertSubject("AFTER-HOURS ROADSIDE", a.name, "Call Now");
  const summary = cap(clean(a.summary), 300);
  return {
    subject,
    heading: subject,
    status: null,
    lines: [summary, "No tow partner overnight yet: call them back and arrange help."],
    sms: alertSms(subject, a.link),
  };
}
