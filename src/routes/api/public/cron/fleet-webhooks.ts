import { createFileRoute } from "@tanstack/react-router";

// FLEET webhook queue (see fleet-webhook.server.ts): sends due lead alerts
// and Quo forwards, and retries failures with backoff. Sends nothing until
// FLEET_WEBHOOK_URL and FLEET_WEBHOOK_KEY are set (queued rows are marked
// skipped instead). Not scheduled until proposed/fleet-webhooks-cron-v1.sql is run.
export const Route = createFileRoute("/api/public/cron/fleet-webhooks")({
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
  const { data: expectedToken, error: tokenErr } = await supabaseAdmin.rpc("get_cron_token", { _name: "fleet-webhooks" });
  if (tokenErr || !expectedToken) return new Response("token config missing", { status: 500 });
  if (!provided || provided !== expectedToken) return new Response("unauthorized", { status: 401 });
  // Queue application_ready_for_review for applicants who just became
  // reviewable (fleet-review.server.ts). A failure here never blocks sending.
  let readyQueued = 0;
  try {
    const { sweepReadyForReview } = await import("@/lib/fleet-review.server");
    readyQueued = (await sweepReadyForReview(supabaseAdmin)).length;
  } catch (e) {
    console.error("[fleet-webhooks] ready-for-review sweep failed", String((e as Error)?.message ?? e));
  }
  const { dispatchFleetWebhooks } = await import("@/lib/fleet-webhook.server");
  const result = await dispatchFleetWebhooks(supabaseAdmin, { limit: 50 });
  return Response.json({ ok: true, readyQueued, ...result });
}
