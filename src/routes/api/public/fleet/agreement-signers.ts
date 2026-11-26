import { createFileRoute } from "@tanstack/react-router";

// FLEET reads who has signed an agreement and when each link was sent.
// Read-only. Bearer FLEET_API_KEY. See src/lib/fleet-agreement-signers.server.ts.
export const Route = createFileRoute("/api/public/fleet/agreement-signers")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetAgreementSigners } = await import("@/lib/fleet-agreement-signers.server");
        return handleFleetAgreementSigners(request);
      },
    },
  },
});
