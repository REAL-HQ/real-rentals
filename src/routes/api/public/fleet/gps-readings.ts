import { createFileRoute } from "@tanstack/react-router";

// FLEET posts the latest tracker readings (twice-daily check); the site applies
// the GPS alert rules. Bearer FLEET_API_KEY. Dry run while the GPS alert is off.
// See src/lib/gps-alerts.server.ts and docs/gps-alerts.md.
export const Route = createFileRoute("/api/public/fleet/gps-readings")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleGpsReadings } = await import("@/lib/gps-alerts.server");
        return handleGpsReadings(request);
      },
    },
  },
});
