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

  const opsInbox = process.env.LEAD_ALERT_TO || "go@drivereal.com";
  await sendEmail({ to: opsInbox, subject, html });
}