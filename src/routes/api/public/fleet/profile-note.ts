import { createFileRoute } from "@tanstack/react-router";

// FLEET appends a note to a driver/applicant profile (applications.notes).
// Bearer FLEET_API_KEY. See src/lib/fleet-review.server.ts and
// docs/fleet-applicant-review.md.
export const Route = createFileRoute("/api/public/fleet/profile-note")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetProfileNote } = await import("@/lib/fleet-review.server");
        return handleFleetProfileNote(request);
      },
    },
  },
});
