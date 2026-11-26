import { createFileRoute } from "@tanstack/react-router";

// FLEET reads one vehicle's mileage log, oil next service due, and monthly
// inspection. Bearer FLEET_API_KEY. Writes are separate routes and stay Off
// until Vehicle Maintenance (FLEET). See docs/fleet-api.md.
export const Route = createFileRoute("/api/public/fleet/vehicle-maintenance")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetVehicleMaintenance } =
          await import("@/lib/fleet-vehicle-maintenance.server");
        return handleFleetVehicleMaintenance(request);
      },
    },
  },
});
