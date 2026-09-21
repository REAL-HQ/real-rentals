import { createFileRoute } from "@tanstack/react-router";
import { applyLateFees } from "@/lib/late-fees.server";

// Assesses late fees on overdue rent once a day. Safe to run more than once:
// each payment records the date it was last assessed, so a repeat run in the
// same day adds nothing.
export const Route = createFileRoute("/api/public/cron/late-fees")({
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
    _name: "late-fees",
  });
  if (tokenErr || !expectedToken) return new Response("token config missing", { status: 500 });
  if (!provided || provided !== expectedToken) return new Response("unauthorized", { status: 401 });

  const result = await applyLateFees();
  return Response.json({ ok: true, ...result });
}
