import { createFileRoute } from "@tanstack/react-router";

// FLEET / AIVA hand a person to staff (complaint, injury, payment dispute, ...).
// Bots pause for them until staff mark it handled. Bearer FLEET_API_KEY.
// See src/lib/fleet-handoff.server.ts and docs/fleet-handoff.md.
export const Route = createFileRoute("/api/public/fleet/handoff")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetHandoff } = await import("@/lib/fleet-handoff.server");
        return handleFleetHandoff(request);
      },
    },
  },
});
