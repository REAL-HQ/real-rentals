import { fmtDate, formatReservationTime } from "@/lib/date-format";
// Server-only Resend email helper.
// Never import from client code — the .server.ts suffix keeps it out of
// the browser bundle. Read process.env INSIDE the function (Cloudflare
// Workers bind env at request time).

/** Canonical renter-facing sender identity. The only place it is defined. */
import { PORTAL_PAY_URL } from "@/lib/portal-pay-link";
import { findDisallowedOutboundUrls, outboundRefusalMessage, publicAppUrl } from "@/lib/public-app-url";

export const EMAIL_FROM = "REAL RENTALS <team@drivereal.com>";
/** Canonical Reply-To for every renter/customer email. Never hello@ or go@. */
export const EMAIL_REPLY_TO = "team@drivereal.com";

/**
 * Optional override for a dedicated sender such as notifications@drivereal.com.
 * Unset by default so From stays team@drivereal.com. Changing it is a product
 * decision and is not flipped by this code.
 */
export function resolvedEmailFrom(): string {
  const override = (typeof process !== "undefined" && process.env && process.env.EMAIL_FROM_OVERRIDE) || "";
  return override.trim() || EMAIL_FROM;
}

type SendArgs = {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  /**
   * Name the workflow sending this email (esign_signing_request,
   * portal_invite, staff_invite, application_resume, test_email, ...).
   * When present, the send is recorded in email_deliveries so the signed
   * Resend webhook can later mark it delivered/bounced/complained. Without
   * it the send is untracked and "accepted" is all anyone will ever know.
   */
  track?: { workflow: string };
  /** Stable key for a reserved recovery attempt. Omitted by every other sender. */
  idempotencyKey?: string;
  /**
   * Driver notices set this. Live sends omit it, so the Resend fetch is the
   * same request it was before: no abort signal is created.
   */
  noticeTimeout?: boolean;
  /** Combined with the 5s notice abort. Live sends omit noticeTimeout, so this is ignored. */
  signal?: AbortSignal;
};

export type SendResult = {
  ok: boolean;
  error?: string;
  id?: string;
  deliveryId?: string;
  /** Provider outcome could not be classified. Absent when the secret is missing. */
  uncertain?: boolean;
  /**
   * Back Office → Automations stopped this send before the provider.
   * "off": the Owner switched it off. "held": the switches could not be read,
   * so it was held (recorded as failed "Held: ...") and may be retried.
   */
  blocked?: "off" | "held";
  retriable?: boolean;
};

/** A held send leaves an honest trail: a failed delivery row, never "sent". */
async function recordHeldDelivery(workflow: string, recipient: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { HELD_REASON } = await import("@/lib/automation-controls.server");
    const now = new Date().toISOString();
    await (supabaseAdmin as any).from("email_deliveries").insert({ workflow, recipient, state: "failed", failed_at: now, provider_reason: HELD_REASON });
  } catch (err) {
    console.error("[email] could not record held delivery", { workflow }, err);
  }
}

/**
 * Record one send attempt in email_deliveries. Never throws, never delays the
 * caller's outcome: a tracking failure must not make a sent email look unsent.
 * "accepted" here means the Resend API accepted the request — only the signed
 * webhook can move the row to delivered/bounced/complained.
 */
// Create the tracking row BEFORE calling Resend, so a webhook can never race
// ahead of persistence. The row starts as "sending" with no provider id.
async function beginEmailDelivery(track: { workflow: string }, recipient: string): Promise<string | undefined> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("email_deliveries")
      .insert({ workflow: track.workflow, recipient, state: "sending" })
      .select("id")
      .single();
    if (error) throw error;
    return data?.id;
  } catch (err) {
    console.error("[email] could not create delivery record", err);
    return undefined;
  }
}

// Finish the row: attach the exact Resend email id (atomically folding in any
// placeholder an early webhook created), or mark it failed.
async function finishEmailDelivery(
  deliveryId: string,
  result: { ok: boolean; error?: string; id?: string },
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (result.ok && result.id) {
      const { error } = await supabaseAdmin.rpc("email_delivery_attach", { _id: deliveryId, _resend_id: result.id });
      if (error) throw error;
    } else {
      const now = new Date().toISOString();
      await supabaseAdmin
        .from("email_deliveries")
        .update({
          state: result.ok ? "accepted" : "failed",
          accepted_at: result.ok ? now : null,
          failed_at: result.ok ? null : now,
          provider_reason: result.ok ? null : (result.error ?? "").slice(0, 500),
          updated_at: now,
        })
        .eq("id", deliveryId);
    }
  } catch (err) {
    console.error("[email] could not finish delivery record", err);
  }
}

/**
 * Send one email. Returns a result rather than throwing, so a failed send can
 * never take down the operation that triggered it.
 */
function noticeFetchSignal(noticeTimeout: boolean | undefined, signal: AbortSignal | undefined): AbortSignal | undefined {
  if (noticeTimeout !== true) return undefined;
  const timeout = AbortSignal.timeout(5000);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

export async function sendEmail({ to, subject, html: rawHtml, from, replyTo, track, idempotencyKey, noticeTimeout, signal }: SendArgs): Promise<SendResult> {
  // Company phone in templates resolves from Settings → Business Phone.
  let html = rawHtml;
  if (html.includes("{{company_phone}}")) {
    const { getBusinessPhone } = await import("@/lib/company.server");
    const phone = await getBusinessPhone();
    html = html.split("{{company_phone}}").join(`<a href="${phone.tel}" style="color:#999">${phone.display}</a>`);
  }
  // Sender identity + why-you-got-this line, then a plain-text alternative
  // (Resend sends both as multipart/alternative). Links and tokens are kept verbatim.
  html = withIdentityFooter(html, track?.workflow);
  // Back Office → Automations: a template preview never sends, and a switched-off
  // automation is skipped before any delivery row or provider call.
  {
    const { capturePreviewEmail, emailGate } = await import("@/lib/automation-controls.server");
    if (capturePreviewEmail({ to: Array.isArray(to) ? to : [to], subject, html, workflow: track?.workflow ?? null })) {
      return { ok: false, error: "Preview only. Nothing was sent." };
    }
    const gate = await emailGate(track?.workflow);
    if (gate === "off") {
      console.info("[email] automation turned off; skipping send", { workflow: track?.workflow });
      return { ok: false, blocked: "off", error: "This automation is turned off in Back Office → Automations." };
    }
    if (gate === "held") {
      console.error("[email] automation settings unreadable; holding send", { workflow: track?.workflow });
      await recordHeldDelivery(track!.workflow, Array.isArray(to) ? (to[0] ?? "") : to);
      return { ok: false, blocked: "held", retriable: true, error: "Held: automation settings could not be read. Not sent." };
    }
  }
  const text = htmlToText(html);
  const blocked = findDisallowedOutboundUrls(subject, html, text)[0];
  if (blocked) {
    const error = outboundRefusalMessage(blocked);
    console.error("[email] refused outbound link", { subject, url: blocked.url, reason: blocked.reason });
    return { ok: false, error };
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[email] RESEND_API_KEY missing; skipping send", { subject });
    return { ok: false, error: "RESEND_API_KEY is not set in this environment." };
  }
  const recipient = Array.isArray(to) ? (to[0] ?? "") : to;
  const deliveryId = track ? await beginEmailDelivery(track, recipient) : undefined;
  const done = async (result: SendResult): Promise<SendResult> => {
    if (deliveryId) {
      await finishEmailDelivery(deliveryId, result);
      result.deliveryId = deliveryId;
    }
    return result;
  };
  const noticeSignal = noticeFetchSignal(noticeTimeout, signal);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: from ?? resolvedEmailFrom(),
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        reply_to: replyTo ?? EMAIL_REPLY_TO,
      }),
      ...(noticeSignal ? { signal: noticeSignal } : {}),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[email] Resend send failed [${res.status}]`, body, { subject });
      return done({
        ok: false,
        uncertain: res.status >= 500 || res.status === 409,
        error: `Resend rejected the send (${res.status}): ${body.slice(0, 300)}`,
      });
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return done({ ok: true, id: json.id });
  } catch (err) {
    console.error("[email] Resend send threw", err, { subject });
    return done({
      ok: false,
      uncertain: true,
      error: err instanceof Error ? err.message : "Could not reach Resend.",
    });
  }
}

const STAFF_WORKFLOWS = new Set(["lead_alert", "service_digest", "esign_signed_ops", "staff_invite", "test_email", "driver_issue", "payment_team_alert", "collections_plan", "duplicate_subscription_alert"]);

/** Why this recipient got this email — accurate per workflow, never promotional. */
export function emailReason(workflow: string | undefined): string {
  if (!workflow) return "You received this email from REAL RENTALS about your account or rental.";
  if (STAFF_WORKFLOWS.has(workflow)) return "Internal REAL RENTALS team notification.";
  if (workflow === "approval_confirmation") return "You received this because your REAL RENTALS driver application was approved.";
  if (workflow === "signup_confirm") return "You received this because you created a REAL RENTALS account.";
  if (workflow.startsWith("application")) return "You received this because you started a driver application with REAL RENTALS.";
  if (workflow.startsWith("esign")) return "You received this because a REAL RENTALS rental agreement was prepared for you.";
  if (workflow.startsWith("payment") || workflow.startsWith("rent_reminder") || workflow === "card_expiring") return "You received this because you have a rental account with REAL RENTALS.";
  return "You received this email from REAL RENTALS about your application, account or rental.";
}

function withIdentityFooter(html: string, workflow: string | undefined): string {
  if (html.includes("data-rr-identity")) return html;
  const footer = `<div data-rr-identity style="max-width:560px;margin:0 auto;padding:0 24px 24px;color:#999;font-size:11px;line-height:1.5;font-family:-apple-system,Segoe UI,Roboto,sans-serif">REAL RENTALS · drivereal.com<br>${escapeHtml(emailReason(workflow))}</div>`;
  return html.includes("</body>") ? html.replace("</body>", `${footer}</body>`) : html + footer;
}

/** Plain-text alternative: keeps every link URL visible next to its label. */
export function htmlToText(html: string): string {
  const decode = (t: string) => t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&middot;/g, "·");
  let t = html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const l = label.replace(/<[^>]+>/g, "").trim();
      if (/^tel:/i.test(href)) return l;
      return l && l !== href ? `${l}: ${href}` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|tr|li|table)>/gi, "\n")
    .replace(/<hr[^>]*>/gi, "\n----\n")
    .replace(/<td[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "");
  t = decode(t).split("\n").map((x) => x.replace(/[ \t]+/g, " ").trim()).join("\n");
  return t.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type LeadEmailArgs = {
  event: "new" | "complete";
  applicationId: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  market: string | null;
  pickup_date: string | null;
  return_date: string | null;
  platforms: string[] | null;
  sms_consent: boolean | null;
  source: string | null;
  adminBaseUrl?: string;
};

// -----------------------------------------------------------------------------
// Where applicant alerts go
// -----------------------------------------------------------------------------
//
// Settings already had a "Notifications → Admin notification email" field, and
// nothing had ever read it: the alerts went to LEAD_ALERT_TO or a hardcoded
// fallback, so changing the address in the UI did nothing at all. This makes
// that field the source of truth.
//
// Resolution order, most specific first:
//   1. app_settings.notifications.admin_email  — editable in the back office
//   2. LEAD_ALERT_TO                           — the existing env var
//   3. team@drivereal.com                      — last resort, never silent
//
// Never throws. A settings lookup that fails must not cost us the alert, so
// any error falls through to the environment and the default.

export type LeadAlertPrefs = {
  recipients: string[];
  onNew: boolean;
  onComplete: boolean;
  /** The setting could not be read; alerts are held, not sent. */
  unreadable?: boolean;
};

const DEFAULT_OPS_INBOX = "team@drivereal.com";

/** Split "a@x.com, b@y.com" into addresses, ignoring blanks and duplicates. */
function parseRecipients(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const addr = part.trim().toLowerCase();
    // Loose on purpose: a typo should still be attempted and bounce visibly,
    // rather than being dropped here and looking like the alert never fired.
    if (addr.includes("@") && addr.length > 3) seen.add(addr);
  }
  return [...seen];
}

export async function getLeadAlertPrefs(): Promise<LeadAlertPrefs> {
  const envInbox = parseRecipients(process.env.LEAD_ALERT_TO);
  const fallback = envInbox.length ? envInbox : [DEFAULT_OPS_INBOX];

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "notifications")
      .maybeSingle();
    // A read error is not "never configured": hold rather than override an Off.
    if (error) throw error;
    if (data && (!data.value || typeof data.value !== "object" || Array.isArray(data.value))) throw new Error("notifications setting malformed");

    const v = (data?.value ?? {}) as Record<string, unknown>;
    const configured = parseRecipients(v.admin_email);

    return {
      recipients: configured.length ? configured : fallback,
      // Absent means on. Someone who never opens Settings keeps the behaviour
      // they have today rather than silently losing their alerts.
      onNew: v.alert_on_new !== false,
      onComplete: v.alert_on_complete !== false,
    };
  } catch (err) {
    console.error("[email] could not read alert settings; holding lead alerts", err);
    return { recipients: fallback, onNew: false, onComplete: false, unreadable: true };
  }
}

export async function sendLeadAlertEmail(args: LeadEmailArgs): Promise<void> {
  const {
    event,
    applicationId,
    full_name,
    phone,
    email,
    city,
    state,
    market,
    pickup_date,
    return_date,
    platforms,
    sms_consent,
    source,
  } = args;

  const name = full_name?.trim() || "Unknown";
  const marketLabel = market || city || "—";
  const subject =
    event === "complete"
      ? `Wizard Completed: ${name}`
      : `New Driver Lead: ${name} — ${marketLabel}`;

  const base = args.adminBaseUrl || "https://drivereal.com";
  const adminLink = `${base}/admin?driver=${applicationId}`;
  const telHref = phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;
  const mailHref = email ? `mailto:${email}` : null;
  const platformsStr = platforms && platforms.length ? platforms.join(", ") : "—";
  const locationStr = [city, state].filter(Boolean).join(", ") || "—";

  const rows: Array<[string, string]> = [
    ["Name", escapeHtml(name)],
    ["Phone", telHref ? `<a href="${telHref}">${escapeHtml(phone)}</a>` : "—"],
    ["Email", mailHref ? `<a href="${mailHref}">${escapeHtml(email)}</a>` : "—"],
    ["Market", escapeHtml(marketLabel)],
    ["Location", escapeHtml(locationStr)],
    ["Pick Up", escapeHtml(pickup_date || "—")],
    ["Return", escapeHtml(return_date || "—")],
    ["Platforms", escapeHtml(platformsStr)],
    ["SMS Consent", sms_consent ? "Yes" : "No"],
    ["Source", escapeHtml(source || "—")],
  ];

  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#666;font-size:13px;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:6px 0;font-size:14px;color:#111">${v}</td></tr>`,
    )
    .join("");

  const heading = event === "complete" ? "Wizard Completed" : "New Driver Lead";

  const html = `<!doctype html>
<html><body style="margin:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #eee">
      <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#D03020;font-weight:600">${heading}</div>
      <h1 style="margin:8px 0 4px;font-size:22px;color:#111">${escapeHtml(name)}</h1>
      <div style="color:#666;font-size:14px;margin-bottom:16px">${escapeHtml(marketLabel)}</div>
      <table cellspacing="0" cellpadding="0" style="width:100%;border-top:1px solid #eee;margin-top:8px">
        ${rowsHtml}
      </table>
      <div style="margin-top:20px">
        <a href="${adminLink}" style="display:inline-block;background:#D03020;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open In Admin</a>
      </div>
      <div style="margin-top:16px;color:#999;font-size:12px">Lead ID: ${escapeHtml(applicationId)}</div>
    </div>
  </div>
</body></html>`;

  const prefs = await getLeadAlertPrefs();
  const wanted = event === "complete" ? prefs.onComplete : prefs.onNew;
  // A Back Office preview renders the alert even while it is switched off.
  const previewing = (await import("@/lib/automation-controls.server")).inPreview();
  if (prefs.unreadable && !previewing) {
    await recordHeldDelivery("lead_alert", prefs.recipients[0] ?? "");
    return;
  }
  if (!wanted && !previewing) return;
  if (!prefs.recipients.length) {
    console.error("[email] lead alert has no recipient; check Settings -> Notifications");
    return;
  }
  await sendEmail({ to: prefs.recipients, subject, html, track: { workflow: "lead_alert" } });
}

/**
 * A link that opens one applicant's application, and nothing else.
 *
 * Every one of these emails used to carry the application UUID in the URL.
 * Mail gets forwarded, sits in inboxes for years and passes through gateways
 * that log full URLs, and that id was the only thing standing between any of
 * that and somebody else's application — so each send now mints its own
 * expiring, revocable token instead. Nothing recovers a token once sent; a
 * replacement is another mint.
 */
async function applicantResumeUrl(applicationId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { issueResumeUrl } = await import("@/lib/resume-tokens.server");
  return issueResumeUrl(supabaseAdmin, applicationId);
}

/**
 * The link in an automated reminder: a short-lived, single-use recovery link,
 * the same kind requestApplicationLink sends.
 *
 * The hourly reminders used to mint a 14-day reusable session token per
 * email. Those sit in inboxes, get forwarded and pass through link-scanning
 * gateways, and nobody asked for them — so an unattended job was minting a
 * fortnight of access to an application on a timer. A recovery link is
 * exchanged for a session on first open and then dies; if it has expired by
 * the time the applicant clicks, the page they land on emails a fresh link to
 * the address on file. A recovery mint only trims older recovery links, so it
 * never logs the applicant out of a tab they already have open.
 */
async function applicantRecoveryUrl(applicationId: string): Promise<string> {
  const preview = await import("@/lib/automation-controls.server");
  if (preview.inPreview()) return preview.PREVIEW_LINK;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { issueResumeToken, resumeUrl } = await import("@/lib/resume-tokens.server");
  return resumeUrl(await issueResumeToken(supabaseAdmin, applicationId, { recovery: true }));
}

/** One sentence under every reminder button, so an expired link is not a dead end. */
async function recoveryLinkNote(): Promise<string> {
  const { RECOVERY_TOKEN_MINUTES } = await import("@/lib/resume-tokens.server");
  return `For your security this link works once and expires ${RECOVERY_TOKEN_MINUTES} minutes after this email was sent. If it has expired, open it anyway and enter your email — we'll send a fresh link to the address on your application.`;
}

/**
 * "We already have your application — here's your link."
 *
 * Sent when somebody submits the lead form and we find a recent application
 * with the same email or phone. The link goes to the address on the existing
 * record, never back to whoever filled the form in: matching an email address
 * is not proof of owning it, and the link is a credential.
 */
export async function sendApplicationResumeEmail(args: {
  to: string;
  firstName: string | null;
  applicationId: string;
  /** Pre-minted recovery token. Omitted on the history path, which mints its own. */
  token?: string;
  /** Reservation id. Present only when the atomic path already reserved the attempt. */
  attemptId?: string;
}): Promise<SendResult> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  // Short-lived, single-use recovery link (see resume-tokens.server.ts).
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { issueResumeToken, resumeUrl: buildUrl, RECOVERY_TOKEN_MINUTES } = await import("@/lib/resume-tokens.server");
  const resumeUrl = buildUrl(
    args.token ?? (await issueResumeToken(supabaseAdmin, args.applicationId, { recovery: true })),
  );
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">Continue Your Application, ${escapeHtml(name)}</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 20px">Here's your secure link to pick up exactly where you left off. Your answers and documents are saved. For your security the link works once and expires in ${RECOVERY_TOKEN_MINUTES} minutes — you can always request a new one.</p>
      <a href="${resumeUrl}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Open My Application</a>
      <p style="color:#888;font-size:12px;margin:20px 0 0;line-height:1.5">Or paste this link into your browser:<br><span style="color:#555;word-break:break-all">${resumeUrl}</span></p>
      <p style="color:#888;font-size:12px;margin:16px 0 0;line-height:1.5">If that wasn't you, you can ignore this email — nothing on your application has changed, and the link above is the only way in.</p>`);
  const sent = await sendEmail({
    to: args.to,
    subject: "Your REAL RENTALS Application — Here's Your Link",
    html,
    replyTo: EMAIL_REPLY_TO,
    track: { workflow: "application_resume" },
    ...(args.attemptId ? { idempotencyKey: `application-resume/${args.attemptId}` } : {}),
  });
  return sent;
}

/**
 * Approved/active applicants: point them at /login instead of a resume token.
 * Email is prefilled only; no auto-login and no account creation from this mail.
 */
export async function sendPortalHandoffEmail(args: {
  to: string;
  firstName: string | null;
  email: string;
}): Promise<SendResult> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const { portalLoginUrl } = await import("@/lib/portal-handoff");
  const url = portalLoginUrl(args.email);
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">You're Approved — Sign In To Your Account</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 20px">Hi ${escapeHtml(name)}, your application is approved. Sign in to your REAL RENTALS account to upload documents, sign your agreement, and finish setup. No password needed — we'll email you a sign-in code.</p>
      <a href="${url}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Sign In To Your Account</a>
      <p style="color:#888;font-size:12px;margin:20px 0 0;line-height:1.5">Or paste this link into your browser:<br><span style="color:#555;word-break:break-all">${url}</span></p>`);
  return sendEmail({
    to: args.to,
    subject: "You're Approved — Sign In To Your REAL RENTALS Account",
    html,
    replyTo: EMAIL_REPLY_TO,
    track: { workflow: "portal_handoff" },
  });
}

type RecoveryArgs = {
  to: string;
  firstName: string | null;
  applicationId: string;
  variant: "24h" | "72h";
};

export async function sendWizardRecoveryEmail({ to, firstName, applicationId, variant }: RecoveryArgs): Promise<SendResult> {
  const name = (firstName || "").trim().split(" ")[0] || "there";
  const resumeUrl = await applicantRecoveryUrl(applicationId);
  const linkNote = await recoveryLinkNote();
  const subject =
    variant === "24h"
      ? `${name}, your REAL RENTALS application is saved`
      : `${name}, your REAL RENTALS application is still open`;
  const headline = variant === "24h" ? "Your Application Is Almost Done" : "Your Application Is Still Open";
  const body =
    variant === "24h"
      ? "You started your driver application yesterday but didn't finish. It takes about 2 minutes to complete — then our team can call you to confirm availability and get you on the road."
      : "Your REAL RENTALS driver application from a few days ago is saved and still open. When you're ready, you can finish it from the link below and our team will follow up about availability in your area. If you've changed your mind, you can simply ignore this email.";

  const html = `<!doctype html>
<html><body style="margin:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #eee">
      <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#D03020;font-weight:700">REAL RENTALS</div>
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">${escapeHtml(headline)}</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 20px">Hi ${escapeHtml(name)}, ${escapeHtml(body)}</p>
      <a href="${resumeUrl}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Finish My Application</a>
      <p style="color:#888;font-size:12px;margin:24px 0 0;line-height:1.5">Or paste this into your browser:<br><span style="color:#555;word-break:break-all">${resumeUrl}</span></p>
      <p style="color:#888;font-size:12px;margin:12px 0 0;line-height:1.5">${escapeHtml(linkNote)}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#999;font-size:12px;margin:0">Questions? Reply to this email or call {{company_phone}}.</p>
    </div>
  </div>
</body></html>`;

  return sendEmail({ to, subject, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "application_recovery" } });
}

// -----------------------------------------------------------------------------
// Shared renter email layout
// -----------------------------------------------------------------------------

function shell(body: string): string {
  return `<!doctype html>
<html><body style="margin:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #eee">
      <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#D03020;font-weight:700">REAL RENTALS</div>
      ${body}
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#999;font-size:12px;margin:0">Questions? Reply to this email or call {{company_phone}}.</p>
    </div>
  </div>
</body></html>`;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** One short vetting confirmation. Account access and pickup details still wait for Reserved. */
export async function sendApprovalConfirmationEmail(args: {
  to: string;
  firstName: string | null;
  applicationId: string;
}): Promise<SendResult> {
  const name = (args.firstName || "").trim().split(/\s+/)[0] || "there";
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">Your Application Is Approved</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Hi ${escapeHtml(name)}, your qualification and verification checks are complete.</p>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Our team will be in touch to assign a vehicle and schedule your pickup.</p>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0">No vehicle is reserved yet. We'll send your driver portal login and pickup details once your reservation is confirmed.</p>`);
  return sendEmail({
    to: args.to,
    subject: "Your REAL RENTALS Application Is Approved",
    html,
    replyTo: EMAIL_REPLY_TO,
    track: { workflow: "approval_confirmation" },
    idempotencyKey: `approval-confirmation-${args.applicationId}`,
  });
}

// -----------------------------------------------------------------------------
// Driver transactional payment emails
// -----------------------------------------------------------------------------

type ReceiptArgs = {
  to: string;
  firstName: string | null;
  amount: number;
  reason: string;
  last4?: string | null;
  brand?: string | null;
  portalUrl?: string;
};

export async function sendPaymentReceiptEmail(args: ReceiptArgs): Promise<SendResult> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const method = args.last4 ? `${args.brand ?? "Card"} ····${args.last4}` : "card on file";
  const label = args.reason.replace(/_/g, " ");
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">Payment Received</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Hi ${escapeHtml(name)}, we successfully charged your ${escapeHtml(method)} for <strong>${money(args.amount)}</strong> (${escapeHtml(label)}). Thanks — you're all set.</p>
      <table cellspacing="0" cellpadding="0" style="width:100%;border-top:1px solid #eee;margin-top:8px">
        <tr><td style="padding:8px 0;color:#666;font-size:13px">Amount</td><td style="padding:8px 0;font-size:14px;color:#111;text-align:right"><strong>${money(args.amount)}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#666;font-size:13px">For</td><td style="padding:8px 0;font-size:14px;color:#111;text-align:right">${escapeHtml(label)}</td></tr>
        <tr><td style="padding:8px 0;color:#666;font-size:13px">Method</td><td style="padding:8px 0;font-size:14px;color:#111;text-align:right">${escapeHtml(method)}</td></tr>
      </table>
      <div style="margin-top:20px">
        <a href="${args.portalUrl || "https://drivereal.com/portal"}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View Payment History</a>
      </div>`);
  return sendEmail({ to: args.to, subject: `Payment Received — ${money(args.amount)}`, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "payment_receipt" } });
}

type FailedArgs = {
  to: string;
  firstName: string | null;
  amount: number;
  reason: string;
  last4?: string | null;
  brand?: string | null;
  updateCardUrl?: string;
  /**
   * The failed invoice's own Stripe page (invoice.stripe.com). When given, it
   * is the main button: paying it settles that week on the renter's existing
   * subscription, with any card. Never a generic payment link (those start a
   * second subscription). See failed-payment-link.ts.
   */
  payInvoiceUrl?: string | null;
};

export async function sendPaymentFailedEmail(args: FailedArgs): Promise<SendResult> {
  const { isHostedInvoiceUrl } = await import("@/lib/failed-payment-link");
  if (isHostedInvoiceUrl(args.payInvoiceUrl)) return sendInvoicePaymentFailedEmail({ ...args, payInvoiceUrl: args.payInvoiceUrl });
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const method = args.last4 ? `${args.brand ?? "Card"} ····${args.last4}` : "card on file";
  const label = args.reason.replace(/_/g, " ");
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#D03020;line-height:1.3">Payment Failed</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Hi ${escapeHtml(name)}, we tried to charge your ${escapeHtml(method)} <strong>${money(args.amount)}</strong> for ${escapeHtml(label)} and it was declined. Please update your card to avoid interruption.</p>
      <a href="${args.updateCardUrl || "https://drivereal.com/portal"}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Update Card</a>
      <p style="color:#444;font-size:14px;margin:16px 0 0;line-height:1.5">Already updated it? <a href="${PORTAL_PAY_URL}" style="color:#D03020;font-weight:600">Pay Now</a> from your driver portal.</p>`);
  return sendEmail({ to: args.to, subject: `Your REAL RENTALS Payment Of ${money(args.amount)} Could Not Be Processed`, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "payment_failed" } });
}

async function sendInvoicePaymentFailedEmail(args: FailedArgs & { payInvoiceUrl: string }): Promise<SendResult> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const method = args.last4 ? `${args.brand ?? "Card"} ····${args.last4}` : "card on file";
  const label = args.reason.replace(/_/g, " ");
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#D03020;line-height:1.3">Payment Failed</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Hi ${escapeHtml(name)}, we tried to charge your ${escapeHtml(method)} <strong>${money(args.amount)}</strong> for ${escapeHtml(label)} and it was declined. Please pay this week's invoice below. You can use a different card on that page.</p>
      <a href="${escapeHtml(args.payInvoiceUrl)}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Pay This Week's Invoice</a>
      <p style="color:#444;font-size:14px;margin:16px 0 0;line-height:1.5">Please use only this button, not an older payment link, so you are not charged twice. To change the card for future weeks, <a href="${args.updateCardUrl || "https://drivereal.com/portal"}" style="color:#D03020;font-weight:600">Update Card</a>.</p>`);
  return sendEmail({ to: args.to, subject: `Your REAL RENTALS Payment Of ${money(args.amount)} Could Not Be Processed`, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "payment_failed" } });
}

/**
 * A rent reminder (rent-reminders.server). The text comes from the editable
 * template; the one button is the renter's own Stripe invoice page or card
 * update page, or none for manual payers (their instructions are in the text).
 */
export async function sendRentReminderEmail(args: {
  to: string;
  subject: string;
  text: string;
  link: string | null;
  linkLabel: string | null;
  workflow: string;
}): Promise<SendResult> {
  const { isGenericPaymentLink } = await import("@/lib/failed-payment-link");
  const link = args.link && /^https:\/\//.test(args.link) && !isGenericPaymentLink(args.link) ? args.link : null;
  const paragraphs = args.text.split(/\n{2,}/).map((p) => `<p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 14px">${escapeHtml(p)}</p>`).join("");
  const button = link
    ? `<a href="${escapeHtml(link)}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">${escapeHtml(args.linkLabel || "Open")}</a>`
    : "";
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">${escapeHtml(args.subject)}</h1>
      ${paragraphs}${button}`);
  return sendEmail({ to: args.to, subject: args.subject, html, replyTo: EMAIL_REPLY_TO, track: { workflow: args.workflow } });
}

type DuplicateSubscriptionArgs = {
  driverName: string | null;
  applicationId: string | null;
  rentalId: string;
  existingSubscriptionId: string;
  newSubscriptionId: string;
  invoiceId: string | null;
  amount: number;
  status: "paid" | "failed";
};

/** Staff alert: a renter's Stripe customer has a second weekly subscription. Nothing is changed in Stripe. */
export async function sendDuplicateSubscriptionAlertEmail(args: DuplicateSubscriptionArgs): Promise<SendResult> {
  const who = args.driverName || "Unknown renter";
  const lines = [
    `<strong>Renter:</strong> ${escapeHtml(who)}`,
    `<strong>Rental's Subscription:</strong> ${escapeHtml(args.existingSubscriptionId)}`,
    `<strong>Second Subscription:</strong> ${escapeHtml(args.newSubscriptionId)}`,
    args.invoiceId ? `<strong>Invoice:</strong> ${escapeHtml(args.invoiceId)} (${money(args.amount)}, ${args.status})` : "",
  ].filter(Boolean).join("<br>");
  const link = args.applicationId
    ? `https://drivereal.com/admin?tab=drivers&id=${encodeURIComponent(args.applicationId)}`
    : "https://drivereal.com/admin";
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:20px;color:#D03020;line-height:1.3">Possible Duplicate Subscription</h1>
      <p style="color:#444;font-size:14px;line-height:1.6;margin:0 0 12px">${lines}</p>
      <p style="color:#444;font-size:14px;line-height:1.6;margin:0 0 12px">This renter may be billed twice each week. Nothing was changed in Stripe. Check both subscriptions and cancel the extra one.</p>
      <a href="${link}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open Renter</a>`);
  return sendEmail({
    to: TEAM_ALERT_INBOX,
    subject: `Possible Duplicate Subscription: ${who}`,
    html,
    track: { workflow: "duplicate_subscription_alert" },
    idempotencyKey: `dup-sub-${args.newSubscriptionId}`,
  });
}

type CardExpiringArgs = {
  to: string;
  firstName: string | null;
  last4?: string | null;
  brand?: string | null;
  expMonth: number;
  expYear: number;
  updateCardUrl?: string;
};

type PastDueArgs = {
  to: string;
  firstName: string | null;
  amount: number;
  dueDate: string | null;
  daysLate: number;
};

export async function sendPastDueReminderEmail(args: PastDueArgs): Promise<SendResult> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const when = args.dueDate ? fmtDate(args.dueDate) : "recently";
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#D03020;line-height:1.3">Balance Past Due</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Hi ${escapeHtml(name)}, your balance of <strong>${money(args.amount)}</strong> was due ${escapeHtml(when)} — that's ${args.daysLate} day${args.daysLate === 1 ? "" : "s"} ago. Please pay now to keep your rental active and avoid late fees.</p>
      <a href="${PORTAL_PAY_URL}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Pay Now</a>
      <p style="color:#888;font-size:12px;margin:16px 0 0;line-height:1.5">Sign in to your driver portal to pay. We'll show your current balance before you confirm.</p>`);
  return sendEmail({ to: args.to, subject: `Outstanding Balance Of ${money(args.amount)} On Your REAL RENTALS Account`, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "payment_past_due" } });
}

type DueTomorrowArgs = { to: string; firstName: string | null; amount: number; dueDate: string; autopay?: boolean };

export async function sendPaymentDueTomorrowEmail(args: DueTomorrowArgs): Promise<SendResult> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const how = args.autopay
    ? "Your card on file will be charged automatically. Make sure it is up to date."
    : "Pay from your driver portal, or reply to this email if you need help.";
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">Payment Due Tomorrow</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Hi ${escapeHtml(name)}, a friendly reminder that <strong>${money(args.amount)}</strong> is due ${escapeHtml(fmtDate(args.dueDate))}. ${escapeHtml(how)}</p>
      <a href="${PORTAL_PAY_URL}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">${args.autopay ? "View Payment" : "Pay Now"}</a>`);
  return sendEmail({ to: args.to, subject: `Reminder: ${money(args.amount)} Due Tomorrow`, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "payment_due_tomorrow" } });
}

type TeamPaymentAlertArgs = {
  event: "failed" | "past_due";
  driverName: string | null;
  amount: number;
  applicationId?: string | null;
  rentalId?: string | null;
  plate?: string | null;
  reason?: string | null;
  daysLate?: number;
  dueDate?: string | null;
};

/** Short internal alert to team@ for a failed charge or a first-time past-due balance. */
export async function sendTeamPaymentAlertEmail(args: TeamPaymentAlertArgs): Promise<SendResult> {
  const who = args.driverName || "Unknown renter";
  const headline = args.event === "failed" ? "Payment Failed" : "Payment Past Due";
  const lines = [
    `<strong>Renter:</strong> ${escapeHtml(who)}`,
    `<strong>Amount:</strong> ${money(args.amount)}`,
    args.plate ? `<strong>Plate:</strong> ${escapeHtml(args.plate)}` : "",
    args.rentalId ? `<strong>Rental:</strong> ${escapeHtml(args.rentalId)}` : "",
    args.reason ? `<strong>Reason:</strong> ${escapeHtml(args.reason.replace(/_/g, " "))}` : "",
    args.dueDate ? `<strong>Due:</strong> ${escapeHtml(fmtDate(args.dueDate))}` : "",
    args.daysLate ? `<strong>Days overdue:</strong> ${args.daysLate}` : "",
  ].filter(Boolean).join("<br>");
  const link = args.applicationId
    ? `https://drivereal.com/admin?tab=drivers&id=${encodeURIComponent(args.applicationId)}`
    : "https://drivereal.com/admin?tab=payments";
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:20px;color:#D03020;line-height:1.3">${headline}</h1>
      <p style="color:#444;font-size:14px;line-height:1.6;margin:0 0 16px">${lines}</p>
      <a href="${link}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open In Admin</a>`);
  return sendEmail({ to: TEAM_ALERT_INBOX, subject: `${headline}: ${who} — ${money(args.amount)}`, html, track: { workflow: "payment_team_alert" } });
}

export const TEAM_ALERT_INBOX = "team@drivereal.com";

type CollectionsPlanEmailItem = {
  renterName: string;
  vehicleLabel: string;
  plate?: string | null;
  amount: number;
  dueDate: string;
  method: string;
  autopay: boolean;
  adminPath: string;
};

type CollectionsPlanEmailArgs = {
  today: string;
  tomorrow: string;
  dueToday: CollectionsPlanEmailItem[];
  dueTomorrow: CollectionsPlanEmailItem[];
};

/** One daily digest so the team can prep collections across every payment method. */
export async function sendTeamCollectionsPlanEmail(args: CollectionsPlanEmailArgs): Promise<SendResult> {
  const section = (title: string, rows: CollectionsPlanEmailItem[]) => {
    if (!rows.length) {
      return `<h2 style="margin:18px 0 6px;font-size:15px;color:#111">${escapeHtml(title)}</h2>
        <p style="color:#888;font-size:13px;margin:0 0 8px">None</p>`;
    }
    const body = rows.map((row) => {
      const vehicle = row.plate ? `${row.vehicleLabel} · ${row.plate}` : row.vehicleLabel;
      const link = row.adminPath.startsWith("http") ? row.adminPath : `https://drivereal.com${row.adminPath}`;
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:13px;color:#111;vertical-align:top">
          <strong>${escapeHtml(row.renterName)}</strong><br>
          <span style="color:#666">${escapeHtml(vehicle)}</span>
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:13px;color:#111;text-align:right;vertical-align:top;white-space:nowrap">
          ${money(row.amount)}<br>
          <span style="color:#666">${escapeHtml(row.method)}${row.autopay ? " · Autopay" : ""}</span><br>
          <a href="${link}" style="color:#D03020;text-decoration:none;font-size:12px">Open</a>
        </td>
      </tr>`;
    }).join("");
    return `<h2 style="margin:18px 0 6px;font-size:15px;color:#111">${escapeHtml(title)} · ${rows.length}</h2>
      <table style="width:100%;border-collapse:collapse">${body}</table>`;
  };
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:20px;color:#111;line-height:1.3">Collections Plan — Due Today / Due Tomorrow</h1>
      <p style="color:#444;font-size:14px;line-height:1.55;margin:0 0 8px">Prep list for ${escapeHtml(fmtDate(args.today))} (ET). Method is taken from autopay/Stripe when linked, otherwise the last recorded method — never assumed.</p>
      ${section("Due Today", args.dueToday)}
      ${section("Due Tomorrow", args.dueTomorrow)}
      <a href="https://drivereal.com/admin?tab=payments" style="display:inline-block;margin-top:18px;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open Payments</a>`);
  const n = args.dueToday.length + args.dueTomorrow.length;
  return sendEmail({
    to: TEAM_ALERT_INBOX,
    subject: `Collections Plan — Due Today / Due Tomorrow (${n})`,
    html,
    track: { workflow: "collections_plan" },
  });
}



export type StripeLinkReconciliationArgs = {
  today: string;
  missing: { id: string; customerEmail: string | null; amountPaid: number; paidOn: string | null; createdOn: string }[];
  unlinkedCustomers: { customerId: string; email: string | null; invoiceIds: string[] }[];
};

/** Daily team alert: paid Stripe money the app has not recorded or cannot tie to a rental. */
export async function sendTeamStripeLinkReconciliationEmail(args: StripeLinkReconciliationArgs): Promise<SendResult> {
  const missingRows = args.missing.map((m) => `<li style="font-size:13px;color:#111;margin:0 0 4px">${escapeHtml(m.customerEmail ?? "No email")} · ${money(m.amountPaid)} · paid ${escapeHtml(fmtDate(m.paidOn ?? m.createdOn))} · <span style="color:#666">${escapeHtml(m.id)}</span></li>`).join("");
  const customerRows = args.unlinkedCustomers.map((c) => `<li style="font-size:13px;color:#111;margin:0 0 4px">${escapeHtml(c.email ?? "No email")} · <span style="color:#666">${escapeHtml(c.customerId)}</span> · ${c.invoiceIds.length} paid invoice(s)</li>`).join("");
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:20px;color:#111;line-height:1.3">Stripe Payments To Link</h1>
      <p style="color:#444;font-size:14px;line-height:1.55;margin:0 0 8px">Check for ${escapeHtml(fmtDate(args.today))} (ET). Nothing was changed. Link these in the app so reminders and balances are right.</p>
      <h2 style="margin:18px 0 6px;font-size:15px;color:#111">Paid But Not Recorded · ${args.missing.length}</h2>
      ${missingRows ? `<ul style="padding-left:18px;margin:0">${missingRows}</ul>` : `<p style="color:#888;font-size:13px;margin:0 0 8px">None</p>`}
      <h2 style="margin:18px 0 6px;font-size:15px;color:#111">Customers Not Linked To A Rental · ${args.unlinkedCustomers.length}</h2>
      ${customerRows ? `<ul style="padding-left:18px;margin:0">${customerRows}</ul>` : `<p style="color:#888;font-size:13px;margin:0 0 8px">None</p>`}
      <a href="https://drivereal.com/admin?tab=payments" style="display:inline-block;margin-top:18px;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open Payments</a>`);
  return sendEmail({
    to: TEAM_ALERT_INBOX,
    subject: `Stripe Payments To Link (${args.missing.length + args.unlinkedCustomers.length})`,
    html,
    track: { workflow: "stripe_link_reconciliation" },
  });
}

type LicenseExpiryArgs = {
  to: string;
  firstName: string | null;
  expiration: string;
  daysLeft: number;
};

export async function sendLicenseExpiringEmail(args: LicenseExpiryArgs): Promise<SendResult> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const when = fmtDate(args.expiration);
  const expired = args.daysLeft <= 0;
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">${expired ? "Your License Has Expired" : "Your License Is Expiring Soon"}</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Hi ${escapeHtml(name)}, our records show your driver's license ${expired ? "expired" : "expires"} on <strong>${escapeHtml(when)}</strong>. Send us an updated photo so your rental stays in good standing.</p>
      <a href="https://drivereal.com/portal" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Upload New License</a>`);
  return sendEmail({ to: args.to, subject: expired ? "Your driver's license on file has expired" : `Your driver's license expires ${when}`, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "license_expiring" } });
}

type ServiceDigestArgs = {
  to: string | string[];
  items: Array<{ vehicle: string; reason: string }>;
};

export async function sendServiceDigestEmail(args: ServiceDigestArgs): Promise<void> {
  const rows = args.items
    .map(
      (i) =>
        `<tr><td style="padding:8px 0;font-size:14px;color:#111">${escapeHtml(i.vehicle)}</td><td style="padding:8px 0;font-size:13px;color:#666;text-align:right">${escapeHtml(i.reason)}</td></tr>`,
    )
    .join("");
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">Service Due — ${args.items.length} Vehicle${args.items.length === 1 ? "" : "s"}</h1>
      <table style="width:100%;border-collapse:collapse;margin-top:8px">${rows}</table>
      <a href="https://drivereal.com/admin" style="display:inline-block;margin-top:18px;background:#111;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Open Service Board</a>`);
  await sendEmail({ to: args.to, subject: `Service Due — ${args.items.length} vehicle${args.items.length === 1 ? "" : "s"} need attention`, html, track: { workflow: "service_digest" } });
}

export async function sendCardExpiringEmail(args: CardExpiringArgs): Promise<SendResult> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const method = args.last4 ? `${args.brand ?? "Card"} ····${args.last4}` : "card on file";
  const mm = String(args.expMonth).padStart(2, "0");
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">Your Card Is Expiring</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Hi ${escapeHtml(name)}, your ${escapeHtml(method)} on file expires <strong>${mm}/${args.expYear}</strong>. Update it now so your weekly rent doesn't miss a beat.</p>
      <a href="${args.updateCardUrl || "https://drivereal.com/portal"}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Update Card</a>`);
  return sendEmail({ to: args.to, subject: `Your card ending in ${args.last4 ?? "••••"} is expiring`, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "card_expiring" } });
}

// -----------------------------------------------------------------------------
// Applicant-facing: admin-triggered document request
// -----------------------------------------------------------------------------

type DocRequestArgs = {
  to: string;
  firstName: string | null;
  applicationId: string;
  items: string[]; // human-readable labels
  note?: string | null;
};

export async function sendDocumentRequestEmail(args: DocRequestArgs): Promise<void> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const resumeUrl = await applicantResumeUrl(args.applicationId);
  const subject = `Almost Done, ${name} — A Few Items To Finish Your REAL RENTALS Application`;
  const list = args.items
    .map(
      (i) =>
        `<li style="padding:6px 0;font-size:14px;color:#111;line-height:1.5">✓ ${escapeHtml(i)}</li>`,
    )
    .join("");
  const noteBlock = args.note
    ? `<div style="margin-top:16px;padding:12px 14px;background:#FFF5F5;border-left:3px solid #D03020;border-radius:6px;color:#444;font-size:14px;line-height:1.5"><strong style="color:#D03020">Note from our team:</strong><br>${escapeHtml(args.note)}</div>`
    : "";
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">Almost Done, ${escapeHtml(name)}</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 12px">Thanks for starting your application with REAL RENTALS. To finish approving you and get you on the road, we just need a few quick items:</p>
      <ul style="list-style:none;padding:0;margin:8px 0 4px;border-top:1px solid #eee;border-bottom:1px solid #eee">${list}</ul>
      ${noteBlock}
      <div style="margin-top:22px">
        <a href="${resumeUrl}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Upload Your Documents</a>
      </div>
      <p style="color:#888;font-size:12px;margin:20px 0 0;line-height:1.5">Or paste this link into your browser:<br><span style="color:#555;word-break:break-all">${resumeUrl}</span></p>`);
  await sendEmail({ to: args.to, subject, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "document_request" } });
}

// Abandoned-application recovery (3–48h partial applications, one-shot).
type AbandonedArgs = {
  to: string;
  firstName: string | null;
  applicationId: string;
  market: string | null;
  pickupDate: string | null;
};

export async function sendAbandonedRecoveryEmail(args: AbandonedArgs): Promise<SendResult> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const resumeUrl = await applicantRecoveryUrl(args.applicationId);
  const linkNote = await recoveryLinkNote();
  const subject = "Finish Your REAL RENTALS Quote — Cars Are Moving Fast";
  const details: string[] = [];
  if (args.market) details.push(`in <strong>${escapeHtml(args.market)}</strong>`);
  if (args.pickupDate) details.push(`starting <strong>${escapeHtml(args.pickupDate)}</strong>`);
  const detailLine = details.length
    ? `Your quote ${details.join(" ")} is still open — but our fleet moves fast.`
    : "Your quote is still open — but our fleet moves fast.";
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">You're Almost There, ${escapeHtml(name)}</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 20px">${detailLine} It only takes about 2 minutes to finish. Lock in your vehicle before it's gone.</p>
      <a href="${resumeUrl}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Pick Up Where You Left Off</a>
      <p style="color:#888;font-size:12px;margin:20px 0 0;line-height:1.5">Or paste this link into your browser:<br><span style="color:#555;word-break:break-all">${resumeUrl}</span></p>
      <p style="color:#888;font-size:12px;margin:12px 0 0;line-height:1.5">${escapeHtml(linkNote)}</p>`);
  return sendEmail({ to: args.to, subject, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "application_recovery" } });
}
// -----------------------------------------------------------------------------
// Rental agreements (e-signature)
// -----------------------------------------------------------------------------

type AgreementSendArgs = { to: string; firstName: string | null; url: string; vehicle: string | null };

/**
 * "Your pickup is reserved — set up your portal."
 *
 * Sent once, after Reserved saves the confirmed pickup appointment. A
 * returning driver never gets it: they already have a password, and a second
 * set-password link would reset an account they were already signed into.
 *
 * inviteUrl is a one-time Supabase recovery link. When it could not be minted
 * the mail still goes out pointing at the portal, where Forgot Password gets
 * them the same place.
 */
export async function sendPortalInviteEmail(args: {
  to: string;
  firstName: string | null;
  inviteUrl: string | null;
  reservation?: {
    pickupDate: string;
    pickupTime: string;
    pickupLocation: string;
    vehicle: string | null;
  };
}): Promise<void> {
  const name = escapeHtml(args.firstName || "there");
  const url = escapeHtml(args.inviteUrl || publicAppUrl("/login"));
  const reservation = args.reservation;
  const appointment = reservation ? `
      <p><strong>Pickup:</strong> ${escapeHtml(fmtDate(reservation.pickupDate))}, ${escapeHtml(formatReservationTime(reservation.pickupTime))}<br>
      <strong>Location:</strong> ${escapeHtml(reservation.pickupLocation)}${reservation.vehicle ? `<br><strong>Vehicle:</strong> ${escapeHtml(reservation.vehicle)}` : ""}</p>` : "";
  await sendEmail({
    to: args.to,
    subject: reservation ? "Your Pickup Is Reserved — Set Up Your Driver Portal" : "Set Up Your REAL RENTALS Driver Portal",
    html: `
      <p>Hi ${name},</p>
      <p>${reservation ? "Your pickup is reserved." : "Your REAL RENTALS driver portal is ready."} Your driver portal is where
         you finish everything before you pick up a vehicle.</p>
      ${appointment}
      <p style="margin:26px 0">
        <a href="${url}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">
          ${args.inviteUrl ? "Set Your Password" : "Open Your Portal"}
        </a>
      </p>
      <p>Once you're in you can:</p>
      <ul>
        <li>upload or replace your licence and other documents</li>
        <li>Insurance is included, with the policy in your name. One less bill to worry about.</li>
        <li>keep your contact details up to date</li>
        <li>read and sign your rental agreement</li>
      </ul>
      ${reservation ? "<p>Please arrive at your confirmed pickup time. Contact us if you need to make a change.</p>" : "<p>We'll let you know as soon as a vehicle is assigned to you.</p>"}
      <p>— REAL RENTALS</p>
    `,
    track: { workflow: "portal_invite" },
  });
}

export async function sendAgreementEmail(args: AgreementSendArgs): Promise<SendResult> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const vehicleLine = args.vehicle
    ? `<p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Vehicle: <strong>${escapeHtml(args.vehicle)}</strong></p>`
    : "";
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">Your Rental Agreement Is Ready To Sign</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 12px">Hi ${escapeHtml(name)}, your REAL RENTALS rental agreement is prepared and pre-filled. Please review it and sign electronically — it takes about a minute.</p>
      ${vehicleLine}
      <a href="${args.url}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Review &amp; Sign Agreement</a>
      <p style="color:#888;font-size:12px;margin:20px 0 0;line-height:1.5">Or paste this link into your browser:<br><span style="color:#555;word-break:break-all">${args.url}</span><br>This secure link expires in 30 days.</p>`);
  return sendEmail({ to: args.to, subject: "Your REAL RENTALS Rental Agreement Is Ready To Sign", html, replyTo: EMAIL_REPLY_TO, track: { workflow: "esign_signing_request" } });
}

export async function sendAgreementSignedEmail(args: {
  to: string;
  firstName: string | null;
  vehicle: string | null;
  portalAccess: boolean;
  payment?: { url: string; amount: number; tiedToRenter: boolean; label: string } | null;
}): Promise<void> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const money = args.payment ? args.payment.amount.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "";
  const pay = args.payment
    ? `<p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 12px">Pay <strong>${escapeHtml(money)}</strong> for ${escapeHtml(args.payment.label)}. ${args.payment.tiedToRenter ? "This link is for your rental and expires within 24 hours." : "This is a shared payment page and is not tied to your rental automatically."}</p>
      <a href="${escapeHtml(args.payment.url)}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Pay ${escapeHtml(money)}</a>`
    : "";
  const tail = args.portalAccess
    ? `is fully executed and saved to your driver file. Sign in at <a href="https://drivereal.com/login">drivereal.com/login</a> with this email address.</p>
      <a href="https://drivereal.com/portal" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">View In Your Portal</a>`
    : `is fully executed and securely saved to your driver file.</p>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0">We'll send you access to your driver portal when your account is ready.</p>`;
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">Agreement Signed — You're All Set</h1>
      ${pay}
      <p style="color:#444;font-size:15px;line-height:1.55;margin:16px 0 12px">Thanks ${escapeHtml(name)}. Your rental agreement${args.vehicle ? ` for the <strong>${escapeHtml(args.vehicle)}</strong>` : ""} ${tail}`);
  await sendEmail({ to: args.to, subject: "Your REAL RENTALS Agreement Is Signed", html, replyTo: EMAIL_REPLY_TO, track: { workflow: "esign_signed_confirmation" } });
}

export async function sendAgreementSignedOpsEmail(args: { driverName: string; applicationId: string; vehicle: string | null }): Promise<void> {
  const url = `https://drivereal.com/admin?driver=${encodeURIComponent(args.applicationId)}`;
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:20px;color:#111">Rental Agreement Signed</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 12px"><strong>${escapeHtml(args.driverName)}</strong> signed their rental agreement${args.vehicle ? ` · ${escapeHtml(args.vehicle)}` : ""}.</p>
      <a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open Driver Record</a>`);
  await sendEmail({ to: DEFAULT_OPS_INBOX, subject: `Signed Agreement — ${args.driverName}`, html, track: { workflow: "esign_signed_ops" } });
}

/**
 * Passwordless portal sign-in: a 6-digit code AND a one-time link in one
 * branded email (plain-text alternative added by sendEmail). Gmail sometimes
 * mangles or pre-clicks links, so the code is the fallback that always works.
 */

export async function sendPasswordResetEmail(args: { to: string; url: string }): Promise<SendResult> {
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">Set A New Password</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 20px">Use this link to set a new password for your REAL RENTALS account. It works once and expires soon. If you did not ask for this, you can ignore this email.</p>
      <a href="${args.url}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Set A New Password</a>
      <p style="color:#888;font-size:12px;margin:20px 0 0;line-height:1.5">Or paste this link into your browser:<br><span style="color:#555;word-break:break-all">${args.url}</span></p>`);
  return sendEmail({ to: args.to, subject: "Set A New Password For Your REAL RENTALS Account", html, replyTo: EMAIL_REPLY_TO, track: { workflow: "password_reset" } });
}

export async function sendSignupConfirmEmail(args: { to: string; url: string }): Promise<SendResult> {
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">Confirm Your Email</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 20px">Confirm this email address to finish creating your REAL RENTALS account. The link works once and expires soon. If you did not create an account, you can ignore this email.</p>
      <a href="${args.url}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Confirm Your Email</a>
      <p style="color:#888;font-size:12px;margin:20px 0 0;line-height:1.5">Or paste this link into your browser:<br><span style="color:#555;word-break:break-all">${args.url}</span></p>`);
  return sendEmail({ to: args.to, subject: "Confirm Your Email For Your REAL RENTALS Account", html, replyTo: EMAIL_REPLY_TO, track: { workflow: "signup_confirm" } });
}

export async function sendPortalSignInEmail(args: { to: string; code: string; link: string; minutes: number }): Promise<SendResult> {
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:20px;color:#111">Your Sign-In Code</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Enter this code on the REAL RENTALS sign-in page:</p>
      <div style="font-size:32px;letter-spacing:.35em;font-weight:700;color:#111;margin:0 0 18px">${escapeHtml(args.code)}</div>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Or sign in with one tap:</p>
      <a href="${args.link}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Sign In To REAL RENTALS</a>
      <p style="color:#666;font-size:13px;line-height:1.55;margin:18px 0 0">The code and link expire in ${args.minutes} minutes and work once. If you didn't ask to sign in, you can ignore this email — nobody can get in without it. Contact us at team@drivereal.com.</p>`);
  return sendEmail({ to: args.to, subject: `${args.code} is your REAL RENTALS sign-in code`, html, track: { workflow: "portal_signin" } });
}
