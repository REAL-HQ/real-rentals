import { createFileRoute } from "@tanstack/react-router";

// Missing-items outreach: dry-run preview and the one-time backfill.
// Bearer FLEET_API_KEY. See src/lib/missing-items-outreach.server.ts.
export const Route = createFileRoute("/api/public/fleet/missing-items")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetMissingItems } = await import("@/lib/missing-items-outreach.server");
        return handleFleetMissingItems(request);
      },
    },
  },
});
