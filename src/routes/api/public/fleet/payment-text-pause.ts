import { createFileRoute } from "@tanstack/react-router";

// FLEET pauses the app's automatic payment texts and emails to one renter
// until a date (a payment deal). Bearer FLEET_API_KEY. See
// src/lib/payment-text-pause.server.ts and docs/fleet-payment-text-pause.md.
export const Route = createFileRoute("/api/public/fleet/payment-text-pause")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetPaymentPause } = await import("@/lib/payment-text-pause.server");
        return handleFleetPaymentPause(request);
      },
    },
  },
});
