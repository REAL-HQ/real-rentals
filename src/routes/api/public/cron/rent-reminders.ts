import { createFileRoute } from "@tanstack/react-router";
import { runRentReminders } from "@/lib/rent-reminders.server";

// Hourly rent reminders (see rent-reminders.server.ts). Every stage is an
// Automations switch that is OFF by default; with all off this does nothing.
// Not scheduled until proposed/rent-reminders-cron-v1.sql is run.
export const Route = createFileRoute("/api/public/cron/rent-reminders")({
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
  const { data: expectedToken, error: tokenErr } = await supabaseAdmin.rpc("get_cron_token", { _name: "rent-reminders" });
  if (tokenErr || !expectedToken) return new Response("token config missing", { status: 500 });
  if (!provided || provided !== expectedToken) return new Response("unauthorized", { status: 401 });
  const result = await runRentReminders(supabaseAdmin);
  if (result.reason === "settings_unreadable") return new Response("automation settings unreadable; nothing sent", { status: 503 });
  return Response.json({ ok: true, ...result });
}
