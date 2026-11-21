import { createFileRoute } from "@tanstack/react-router";

// FLEET files a background report entry (RentID order or result, FL DMV
// license check, other provider) with its files onto a driver's Screening tab.
// Never a decision. Bearer FLEET_API_KEY; Off until the "Background Reports
// (FLEET)" switch is On. See src/lib/background-report.server.ts.
export const Route = createFileRoute("/api/public/fleet/background-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetBackgroundReport } = await import("@/lib/background-report.server");
        return handleFleetBackgroundReport(request);
      },
    },
  },
});
