import { createFileRoute } from "@tanstack/react-router";

// FLEET status reads: whole-journey digest, one lead's journey, a renter's balance.
// Read-only. Bearer FLEET_API_KEY. See src/lib/fleet-status.server.ts and docs/fleet-status.md.
export const Route = createFileRoute("/api/public/fleet/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetStatus } = await import("@/lib/fleet-status.server");
        return handleFleetStatus(request);
      },
    },
  },
});
