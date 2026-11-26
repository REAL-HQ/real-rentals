import { createFileRoute } from "@tanstack/react-router";

// FLEET sets the next oil service due miles and date.
// Off until Automations → Vehicle Maintenance (FLEET). Bearer FLEET_API_KEY.
export const Route = createFileRoute("/api/public/fleet/service-due")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetServiceDue } = await import("@/lib/fleet-vehicle-maintenance.server");
        return handleFleetServiceDue(request);
      },
    },
  },
});
