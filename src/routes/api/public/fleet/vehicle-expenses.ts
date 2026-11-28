import { createFileRoute } from "@tanstack/react-router";

// FLEET records an expense on a vehicle (POST) and lists a vehicle's
// expenses (GET, ?vehicle_id= or ?license_plate=, optional from, to, limit).
// Bearer FLEET_API_KEY. Create is Off until Automations → Expenses (FLEET).
// See src/lib/fleet-expenses.server.ts and docs/fleet-api.md.
export const Route = createFileRoute("/api/public/fleet/vehicle-expenses")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleFleetExpenseList } = await import("@/lib/fleet-expenses.server");
        return handleFleetExpenseList(request);
      },
      POST: async ({ request }) => {
        const { handleFleetExpenseCreate } = await import("@/lib/fleet-expenses.server");
        return handleFleetExpenseCreate(request);
      },
    },
  },
});
