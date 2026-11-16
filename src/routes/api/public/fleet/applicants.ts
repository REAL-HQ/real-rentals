import { createFileRoute } from "@tanstack/react-router";

// FLEET reads applicants awaiting review and one applicant's review packet.
// Bearer FLEET_API_KEY. See src/lib/fleet-review.server.ts and
// docs/fleet-applicant-review.md.
export const Route = createFileRoute("/api/public/fleet/applicants")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetApplicants } = await import("@/lib/fleet-review.server");
        return handleFleetApplicants(request);
      },
    },
  },
});
