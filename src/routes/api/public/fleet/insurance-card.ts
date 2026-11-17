import { createFileRoute } from "@tanstack/react-router";

// FLEET hands over an insurance ID card found in team@ Gmail (Spam included)
// for Fleet Inbox to read and, on an exact VIN + name match, file to the
// renter's portal. See src/lib/fleet-insurance-card.server.ts.
export const Route = createFileRoute("/api/public/fleet/insurance-card")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetInsuranceCard } = await import("@/lib/fleet-insurance-card.server");
        return handleFleetInsuranceCard(request);
      },
    },
  },
});
