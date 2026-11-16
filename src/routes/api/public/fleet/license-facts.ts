import { createFileRoute } from "@tanstack/react-router";

// FLEET saves the date of birth and license expiry it read off the license
// photo (never a verification). Bearer FLEET_API_KEY. See
// src/lib/fleet-license.server.ts and docs/fleet-license-facts.md.
export const Route = createFileRoute("/api/public/fleet/license-facts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetLicenseFacts } = await import("@/lib/fleet-license.server");
        return handleFleetLicenseFacts(request);
      },
    },
  },
});
