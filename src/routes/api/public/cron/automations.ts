import { createFileRoute } from "@tanstack/react-router";
import { runDueAutomations } from "@/lib/automations.server";
import { DOCUMENT_EXPIRY_NOTICES_ENABLED } from "@/lib/document-expiry-flag";

// Sweeps every automation enrollment that has come due and sends its next
// step. Scheduled every 5 minutes by pg_cron (see the fleet-ops migration) so
// a "text them 5 minutes after they apply" step actually lands in 5 minutes.
export const Route = createFileRoute("/api/public/cron/automations")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const authHeader = request.headers.get("authorization") || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const { data: expectedToken, error: tokenErr } = await supabaseAdmin.rpc("get_cron_token", {
    _name: "automations",
  });
  if (tokenErr || !expectedToken) return new Response("token config missing", { status: 500 });
  if (!provided || provided !== expectedToken) return new Response("unauthorized", { status: 401 });

  // Enrollment only. The sweep below still sends whatever step is due.
  // The constant is checked before the helper import, so a dark flag does
  // not read rentals or documents and cannot fail this cron.
  if (DOCUMENT_EXPIRY_NOTICES_ENABLED) {
    try {
      const { enrollDocumentExpiringNotices } = await import("@/lib/document-expiry.server");
      await enrollDocumentExpiringNotices();
    } catch (err) {
      console.error("[document-expiry] enroll failed", err);
    }
  }

  const result = await runDueAutomations();

  // Missing-Items Outreach (Automations switch, Off by default). Runs after the
  // follow-up sweep so an applicant still in that sequence is skipped.
  let missingItems: unknown = null;
  try {
    const { runMissingItemsOutreach } = await import("@/lib/missing-items-outreach.server");
    const r = await runMissingItemsOutreach(supabaseAdmin, { mode: "ongoing" });
    missingItems = r.held ? { held: r.held } : { sent: r.sent, failed: r.failed, planned: r.planned };
  } catch (err) {
    console.error("[missing-items] sweep failed", err);
  }
  // Missing-Items Auto-Close (its own switch, Off by default).
  let missingItemsAutoClose: unknown = null;
  try {
    const { runMissingItemsAutoClose } = await import("@/lib/missing-items-outreach.server");
    const r = await runMissingItemsAutoClose(supabaseAdmin);
    missingItemsAutoClose = r.held ? { held: r.held } : { closed: r.closed, failed: r.failed };
  } catch (err) {
    console.error("[missing-items] auto-close failed", err);
  }

  // Renter payment notices held while the Automations switches were unreadable.
  let heldNotices: unknown = null;
  try {
    const { retryHeldNotices } = await import("@/lib/held-payment-notices.server");
    const m = await import("@/lib/email.server");
    heldNotices = await retryHeldNotices(supabaseAdmin, {
      sendReceipt: m.sendPaymentReceiptEmail, sendFailed: m.sendPaymentFailedEmail,
      sendCardExpiring: m.sendCardExpiringEmail, sendTeamAlert: m.sendTeamPaymentAlertEmail,
    });
  } catch (err) {
    console.error("[held-notices] retry failed", err);
  }
  // Signed updated agreements whose new weekly rate is due today (and open
  // ones whose agreement was voided). Nothing until the amendments table exists.
  let rateAmendments: unknown = null;
  try {
    const { applyDueRentalAmendments } = await import("@/lib/rental-amendment.server");
    rateAmendments = await applyDueRentalAmendments(supabaseAdmin);
  } catch (err) {
    console.error("[rental-amendment] sweep failed", err);
  }
  // Applicant texts that failed only because Quo was out of credits, sent
  // again once credit is back (9 AM-8 PM ET, at most 3 tries in 24 hours).
  let creditRetry: unknown = null;
  try {
    const { retryCreditFailedSms } = await import("@/lib/sms-credit-retry.server");
    creditRetry = await retryCreditFailedSms(supabaseAdmin);
  } catch (err) {
    console.error("[sms-credit-retry] failed", err);
  }
  // License photos read automatically: DOB, license number/state and expiry
  // fill in on the application (never over a value staff entered). Two per
  // run; Photo Reading's switch and daily limit apply.
  let licenseAutoRead: unknown = null;
  try {
    const { autoReadLicenses } = await import("@/lib/license-auto-read.server");
    const r = await autoReadLicenses(supabaseAdmin, { limit: 2 });
    licenseAutoRead = r.held ? { held: r.held } : { candidates: r.candidates, read: r.read };
  } catch (err) {
    console.error("[license-auto-read] failed", err);
  }
  // Lead alerts stuck at "sending" over 10 minutes: link to Resend's webhook
  // if the alert went out, otherwise resend it exactly once. Inert until
  // migration 20261122200000 is applied.
  let leadAlertSweep: unknown = null;
  try {
    const { sweepStuckLeadAlerts } = await import("@/lib/lead-alert-sweep.server");
    leadAlertSweep = await sweepStuckLeadAlerts(supabaseAdmin);
  } catch (err) {
    console.error("[lead-alert-sweep] failed", err);
  }
  // Unpaid Reservation Fee holds older than the window (default 24 hours).
  // Staff can release earlier from Bookings. A failure here must not fail the cron.
  let reservationFeeHolds: unknown = null;
  try {
    const { releaseExpiredReservationHolds } = await import("@/lib/reservation-fee-hold.server");
    reservationFeeHolds = await releaseExpiredReservationHolds(supabaseAdmin);
  } catch (err) {
    console.error("[reservation-fee-hold] sweep failed", err);
  }
  return Response.json({ ok: true, ...result, heldNotices, missingItems, missingItemsAutoClose, rateAmendments, creditRetry, licenseAutoRead, leadAlertSweep, reservationFeeHolds });
}
