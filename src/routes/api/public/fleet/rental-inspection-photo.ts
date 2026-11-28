import { createFileRoute } from "@tanstack/react-router";

// FLEET adds one Pickup or Return photo to a rental, shown as "Ours". The
// renter is not notified. Off until Automations → Rental Records (FLEET).
// Bearer FLEET_API_KEY. See src/lib/fleet-rental-records.server.ts.
export const Route = createFileRoute("/api/public/fleet/rental-inspection-photo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetInspectionPhoto } = await import("@/lib/fleet-rental-records.server");
        return handleFleetInspectionPhoto(request);
      },
    },
  },
});
