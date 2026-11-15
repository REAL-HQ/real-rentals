import { createFileRoute } from "@tanstack/react-router";

// Quo (formerly OpenPhone) webhook for both REAL lines.
//
// Create a Quo webhook (API version 2026-03-30) pointing at
//   POST https://drivereal.com/api/public/sms/quo
// for BOTH numbers (Primary 813 PNcX8a0PLJ and REAL Rentals 888 PNrZULvFMn),
// subscribed to message.received, message.delivered, message.failed,
// message.undelivered, call.completed, call.missed, call.recording.completed,
// call.voicemail.completed and call.transcript.completed (call.summary.completed
// optional), and save the returned whsec_… key as the QUO_WEBHOOK_KEY secret.
//
// Every delivery is signature-checked (HMAC-SHA256 over id.timestamp.body,
// 5-minute replay window) before anything is read. Accepted lines come from
// QUO_INBOUND_NUMBER_IDS (default: both). Incoming texts, calls, voicemails
// and transcripts are logged on the matched lead (public.quo_events, with the
// line's number, id and label) and forwarded to FLEET through the signed
// sender in fleet-webhook.server.ts (off until FLEET_WEBHOOK_URL/KEY are set).
// Replies are not sent from here: Quo answers STOP/HELP keywords itself.
export const Route = createFileRoute("/api/public/sms/quo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleQuoWebhook } = await import("@/lib/quo-webhook.server");
        return handleQuoWebhook(request);
      },
    },
  },
});
