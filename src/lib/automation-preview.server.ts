// Renders a real email template with sample data, without sending it.
// previewCapture makes sendEmail hand back the rendered message instead of
// calling Resend or writing a delivery row; recovery links become a
// placeholder so no resume token is minted. Sample data only — never a
// real renter's details.
import { previewCapture, PREVIEW_LINK } from "@/lib/automation-controls.server";

const SAMPLE_APP = "00000000-0000-4000-8000-000000000000";
const TO = "renter@example.com";

export async function renderAutomationPreview(id: string): Promise<{ subject: string; html: string } | { subject: null; html: null; reason: string }> {
  const m = await import("@/lib/email.server");
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const runs: Record<string, () => Promise<unknown>> = {
    recovery_24h: () => m.sendWizardRecoveryEmail({ to: TO, firstName: "Jordan", applicationId: SAMPLE_APP, variant: "24h" }),
    recovery_72h: () => m.sendWizardRecoveryEmail({ to: TO, firstName: "Jordan", applicationId: SAMPLE_APP, variant: "72h" }),
    recovery_abandoned: () => m.sendAbandonedRecoveryEmail({ to: TO, firstName: "Jordan", applicationId: SAMPLE_APP, market: "Atlanta", pickupDate: tomorrow }),
    resume: () => m.sendApplicationResumeEmail({ to: TO, firstName: "Jordan", applicationId: SAMPLE_APP, token: "PREVIEW-LINK" }),
    lead_new: () => m.sendLeadAlertEmail({ event: "new", applicationId: SAMPLE_APP, full_name: "Jordan Sample", phone: "(555) 010-0000", email: TO, city: "Atlanta", state: "GA", market: "Atlanta", pickup_date: tomorrow, return_date: null, platforms: ["Uber"], sms_consent: true, source: "Preview" }),
    lead_complete: () => m.sendLeadAlertEmail({ event: "complete", applicationId: SAMPLE_APP, full_name: "Jordan Sample", phone: "(555) 010-0000", email: TO, city: "Atlanta", state: "GA", market: "Atlanta", pickup_date: tomorrow, return_date: null, platforms: ["Uber"], sms_consent: true, source: "Preview" }),
    due_tomorrow: () => m.sendPaymentDueTomorrowEmail({ to: TO, firstName: "Jordan", amount: 350, dueDate: tomorrow }),
    past_due: () => m.sendPastDueReminderEmail({ to: TO, firstName: "Jordan", amount: 350, dueDate: today, daysLate: 3 }),
    team_alert: () => m.sendTeamPaymentAlertEmail({ event: "past_due", driverName: "Jordan Sample", amount: 350, dueDate: today, daysLate: 1 }),
    collections_plan: () => m.sendTeamCollectionsPlanEmail({ today, tomorrow, dueToday: [{ renterName: "Jordan Sample", vehicleLabel: "2015 Ford Fusion", plate: "ABC-1234", amount: 350, dueDate: today, method: "Card", autopay: true, adminPath: "/admin?tab=payments" }], dueTomorrow: [] }),
    payment_failed: () => m.sendPaymentFailedEmail({ to: TO, firstName: "Jordan", amount: 350, reason: "weekly_rent", last4: "4242", brand: "Visa" }),
    payment_receipt: () => m.sendPaymentReceiptEmail({ to: TO, firstName: "Jordan", amount: 350, reason: "weekly_rent", last4: "4242", brand: "Visa" }),
    card_expiring: () => m.sendCardExpiringEmail({ to: TO, firstName: "Jordan", last4: "4242", brand: "Visa", expMonth: 12, expYear: 2026 }),
    license_expiring: () => m.sendLicenseExpiringEmail({ to: TO, firstName: "Jordan", expiration: tomorrow, daysLeft: 1 }),
  };
  const run = runs[id];
  if (!run) return { subject: null, html: null, reason: "No preview for this template." };
  const captured = await previewCapture(run);
  const first = captured[0];
  if (!first) return { subject: null, html: null, reason: "This template did not render." };
  void PREVIEW_LINK;
  return { subject: first.subject, html: first.html };
}
