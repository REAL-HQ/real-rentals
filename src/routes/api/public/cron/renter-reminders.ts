import { createFileRoute } from "@tanstack/react-router";

// Pickup reminders and unsigned-agreement texts (renter-reminders.server.ts),
// late pickup release (late-pickup.server.ts).
// Both are OFF in Back Office -> Automations until an Owner turns them on.
// Not scheduled until proposed/renter-reminders-v1.sql is run.
export const Route = createFileRoute("/api/public/cron/renter-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const authHeader = request.headers.get("authorization") || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const { data: expectedToken, error: tokenErr } = await supabaseAdmin.rpc("get_cron_token", { _name: "renter-reminders" });
  if (tokenErr || !expectedToken) return new Response("token config missing", { status: 500 });
  if (!provided || provided !== expectedToken) return new Response("unauthorized", { status: 401 });
  const { runRenterReminders } = await import("@/lib/renter-reminders.server");
  const result = await runRenterReminders(supabaseAdmin);
  const counts: Record<string, number> = {};
  for (const o of result.outcomes) counts[`${o.kind}:${o.channel}:${o.status}`] = (counts[`${o.kind}:${o.channel}:${o.status}`] ?? 0) + 1;
  // Late pickup release (OFF until turned on in Automations) and Reservation Fee holds.
  const { runLatePickups } = await import("@/lib/late-pickup.server");
  const late = await runLatePickups(supabaseAdmin).catch((e) => ({ ok: false, reason: String((e as Error)?.message ?? e), outcomes: [] as { status: string }[] }));
  for (const o of late.outcomes) counts[`late_pickup:${o.status}`] = (counts[`late_pickup:${o.status}`] ?? 0) + 1;
  return Response.json({ ok: result.ok && late.ok, reason: result.reason ?? late.reason ?? null, counts });
}
