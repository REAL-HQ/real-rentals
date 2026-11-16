import { createFileRoute } from "@tanstack/react-router";

// FLEET resends the signing link or the missing-files upload link.
// Off until the Automations switch "FLEET Link Resends" is On. Bearer FLEET_API_KEY.
// See src/lib/fleet-resend-link.server.ts and docs/fleet-resend-link.md.
export const Route = createFileRoute("/api/public/fleet/resend-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetResendLink } = await import("@/lib/fleet-resend-link.server");
        return handleFleetResendLink(request);
      },
    },
  },
});
