import { createFileRoute } from "@tanstack/react-router";

// Bots put a person on something now: overnight roadside, or a hand-off
// (complaint, injury, payment dispute, asked for a person). Bearer FLEET_API_KEY.
// See src/lib/fleet-team-alert.server.ts and docs/bot-rules.md.
export const Route = createFileRoute("/api/public/fleet/team-alert")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetTeamAlert } = await import("@/lib/fleet-team-alert.server");
        return handleFleetTeamAlert(request);
      },
    },
  },
});
