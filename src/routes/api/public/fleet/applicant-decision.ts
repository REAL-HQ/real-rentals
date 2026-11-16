import { createFileRoute } from "@tanstack/react-router";

// FLEET approves an applicant (the staff approval code path, refused while a
// hard blocker exists) or sends them to staff (needs_staff). FLEET cannot
// decline. Bearer FLEET_API_KEY. See src/lib/fleet-review.server.ts and
// docs/fleet-applicant-review.md.
export const Route = createFileRoute("/api/public/fleet/applicant-decision")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetApplicantDecision } = await import("@/lib/fleet-review.server");
        return handleFleetApplicantDecision(request);
      },
    },
  },
});
