// Staff notice after a driver files an issue.
//
// Email stays off unless DRIVER_ISSUE_ALERTS_ENABLED is the string "true".
// Roadside SMS is a hard-false constant. Setting ROADSIDE_SMS_ALERTS_ENABLED
// in the environment does not turn it on. Email reuses the applicant-alert
// inbox. SMS, only for a roadside kind, reuses sendSms and the company phone
// already in Settings. No new provider.

import { driverIssueAlertPlan, isRoadsideKind } from "@/lib/driver-issues";
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

/**
 * Overnight roadside (Dolmar, t299s1618; SOP D17): from 6 PM to 6 AM ET there is
 * no tow partner yet, so a roadside request alerts the team (email + field rep
 * text) through the team alert switch "roadside_overnight" (OFF by default).
 * Independent of the daytime email/SMS flags above.
 */
export async function alertOvernightRoadside(args: DriverIssueAlert, now = new Date(), deps: import("@/lib/team-alerts.server").TeamAlertDeps & { admin?: any } = {}) {
  if (!isRoadsideKind(args.kind)) return { status: "not_roadside" as const };
  const { isOvernightEt } = await import("@/lib/team-alerts");
  if (!isOvernightEt(now)) return { status: "daytime" as const };
  const admin = deps.admin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const { sendTeamAlert } = await import("@/lib/team-alerts.server");
  const base = process.env.SITE_URL || "https://drivereal.com";
  return sendTeamAlert(admin, {
    kind: "roadside_overnight",
    dedupeKey: args.issueId ?? `${args.rentalId ?? "no-rental"}:${now.toISOString().slice(0, 13)}`,
    title: `After-Hours Roadside: ${args.title}`,
    lines: [
      `Type: ${args.kind} · Urgency: ${args.severity}`,
      "Filed between 6 PM and 6 AM ET. There is no tow partner overnight yet: call the renter back from the portal record and arrange help.",
    ],
    link: `${base.replace(/\/$/, "")}/admin?tab=issues&filter=driver`,
    rentalId: args.rentalId,
    vehicleId: args.vehicleId,
  }, deps);
}

export async function notifyManagersOfDriverIssue(args: DriverIssueAlert): Promise<void> {
  try {
    await alertOvernightRoadside(args);
  } catch (e) {
    console.error("[driver-issue] overnight roadside alert failed", e);
  }
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
      const href = `${base.replace(/\/$/, "")}/admin?tab=issues&filter=driver`;
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
