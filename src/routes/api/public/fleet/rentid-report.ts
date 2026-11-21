import { createFileRoute } from "@tanstack/react-router";

// FLEET files a RentID order (receipt) or result (+ report file) onto a
// driver's Screening tab. Never a decision. Bearer FLEET_API_KEY; Off until
// the "RentID Reports (FLEET)" switch is On. See src/lib/rentid-report.server.ts.
export const Route = createFileRoute("/api/public/fleet/rentid-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetRentidReport } = await import("@/lib/rentid-report.server");
        return handleFleetRentidReport(request);
      },
    },
  },
});
