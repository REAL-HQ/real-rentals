import { createFileRoute } from "@tanstack/react-router";

// FLEET files a document onto a driver's profile (never verified). Insurance
// cards are shared with the driver; other categories are team only unless
// driver_visible is true.
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
