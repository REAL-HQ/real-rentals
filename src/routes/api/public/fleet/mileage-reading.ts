import { createFileRoute } from "@tanstack/react-router";

// FLEET appends one mileage log row, with an optional photo.
// Off until Automations → Vehicle Maintenance (FLEET). Bearer FLEET_API_KEY.
export const Route = createFileRoute("/api/public/fleet/mileage-reading")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetMileageReading } =
          await import("@/lib/fleet-vehicle-maintenance.server");
        return handleFleetMileageReading(request);
      },
    },
  },
});
