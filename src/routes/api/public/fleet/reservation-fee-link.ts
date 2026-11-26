import { createFileRoute } from "@tanstack/react-router";

// FLEET gets the $50 Reservation Fee Checkout link for a signed applicant.
// Bearer FLEET_API_KEY. Same core as staff Copy Reservation Fee Link; sends
// nothing. See src/lib/fleet-reservation-fee-link.server.ts and docs/fleet-reservation-fee-link.md.
export const Route = createFileRoute("/api/public/fleet/reservation-fee-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetReservationFeeLink } = await import("@/lib/fleet-reservation-fee-link.server");
        return handleFleetReservationFeeLink(request);
      },
    },
  },
});
