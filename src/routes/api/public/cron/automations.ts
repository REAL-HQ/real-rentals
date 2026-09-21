import { createFileRoute } from "@tanstack/react-router";
import { runDueAutomations } from "@/lib/automations.server";

// Sweeps every automation enrollment that has come due and sends its next
// step. Scheduled every 5 minutes by pg_cron (see the fleet-ops migration) so
// a "text them 5 minutes after they apply" step actually lands in 5 minutes.
export const Route = createFileRoute("/api/public/cron/automations")({
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
  const { data: expectedToken, error: tokenErr } = await supabaseAdmin.rpc("get_cron_token", {
    _name: "automations",
  });
  if (tokenErr || !expectedToken) return new Response("token config missing", { status: 500 });
  if (!provided || provided !== expectedToken) return new Response("unauthorized", { status: 401 });

  const result = await runDueAutomations();
  return Response.json({ ok: true, ...result });
}
