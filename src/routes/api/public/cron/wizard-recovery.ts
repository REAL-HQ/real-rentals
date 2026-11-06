import { createFileRoute } from "@tanstack/react-router";
import { sendWizardRecoveryEmail, sendAbandonedRecoveryEmail } from "@/lib/email.server";
import { runWizardRecovery } from "@/lib/wizard-recovery.server";

export const Route = createFileRoute("/api/public/cron/wizard-recovery")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Verify bearer token stored in private.cron_tokens via SECURITY DEFINER RPC
  const authHeader = request.headers.get("authorization") || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const { data: expectedToken, error: tokenErr } = await supabaseAdmin.rpc("get_cron_token", {
    _name: "wizard-recovery",
  });
  if (tokenErr || !expectedToken) {
    return new Response("token config missing", { status: 500 });
  }
  if (!provided || provided !== expectedToken) {
    return new Response("unauthorized", { status: 401 });
  }

  // Filtering (open drafts only: not deleted, purged or decided) and
  // claim-before-send (no double emails from overlapping runs) live in
  // runWizardRecovery, where they are unit-tested.
  const report = await runWizardRecovery(supabaseAdmin, {
    sendWizardRecoveryEmail,
    sendAbandonedRecoveryEmail,
  });
  return Response.json(report);
}
