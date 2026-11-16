import { createFileRoute } from "@tanstack/react-router";

// FLEET records a RentID result (license status, criminal record) on an
// applicant. OFF unless app_settings.fleet_rentid.record_results is true.
// Bearer FLEET_API_KEY. See src/lib/fleet-rentid.server.ts and docs/fleet-rentid.md.
export const Route = createFileRoute("/api/public/fleet/screening-result")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetScreeningResult } = await import("@/lib/fleet-rentid.server");
        return handleFleetScreeningResult(request);
      },
    },
  },
});
