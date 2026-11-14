import { createFileRoute } from "@tanstack/react-router";

// Quo (formerly OpenPhone) webhook for the REAL Rentals line.
//
// Create a Quo webhook (API version 2026-03-30) pointing at
//   POST https://drivereal.com/api/public/sms/quo
// subscribed to message.received, message.delivered, message.failed and
// message.undelivered for the allowlisted numbers (REAL Rentals PNrZULvFMn and
// Primary PNcX8a0PLJ), and save the returned whsec_… key as the
// QUO_WEBHOOK_KEY server secret.
//
// Every delivery is signature-checked (HMAC-SHA256 over id.timestamp.body,
// 5-minute replay window) before anything is read. Events for any Quo number
// outside the allowlist are acknowledged and ignored.
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
