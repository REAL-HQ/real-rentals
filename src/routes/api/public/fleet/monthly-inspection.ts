import { createFileRoute } from "@tanstack/react-router";

// FLEET sets a monthly inspection: last done, next due, notes, and one photo.
// Off until Automations → Vehicle Maintenance (FLEET). Bearer FLEET_API_KEY.
export const Route = createFileRoute("/api/public/fleet/monthly-inspection")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetMonthlyInspection } =
          await import("@/lib/fleet-vehicle-maintenance.server");
        return handleFleetMonthlyInspection(request);
      },
    },
  },
});
