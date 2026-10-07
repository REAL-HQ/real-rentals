// Server-only Resend email helper.
// Never import from client code — the .server.ts suffix keeps it out of
// the browser bundle. Read process.env INSIDE the function (Cloudflare
// Workers bind env at request time).

/** Canonical renter-facing sender identity. The only place it is defined. */
export const EMAIL_FROM = "REAL RENTALS <team@drivereal.com>";
/** Canonical Reply-To for every renter/customer email. Never hello@ or go@. */
export const EMAIL_REPLY_TO = "team@drivereal.com";

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
};

export type SendResult = { ok: boolean; error?: string; id?: string; deliveryId?: string };

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
export async function sendEmail({ to, subject, html: rawHtml, from, replyTo, track }: SendArgs): Promise<SendResult> {
  // Company phone in templates resolves from Settings → Business Phone.
  let html = rawHtml;
  if (html.includes("{{company_phone}}")) {
    const { getBusinessPhone } = await import("@/lib/company.server");
    const phone = await getBusinessPhone();
    html = html.split("{{company_phone}}").join(`<a href="${phone.tel}" style="color:#999">${phone.display}</a>`);
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
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: from ?? EMAIL_FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        reply_to: replyTo ?? EMAIL_REPLY_TO,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[email] Resend send failed [${res.status}]`, body, { subject });
      return done({ ok: false, error: `Resend rejected the send (${res.status}): ${body.slice(0, 300)}` });
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return done({ ok: true, id: json.id });
  } catch (err) {
    console.error("[email] Resend send threw", err, { subject });
    return done({ ok: false, error: err instanceof Error ? err.message : "Could not reach Resend." });
  }
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
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "notifications")
      .maybeSingle();

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
    console.error("[email] could not read alert settings; using fallback", err);
    return { recipients: fallback, onNew: true, onComplete: true };
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
  if (!wanted) return;
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
}): Promise<void> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const resumeUrl = await applicantResumeUrl(args.applicationId);
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">You Already Have An Application With Us, ${escapeHtml(name)}</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 20px">Somebody just started a new one using your details, so rather than create a second record we've sent you the link to the one you already have. Pick up exactly where you left off.</p>
      <a href="${resumeUrl}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Open My Application</a>
      <p style="color:#888;font-size:12px;margin:20px 0 0;line-height:1.5">Or paste this link into your browser:<br><span style="color:#555;word-break:break-all">${resumeUrl}</span></p>
      <p style="color:#888;font-size:12px;margin:16px 0 0;line-height:1.5">If that wasn't you, you can ignore this email — nothing on your application has changed, and the link above is the only way in.</p>`);
  await sendEmail({
    to: args.to,
    subject: "Your REAL RENTALS Application — Here's Your Link",
    html,
    replyTo: EMAIL_REPLY_TO,
    track: { workflow: "application_resume" },
  });
}

type RecoveryArgs = {
  to: string;
  firstName: string | null;
  applicationId: string;
  variant: "24h" | "72h";
};

export async function sendWizardRecoveryEmail({ to, firstName, applicationId, variant }: RecoveryArgs): Promise<void> {
  const name = (firstName || "").trim().split(" ")[0] || "there";
  const resumeUrl = await applicantResumeUrl(applicationId);
  const subject =
    variant === "24h"
      ? `${name}, finish your REAL RENTALS application`
      : `${name}, your spot won't hold much longer`;
  const headline = variant === "24h" ? "You're almost there." : "Last nudge — your spot is waiting.";
  const body =
    variant === "24h"
      ? "You started your driver application yesterday but didn't finish. It takes about 2 minutes to complete — then our team can call you to confirm availability and get you on the road."
      : "We've held your spot for 3 days. Vehicles in your market move fast — finish your application now to lock it in before we release it to the next driver in line.";

  const html = `<!doctype html>
<html><body style="margin:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #eee">
      <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#D03020;font-weight:700">REAL RENTALS</div>
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">${escapeHtml(headline)}</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 20px">Hi ${escapeHtml(name)}, ${escapeHtml(body)}</p>
      <a href="${resumeUrl}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Finish My Application</a>
      <p style="color:#888;font-size:12px;margin:24px 0 0;line-height:1.5">Or paste this into your browser:<br><span style="color:#555;word-break:break-all">${resumeUrl}</span></p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#999;font-size:12px;margin:0">Questions? Reply to this email or call {{company_phone}}.</p>
    </div>
  </div>
</body></html>`;

  await sendEmail({ to, subject, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "application_recovery" } });
}

// -----------------------------------------------------------------------------
// Driver transactional payment emails
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

type ReceiptArgs = {
  to: string;
  firstName: string | null;
  amount: number;
  reason: string;
  last4?: string | null;
  brand?: string | null;
  portalUrl?: string;
};

export async function sendPaymentReceiptEmail(args: ReceiptArgs): Promise<void> {
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
  await sendEmail({ to: args.to, subject: `Payment Received — ${money(args.amount)}`, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "payment_receipt" } });
}

type FailedArgs = {
  to: string;
  firstName: string | null;
  amount: number;
  reason: string;
  last4?: string | null;
  brand?: string | null;
  updateCardUrl?: string;
};

export async function sendPaymentFailedEmail(args: FailedArgs): Promise<void> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const method = args.last4 ? `${args.brand ?? "Card"} ····${args.last4}` : "card on file";
  const label = args.reason.replace(/_/g, " ");
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#D03020;line-height:1.3">Payment Failed</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Hi ${escapeHtml(name)}, we tried to charge your ${escapeHtml(method)} <strong>${money(args.amount)}</strong> for ${escapeHtml(label)} and it was declined. Please update your card to avoid interruption.</p>
      <a href="${args.updateCardUrl || "https://drivereal.com/portal"}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Update Card</a>`);
  await sendEmail({ to: args.to, subject: `Action Needed — Payment Failed (${money(args.amount)})`, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "payment_failed" } });
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

export async function sendPastDueReminderEmail(args: PastDueArgs): Promise<void> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const when = args.dueDate ? new Date(args.dueDate).toLocaleDateString("en-US") : "recently";
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#D03020;line-height:1.3">Balance Past Due</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Hi ${escapeHtml(name)}, your balance of <strong>${money(args.amount)}</strong> was due ${escapeHtml(when)} — that's ${args.daysLate} day${args.daysLate === 1 ? "" : "s"} ago. Please pay now to keep your rental active and avoid late fees.</p>
      <a href="https://drivereal.com/portal" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Pay Balance</a>`);
  await sendEmail({ to: args.to, subject: `Past Due — ${money(args.amount)} On Your REAL RENTALS Account`, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "payment_past_due" } });
}

type LicenseExpiryArgs = {
  to: string;
  firstName: string | null;
  expiration: string;
  daysLeft: number;
};

export async function sendLicenseExpiringEmail(args: LicenseExpiryArgs): Promise<void> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const when = new Date(args.expiration).toLocaleDateString("en-US");
  const expired = args.daysLeft <= 0;
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">${expired ? "Your License Has Expired" : "Your License Is Expiring Soon"}</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Hi ${escapeHtml(name)}, our records show your driver's license ${expired ? "expired" : "expires"} on <strong>${escapeHtml(when)}</strong>. Send us an updated photo so your rental stays in good standing.</p>
      <a href="https://drivereal.com/portal" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Upload New License</a>`);
  await sendEmail({ to: args.to, subject: expired ? "Your driver's license on file has expired" : `Your driver's license expires ${when}`, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "license_expiring" } });
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

export async function sendCardExpiringEmail(args: CardExpiringArgs): Promise<void> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const method = args.last4 ? `${args.brand ?? "Card"} ····${args.last4}` : "card on file";
  const mm = String(args.expMonth).padStart(2, "0");
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">Your Card Is Expiring</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Hi ${escapeHtml(name)}, your ${escapeHtml(method)} on file expires <strong>${mm}/${args.expYear}</strong>. Update it now so your weekly rent doesn't miss a beat.</p>
      <a href="${args.updateCardUrl || "https://drivereal.com/portal"}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Update Card</a>`);
  await sendEmail({ to: args.to, subject: `Your card ending in ${args.last4 ?? "••••"} is expiring`, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "card_expiring" } });
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

export async function sendAbandonedRecoveryEmail(args: AbandonedArgs): Promise<void> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const resumeUrl = await applicantResumeUrl(args.applicationId);
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
      <p style="color:#888;font-size:12px;margin:20px 0 0;line-height:1.5">Or paste this link into your browser:<br><span style="color:#555;word-break:break-all">${resumeUrl}</span></p>`);
  await sendEmail({ to: args.to, subject, html, replyTo: EMAIL_REPLY_TO, track: { workflow: "application_recovery" } });
}
// -----------------------------------------------------------------------------
// Rental agreements (e-signature)
// -----------------------------------------------------------------------------

type AgreementSendArgs = { to: string; firstName: string | null; url: string; vehicle: string | null };

/**
 * "You're approved — set up your portal."
 *
 * Sent once, on the approval that creates the account. A returning driver
 * never gets it: they already have a password, and a second set-password link
 * in their inbox is how somebody ends up resetting an account they were
 * already signed into.
 *
 * inviteUrl is a one-time Supabase recovery link. When it could not be minted
 * the mail still goes out pointing at the portal, where Forgot Password gets
 * them the same place.
 */
export async function sendPortalInviteEmail(args: {
  to: string;
  firstName: string | null;
  inviteUrl: string | null;
}): Promise<void> {
  const name = escapeHtml(args.firstName || "there");
  const site = process.env.PUBLIC_SITE_URL || "https://drivereal.com";
  const url = escapeHtml(args.inviteUrl || `${site}/login`);
  await sendEmail({
    to: args.to,
    subject: "You're approved — set up your driver portal",
    html: `
      <p>Hi ${name},</p>
      <p>Good news — you're approved. Your driver portal is ready, and it is where
         you finish everything before you pick up a vehicle.</p>
      <p style="margin:26px 0">
        <a href="${url}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">
          ${args.inviteUrl ? "Set Your Password" : "Open Your Portal"}
        </a>
      </p>
      <p>Once you're in you can:</p>
      <ul>
        <li>upload or replace your licence, insurance and other documents</li>
        <li>keep your contact details up to date</li>
        <li>read and sign your rental agreement</li>
      </ul>
      <p>We'll let you know as soon as a vehicle is assigned to you.</p>
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
  return sendEmail({ to: args.to, subject: "Sign Your REAL RENTALS Rental Agreement", html, replyTo: EMAIL_REPLY_TO, track: { workflow: "esign_signing_request" } });
}

export async function sendAgreementSignedEmail(args: { to: string; firstName: string | null; vehicle: string | null; portalAccess: boolean }): Promise<void> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const tail = args.portalAccess
    ? `is fully executed and saved to your driver file. It's available in your portal.</p>
      <a href="https://drivereal.com/portal" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">View In Your Portal</a>`
    : `is fully executed and securely saved to your driver file.</p>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0">We'll send you access to your driver portal when your account is ready.</p>`;
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">Agreement Signed — You're All Set</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 12px">Thanks ${escapeHtml(name)}. Your rental agreement${args.vehicle ? ` for the <strong>${escapeHtml(args.vehicle)}</strong>` : ""} ${tail}`);
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
