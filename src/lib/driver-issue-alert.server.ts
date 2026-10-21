// Staff notice after a driver files an issue.
//
// Off by default. When DRIVER_ISSUE_ALERTS_ENABLED=true this emails the same
// inbox new applications use (Settings → Notifications, then LEAD_ALERT_TO,
// then team@drivereal.com). It does not text anyone and it does not write a
// driver-facing notification.

export const DRIVER_ISSUE_ALERTS_ENABLED = process.env.DRIVER_ISSUE_ALERTS_ENABLED === "true";

export type DriverIssueAlert = {
  issueId: string | null;
  title: string;
  kind: string;
  severity: string;
  rentalId: string | null;
  vehicleId: string | null;
};

function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function notifyManagersOfDriverIssue(args: DriverIssueAlert): Promise<void> {
  if (!DRIVER_ISSUE_ALERTS_ENABLED) return;
  const { getLeadAlertPrefs, sendEmail } = await import("@/lib/email.server");
  const prefs = await getLeadAlertPrefs();
  if (!prefs.recipients.length) {
    console.error("[driver-issue] staff alert has no recipient");
    return;
  }
  const base = process.env.SITE_URL || "https://drivereal.com";
  const href = `${base.replace(/\/$/, "")}/admin?tab=driver_issues`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
    <h1 style="font-size:18px">Driver issue reported</h1>
    <p style="font-size:15px;line-height:1.5"><strong>${escapeHtml(args.title)}</strong></p>
    <p style="font-size:14px;color:#444">Type: ${escapeHtml(args.kind)} · Urgency: ${escapeHtml(args.severity)}</p>
    <p style="margin-top:16px"><a href="${escapeHtml(href)}" style="display:inline-block;background:#D03020;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open Driver Issues</a></p>
  </div>`;
  await sendEmail({
    to: prefs.recipients,
    subject: `Driver Issue: ${args.title}`.slice(0, 180),
    html,
    track: { workflow: "driver_issue" },
  });
}
