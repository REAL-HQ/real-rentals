import { createFileRoute } from "@tanstack/react-router";

// The same expense list as GET vehicle-expenses, for callers that can only
// POST JSON. Bearer FLEET_API_KEY. Read only.
export const Route = createFileRoute("/api/public/fleet/vehicle-expenses-list")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFleetExpenseList } = await import("@/lib/fleet-expenses.server");
        return handleFleetExpenseList(request);
      },
    },
  },
});
