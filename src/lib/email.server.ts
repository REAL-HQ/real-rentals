// Server-only Resend email helper.
// Never import from client code — the .server.ts suffix keeps it out of
// the browser bundle. Read process.env INSIDE the function (Cloudflare
// Workers bind env at request time).

type SendArgs = {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
};

export async function sendEmail({ to, subject, html, from, replyTo }: SendArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[email] RESEND_API_KEY missing; skipping send", { subject });
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: from ?? "REAL RENTALS <team@drivereal.com>",
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[email] Resend send failed [${res.status}]`, body, { subject });
    }
  } catch (err) {
    console.error("[email] Resend send threw", err, { subject });
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
      <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#CC0000;font-weight:600">${heading}</div>
      <h1 style="margin:8px 0 4px;font-size:22px;color:#111">${escapeHtml(name)}</h1>
      <div style="color:#666;font-size:14px;margin-bottom:16px">${escapeHtml(marketLabel)}</div>
      <table cellspacing="0" cellpadding="0" style="width:100%;border-top:1px solid #eee;margin-top:8px">
        ${rowsHtml}
      </table>
      <div style="margin-top:20px">
        <a href="${adminLink}" style="display:inline-block;background:#CC0000;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open In Admin</a>
      </div>
      <div style="margin-top:16px;color:#999;font-size:12px">Lead ID: ${escapeHtml(applicationId)}</div>
    </div>
  </div>
</body></html>`;

  const opsInbox = process.env.LEAD_ALERT_TO || "team@drivereal.com";
  await sendEmail({ to: opsInbox, subject, html });
}

type RecoveryArgs = {
  to: string;
  firstName: string | null;
  applicationId: string;
  variant: "24h" | "72h";
};

export async function sendWizardRecoveryEmail({ to, firstName, applicationId, variant }: RecoveryArgs): Promise<void> {
  const name = (firstName || "").trim().split(" ")[0] || "there";
  const resumeUrl = `https://drivereal.com/apply?id=${encodeURIComponent(applicationId)}`;
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
      <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#CC0000;font-weight:700">REAL RENTALS</div>
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">${escapeHtml(headline)}</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 20px">Hi ${escapeHtml(name)}, ${escapeHtml(body)}</p>
      <a href="${resumeUrl}" style="display:inline-block;background:#CC0000;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Finish My Application</a>
      <p style="color:#888;font-size:12px;margin:24px 0 0;line-height:1.5">Or paste this into your browser:<br><span style="color:#555;word-break:break-all">${resumeUrl}</span></p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#999;font-size:12px;margin:0">Questions? Reply to this email or call (813) 940-3251.</p>
    </div>
  </div>
</body></html>`;

  await sendEmail({ to, subject, html, replyTo: "hello@drivereal.com" });
}

// -----------------------------------------------------------------------------
// Driver transactional payment emails
// -----------------------------------------------------------------------------

function shell(body: string): string {
  return `<!doctype html>
<html><body style="margin:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #eee">
      <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#CC0000;font-weight:700">REAL RENTALS</div>
      ${body}
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#999;font-size:12px;margin:0">Questions? Reply to this email or call (813) 940-3251.</p>
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
  await sendEmail({ to: args.to, subject: `Payment Received — ${money(args.amount)}`, html, replyTo: "hello@drivereal.com" });
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
      <h1 style="margin:12px 0 8px;font-size:22px;color:#CC0000;line-height:1.3">Payment Failed</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Hi ${escapeHtml(name)}, we tried to charge your ${escapeHtml(method)} <strong>${money(args.amount)}</strong> for ${escapeHtml(label)} and it was declined. Please update your card to avoid interruption.</p>
      <a href="${args.updateCardUrl || "https://drivereal.com/portal"}" style="display:inline-block;background:#CC0000;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Update Card</a>`);
  await sendEmail({ to: args.to, subject: `Action Needed — Payment Failed (${money(args.amount)})`, html, replyTo: "hello@drivereal.com" });
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

export async function sendCardExpiringEmail(args: CardExpiringArgs): Promise<void> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const method = args.last4 ? `${args.brand ?? "Card"} ····${args.last4}` : "card on file";
  const mm = String(args.expMonth).padStart(2, "0");
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">Your Card Is Expiring</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 16px">Hi ${escapeHtml(name)}, your ${escapeHtml(method)} on file expires <strong>${mm}/${args.expYear}</strong>. Update it now so your weekly rent doesn't miss a beat.</p>
      <a href="${args.updateCardUrl || "https://drivereal.com/portal"}" style="display:inline-block;background:#CC0000;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Update Card</a>`);
  await sendEmail({ to: args.to, subject: `Your card ending in ${args.last4 ?? "••••"} is expiring`, html, replyTo: "hello@drivereal.com" });
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
  const resumeUrl = `https://drivereal.com/thank-you?id=${encodeURIComponent(args.applicationId)}`;
  const subject = `Almost Done, ${name} — A Few Items To Finish Your REAL RENTALS Application`;
  const list = args.items
    .map(
      (i) =>
        `<li style="padding:6px 0;font-size:14px;color:#111;line-height:1.5">✓ ${escapeHtml(i)}</li>`,
    )
    .join("");
  const noteBlock = args.note
    ? `<div style="margin-top:16px;padding:12px 14px;background:#FFF5F5;border-left:3px solid #CC0000;border-radius:6px;color:#444;font-size:14px;line-height:1.5"><strong style="color:#CC0000">Note from our team:</strong><br>${escapeHtml(args.note)}</div>`
    : "";
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">Almost Done, ${escapeHtml(name)}</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 12px">Thanks for starting your application with REAL RENTALS. To finish approving you and get you on the road, we just need a few quick items:</p>
      <ul style="list-style:none;padding:0;margin:8px 0 4px;border-top:1px solid #eee;border-bottom:1px solid #eee">${list}</ul>
      ${noteBlock}
      <div style="margin-top:22px">
        <a href="${resumeUrl}" style="display:inline-block;background:#CC0000;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Upload Your Documents</a>
      </div>
      <p style="color:#888;font-size:12px;margin:20px 0 0;line-height:1.5">Or paste this link into your browser:<br><span style="color:#555;word-break:break-all">${resumeUrl}</span></p>`);
  await sendEmail({ to: args.to, subject, html, replyTo: "hello@drivereal.com" });
}

// Abandoned-application recovery (3–48h partial applications, one-shot).
type AbandonedArgs = {
  to: string;
  firstName: string | null;
  applicationId: string;
  market: string | null;
  pickupDate: string | null;
  returnDate: string | null;
};

export async function sendAbandonedRecoveryEmail(args: AbandonedArgs): Promise<void> {
  const name = (args.firstName || "").trim().split(" ")[0] || "there";
  const resumeUrl = `https://drivereal.com/thank-you?id=${encodeURIComponent(args.applicationId)}`;
  const subject = "Finish Your REAL RENTALS Quote — Cars Are Moving Fast";
  const details: string[] = [];
  if (args.market) details.push(`in <strong>${escapeHtml(args.market)}</strong>`);
  if (args.pickupDate && args.returnDate) {
    details.push(`from <strong>${escapeHtml(args.pickupDate)}</strong> to <strong>${escapeHtml(args.returnDate)}</strong>`);
  }
  const detailLine = details.length
    ? `Your quote ${details.join(" ")} is still open — but our fleet moves fast.`
    : "Your quote is still open — but our fleet moves fast.";
  const html = shell(`
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">You're Almost There, ${escapeHtml(name)}</h1>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 20px">${detailLine} It only takes about 2 minutes to finish. Lock in your vehicle before it's gone.</p>
      <a href="${resumeUrl}" style="display:inline-block;background:#CC0000;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Pick Up Where You Left Off</a>
      <p style="color:#888;font-size:12px;margin:20px 0 0;line-height:1.5">Or paste this link into your browser:<br><span style="color:#555;word-break:break-all">${resumeUrl}</span></p>`);
  await sendEmail({ to: args.to, subject, html, replyTo: "hello@drivereal.com" });
}