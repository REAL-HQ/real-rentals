import { createFileRoute } from "@tanstack/react-router";

// FLEET sends the rental agreement after the applicant confirms the terms on
// a call or by text. Bearer FLEET_API_KEY. See src/lib/fleet-agreement.server.ts
// and docs/fleet-send-agreement.md.
export const Route = createFileRoute("/api/public/fleet/send-agreement")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetSendAgreement } = await import("@/lib/fleet-agreement.server");
        return handleFleetSendAgreement(request);
      },
    },
  },
});
