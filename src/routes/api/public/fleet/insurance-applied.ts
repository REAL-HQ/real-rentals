import { createFileRoute } from "@tanstack/react-router";

// FLEET marks Insurance Quote "Applied · Awaiting Quote" on an approved
// applicant (one audit row, no checkmark, never insurance verification).
// Bearer FLEET_API_KEY. See src/lib/fleet-insurance-applied.server.ts and
// docs/fleet-insurance-applied.md.
export const Route = createFileRoute("/api/public/fleet/insurance-applied")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetInsuranceApplied } = await import("@/lib/fleet-insurance-applied.server");
        return handleFleetInsuranceApplied(request);
      },
    },
  },
});
