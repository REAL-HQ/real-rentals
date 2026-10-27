// Staff notice after a driver files an issue.
//
// Email stays off unless DRIVER_ISSUE_ALERTS_ENABLED is the string "true".
// Roadside SMS is a hard-false constant. Setting ROADSIDE_SMS_ALERTS_ENABLED
// in the environment does not turn it on. Email reuses the applicant-alert
// inbox. SMS, only for a roadside kind, reuses sendSms and the company phone
// already in Settings. No new provider.

import { driverIssueAlertPlan } from "@/lib/driver-issues";
import { ROADSIDE_SMS_ALERTS_ENABLED } from "@/lib/roadside-sms-flag";

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

export async function deliverRoadsideStaffSms(
  args: DriverIssueAlert,
  io: {
    readPhone: () => Promise<string>;
    send: (message: { to: string; body: string }) => Promise<void>;
  },
): Promise<{ sent: number; skipped: "flag" | null }> {
  if (!ROADSIDE_SMS_ALERTS_ENABLED) return { sent: 0, skipped: "flag" };
  const to = await io.readPhone();
  await io.send({
    to,
    body: `REAL RENTALS roadside: ${args.title}. Open Driver Issues in admin.`,
  });
  return { sent: 1, skipped: null };
}

export async function notifyManagersOfDriverIssue(args: DriverIssueAlert): Promise<void> {
  const plan = driverIssueAlertPlan(
    { emailEnabled: DRIVER_ISSUE_ALERTS_ENABLED, smsEnabled: ROADSIDE_SMS_ALERTS_ENABLED },
    args,
  );
  if (!plan.email && !plan.sms) return;

  if (plan.email) {
    const { getLeadAlertPrefs, sendEmail } = await import("@/lib/email.server");
    const prefs = await getLeadAlertPrefs();
    if (prefs.recipients.length) {
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
    } else {
      console.error("[driver-issue] staff alert has no recipient");
    }
  }

  if (ROADSIDE_SMS_ALERTS_ENABLED && plan.sms) {
    const { sendSms } = await import("@/lib/sms.server");
    const { getBusinessPhone } = await import("@/lib/company.server");
    await deliverRoadsideStaffSms(args, {
      readPhone: async () => (await getBusinessPhone()).e164,
      send: async (message) => {
        await sendSms({
          to: message.to,
          body: message.body,
          kind: "roadside_staff",
          requireConsent: false,
          rentalId: args.rentalId,
          vehicleId: args.vehicleId,
        });
      },
    });
  }
}
