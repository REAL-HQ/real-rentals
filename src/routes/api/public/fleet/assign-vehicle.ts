import { createFileRoute } from "@tanstack/react-router";

// FLEET assigns an available car to an Approved applicant at its listed rate,
// earliest available first. Bearer FLEET_API_KEY. See
// src/lib/fleet-assign.server.ts and docs/fleet-assign-vehicle.md.
export const Route = createFileRoute("/api/public/fleet/assign-vehicle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetAssignVehicle } = await import("@/lib/fleet-assign.server");
        return handleFleetAssignVehicle(request);
      },
    },
  },
});
