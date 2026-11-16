import { createFileRoute } from "@tanstack/react-router";

// FLEET lists open pickup slots and books one for an Approved applicant.
// Bearer FLEET_API_KEY. See src/lib/fleet-pickup.server.ts and
// docs/fleet-pickup-schedule.md.
export const Route = createFileRoute("/api/public/fleet/pickup-slots")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetPickupSlots } = await import("@/lib/fleet-pickup.server");
        return handleFleetPickupSlots(request);
      },
    },
  },
});
