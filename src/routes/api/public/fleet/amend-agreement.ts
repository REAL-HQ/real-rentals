import { createFileRoute } from "@tanstack/react-router";

// FLEET sends an updated (amended) rental agreement to an ACTIVE rental, e.g.
// a new weekly rate the renter agreed to. The new rate starts only after the
// renter signs. Bearer FLEET_API_KEY. See src/lib/rental-amendment.server.ts
// and docs/fleet-amend-agreement.md.
export const Route = createFileRoute("/api/public/fleet/amend-agreement")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetAmendAgreement } = await import("@/lib/rental-amendment.server");
        return handleFleetAmendAgreement(request);
      },
    },
  },
});
