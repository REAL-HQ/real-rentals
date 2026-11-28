import { createFileRoute } from "@tanstack/react-router";

// FLEET sets a rental's pickup odometer (PATCH; POST is accepted too). A
// lower number than the one on file needs force: true and a note. Off until
// Automations → Rental Records (FLEET). Bearer FLEET_API_KEY.
export const Route = createFileRoute("/api/public/fleet/rental-pickup-odometer")({
  server: {
    handlers: {
      PATCH: async ({ request }) => {
        const { handleFleetPickupOdometer } = await import("@/lib/fleet-rental-records.server");
        return handleFleetPickupOdometer(request);
      },
      POST: async ({ request }) => {
        const { handleFleetPickupOdometer } = await import("@/lib/fleet-rental-records.server");
        return handleFleetPickupOdometer(request);
      },
    },
  },
});
