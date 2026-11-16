import { createFileRoute } from "@tanstack/react-router";

// FLEET files a team-only document onto a driver's profile (never verified).
// Bearer FLEET_API_KEY; Off until the "FLEET Document Uploads" switch is On.
// See src/lib/fleet-document.server.ts and docs/fleet-api.md.
export const Route = createFileRoute("/api/public/fleet/driver-document")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetDriverDocument } = await import("@/lib/fleet-document.server");
        return handleFleetDriverDocument(request);
      },
    },
  },
});
