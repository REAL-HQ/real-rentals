import { createFileRoute } from "@tanstack/react-router";

// FLEET requests a Reservation Fee refund for one of the six refundable
// reasons. Bearer FLEET_API_KEY. Same idempotent path as staff Refund
// Reservation. See docs/reservation-fee-refunds.md.
export const Route = createFileRoute("/api/public/fleet/refund-reservation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetRefundReservation } = await import("@/lib/reservation-fee-refund.server");
        return handleFleetRefundReservation(request);
      },
    },
  },
});
